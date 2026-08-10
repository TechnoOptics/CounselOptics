-- A human-quotable reference on every firm matter.
--
-- ======================= APPLIED TO PRODUCTION 2026-08-09 =================
-- Written and applied the same day, at commit 0e46e947, and verified against
-- the live schema: 8 firm matters, 0 unnumbered, 0 consumer cases numbered,
-- three firms each holding their own contiguous series from MAT-0000001.
-- supabase/schema-fingerprint.sha256 was regenerated in that same commit.
--
-- The banner above previously said NOT APPLIED. It was written before the
-- apply and never corrected, which made it the FOURTH header found today
-- claiming an applied migration was pending. That keeps happening because
-- the drift gate cannot contradict it: the CI step self-skips while
-- SUPABASE_DB_URL is unset, so a header and a fingerprint can both be wrong
-- and the job still passes. Until that secret exists, these banners are the
-- only record of applied state, so they have to be corrected by whoever ran
-- the migration rather than left for a reader to doubt.
--
-- Nothing will catch a missed regeneration on its own right now: the CI
-- drift gate self-skips until the SUPABASE_DB_URL repo secret is set, so it
-- is INERT and a stale fingerprint will pass green.
-- =========================================================================
--
-- A matter's identity is a uuid, and the counsel list and the matter
-- breadcrumb have been showing its leading segment ("8b1aee48") for want of
-- anything better. A firm quotes a matter reference in email, on the phone
-- and in a filing, and a uuid fragment cannot be read aloud.
--
-- The series is the one lib/ticket-allocator.ts already runs for employee
-- submissions, pointed at a second table: read the firm's highest number,
-- add one, write it conditional on the column still being null, and on a
-- unique violation bump and retry. That loop is safe for exactly one
-- reason, and it is the index at the bottom of this file, not the care in
-- the code. See lib/ticket-allocator.ts, which says so at length.

alter table public.cases
  -- The firm's own reference for this matter, e.g. 'MAT-0000001'.
  --
  -- On `cases` rather than a firm-side table because a matter IS a case row
  -- with a firm_id; there is no other record to hang it on. Nullable, so a
  -- consumer case (firm_id null) simply never has one, and so an allocation
  -- that could not complete leaves the matter usable rather than blocking it.
  --
  -- Fixed seven-digit pad. The allocator finds the next number by reading
  -- the highest one back with an ORDER BY on this TEXT column, and a text
  -- sort only agrees with a numeric one while every number is the same
  -- width. lib/ticket-numbers.ts refuses at 9999999 for that reason and this
  -- backfill carries the same stop.
  add column if not exists matter_number text;

alter table public.firm_settings
  -- The letters in front of this firm's matter numbers. Its own column and
  -- NOT a reuse of ticket_prefix, because the two are separate counters over
  -- separate tables: one shared prefix would eventually issue REQ-0000005 for
  -- an employee's document and REQ-0000005 for a matter, and a reference that
  -- resolves to two records of different kinds is worse than none. Null reads
  -- as the default 'MAT' (lib/ticket-numbers.ts).
  add column if not exists matter_prefix text;

-- ---------------------------------------------------------------------
-- Every matter that already exists gets its number here, in one pass.
-- ---------------------------------------------------------------------
--
-- BACKFILLED, unlike firm_template_submissions.ticket_number, and the
-- difference is deliberate rather than an inconsistency. A submission had
-- ALREADY been emailed to somebody under a derived REQ- reference before
-- that column existed, so numbering it later would have handed one document
-- two references. A matter has never had a reference of its own to
-- contradict: the uuid fragment on screen is the id itself, and it stays
-- reachable (it is still the URL, and still the hover title on the chip).
--
-- The alternative, leaving old matters unnumbered, would ship the feature to
-- a firm's future work only and leave its actual open caseload unquotable,
-- which is the complaint. The other alternative, allocating an old matter's
-- number the first time somebody happens to open it, would put the firm's
-- series in the order people clicked and make a reference APPEAR days after
-- the feature landed. Doing it here means every matter has its number from
-- the moment this file is applied, in a defensible order.
--
-- ORDERED BY created_at, THEN id. created_at is the real sequence a firm
-- would recognise, oldest matter first; the id breaks ties so the result is
-- deterministic and re-running this file cannot produce a different
-- assignment.
--
-- AND IT CANNOT RENUMBER ANYTHING. `where c.matter_number is null` in the
-- second CTE means an already-numbered matter is not even a candidate, so
-- this cannot move a reference that has been quoted.
--
-- `taken` is what makes a SECOND run safe as well as a first, and it was
-- added because the first draft was not. row_number() restarts at 1 over
-- whatever rows are left, so re-running after a few matters had been opened
-- issued a fresh 0000001 next to the 0000001 already on a matter: with the
-- firm's prefix unchanged that is a unique violation and the whole file
-- aborts, and with the prefix changed it is worse, because it succeeds and
-- puts two matters at the same position in one firm's series. Seeding the
-- count from the firm's existing highest number is the same rule the
-- allocator uses (parseTicketSeq in lib/ticket-numbers.ts): read the
-- TRAILING digits and ignore whatever prefix is in front of them, so a firm
-- that has changed its prefix continues its series instead of restarting it.
-- On a first run there is nothing numbered, max_seq is null, and this adds 0.
with taken as (
  select
    c.firm_id,
    max(coalesce((substring(c.matter_number from '(\d+)\s*$'))::bigint, 0)) as max_seq
  from public.cases c
  where c.firm_id is not null
    and c.matter_number is not null
  group by c.firm_id
),
numbered as (
  select
    c.id,
    -- The same rule as normalizeMatterPrefix in lib/ticket-numbers.ts:
    -- letters and digits only, uppercased, and anything left outside two to
    -- eight characters falls back to the default. At the moment this file is
    -- first applied matter_prefix is null for every firm (it is created a few
    -- lines above), so in practice this is 'MAT' everywhere; it is written
    -- out properly so that a re-run after a firm has chosen a prefix numbers
    -- new rows under the prefix that firm actually uses.
    case
      when length(regexp_replace(upper(coalesce(fs.matter_prefix, '')), '[^A-Z0-9]', '', 'g'))
             between 2 and 8
        then regexp_replace(upper(fs.matter_prefix), '[^A-Z0-9]', '', 'g')
      else 'MAT'
    end as prefix,
    coalesce(t.max_seq, 0)
      + row_number() over (
          partition by c.firm_id
          order by c.created_at, c.id
        ) as seq
  from public.cases c
  left join public.firm_settings fs on fs.firm_id = c.firm_id
  left join taken t on t.firm_id = c.firm_id
  where c.firm_id is not null
    and c.matter_number is null
)
update public.cases c
set matter_number = n.prefix || '-' || lpad(n.seq::text, 7, '0')
from numbered n
where c.id = n.id
  -- The stop at the end of the series, the same one nextTicketSeq enforces.
  -- A firm past ten million matters leaves the overflow rows null rather
  -- than growing an eighth digit, which would sort below every seven-digit
  -- number and make the allocator start handing out numbers already in use.
  and n.seq <= 9999999;

-- The reason the allocator's retry loop is an allocator and not a
-- suggestion. Two people opening a matter at the same moment read the same
-- highest number and compute the same next one; this index decides which
-- write wins, and the loser bumps and takes the next.
--
-- PER FIRM, NOT GLOBAL. The prefix is the firm's own, so two firms both
-- holding MAT-0000001 is expected and correct. Nothing resolves a matter by
-- its reference alone: every route, link and lookup in the product keys on
-- the case uuid, and the one place the reference is used to select
-- (the matter list's Ref column filter) already runs inside one firm's rows.
--
-- Partial, so the rows with no number do not all collide on null.
create unique index if not exists cases_matter_number_idx
  on public.cases (firm_id, matter_number)
  where matter_number is not null;
