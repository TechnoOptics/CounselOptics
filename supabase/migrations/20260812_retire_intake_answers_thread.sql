-- Retire the legacy `intake_answers.thread` jsonb array.
--
-- NOT YET APPLIED. Written to be reviewed and run by hand; see the checklist
-- at the bottom.
--
-- 20260727_intake_conversation.sql moved the request conversation into
-- public.firm_intake_messages and backfilled every jsonb thread into it, but
-- it never removed the source array. Each pre-2026-07-27 request therefore
-- still carries a frozen copy of its conversation under
-- `intake_answers.thread`. The copy looks live and is not: it stopped at the
-- moment of the backfill.
--
-- That is not a hypothetical. The partner reminder sweep read it, found the
-- last message it held, and nagged firms' legal teams forever
-- (app/api/cron/partner-reminders/route.ts, fixed on branch fix/w2).
-- lib/portal-open-requests.ts had already hit the same thing on the
-- employee's side. Every reader that finds this field reads stale data and
-- has no way to tell.
--
-- Two steps, in this order, because deleting first would lose messages:
--
--   1. LIFT anything the 20260727 backfill did not take. Its guard was
--      per-request ("skip this request if it has any message row at all"),
--      so a message appended to the array AFTER that migration ran was never
--      copied - and one writer kept appending until the fix on this branch:
--      lib/firm-actions.ts wrote the "meeting scheduled / join link" note
--      into the array. Those notes exist ONLY in the jsonb. Dropping the key
--      without lifting them first would delete the join link out of a
--      requester's conversation.
--
--   2. DROP the key, per request, only where every element of that request's
--      array is now provably present in firm_intake_messages. A request that
--      fails the check keeps its array and is named in a NOTICE, so the
--      failure is something a person looks at rather than data that quietly
--      disappears.
--
-- Data only: no DDL, so supabase/schema-fingerprint.sha256 does not change.
--
-- Idempotent: re-running is a no-op. Step 1 matches on (intake, body,
-- created_at) so nothing is lifted twice, and step 2 has already removed the
-- key from every request that passed.

do $$
declare
  lifted int;
  cleared int;
  stragglers text;
begin
  -- ── 1. lift the messages the backfill missed ────────────────────────────
  -- Same column mapping as the 20260727 backfill, deliberately: a message
  -- lifted now must be indistinguishable from one lifted then.
  with candidates as (
    select
      i.id as intake_id,
      i.firm_id,
      case when m->>'byUserId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           then (m->>'byUserId')::uuid else null end as author_user_id,
      coalesce(nullif(m->>'name', ''), 'Someone') as author_name,
      case when m->>'role' = 'legal' then 'legal' else 'employee' end as author_role,
      coalesce(m->>'text', '') as body,
      coalesce((m->>'at')::timestamptz, i.created_at) as created_at
    from public.firm_matter_intakes i
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(i.intake_answers->'thread') = 'array'
           then i.intake_answers->'thread' else '[]'::jsonb end
    ) as m
  )
  insert into public.firm_intake_messages
    (intake_id, firm_id, author_user_id, author_name, author_role, visibility, body, kind, created_at)
  select
    c.intake_id, c.firm_id, c.author_user_id, c.author_name, c.author_role,
    'shared', c.body, 'message', c.created_at
  from candidates c
  where not exists (
    select 1 from public.firm_intake_messages x
    where x.intake_id = c.intake_id
      and x.body = c.body
      and x.created_at = c.created_at
  );
  get diagnostics lifted = row_count;

  -- ── 2. drop the key where the table provably holds the whole array ──────
  with verified as (
    select i.id
    from public.firm_matter_intakes i
    where jsonb_typeof(i.intake_answers->'thread') = 'array'
      and not exists (
        select 1
        from jsonb_array_elements(i.intake_answers->'thread') as m
        where not exists (
          select 1 from public.firm_intake_messages x
          where x.intake_id = i.id
            and x.body = coalesce(m->>'text', '')
            and x.created_at = coalesce((m->>'at')::timestamptz, i.created_at)
        )
      )
  )
  update public.firm_matter_intakes i
     set intake_answers = i.intake_answers - 'thread'
    -- updated_at is deliberately NOT touched: the counsel inbox and the
    -- portal both sort on it, and a maintenance pass must not reorder every
    -- firm's queue or make a two-year-old request look like it just moved.
   where i.id in (select id from verified);
  get diagnostics cleared = row_count;

  -- ── 3. report anything left behind, by name ─────────────────────────────
  -- Two ways to survive step 2: an element with no matching row (the lift in
  -- step 1 should have made this empty), or a `thread` key that is not an
  -- array at all, which nothing in this repo ever wrote and which is left
  -- untouched rather than guessed at.
  select string_agg(id::text, ', ' order by id)
    into stragglers
    from public.firm_matter_intakes
   where intake_answers ? 'thread';

  raise notice 'intake thread retire: lifted % message(s), cleared % request(s)', lifted, cleared;
  if stragglers is not null then
    raise notice 'intake thread retire: still carrying a thread key, look at these by hand: %', stragglers;
  end if;
end $$;

-- ── applying this ─────────────────────────────────────────────────────────
-- 1. Merge the lib/firm-actions.ts fix FIRST. It is the last writer of the
--    array; running this while that writer is live just recreates the key on
--    the next scheduled meeting.
-- 2. Run against staging, read the NOTICEs, confirm `lifted` matches what you
--    expect and the straggler list is empty.
-- 3. Run in production, then confirm nothing is left:
--      select count(*) from public.firm_matter_intakes
--       where intake_answers ? 'thread';   -- expect 0
-- 4. No fingerprint regeneration: this changes rows, not schema.
