-- Intake form builder: request types, forms, immutable published versions,
-- and the version binding on a submitted intake.
--
-- ============================ NOT YET APPLIED ============================
-- Written 2026-08-01. NOT applied to production. The owner applies it after
-- review. Re-run the two verification queries below immediately before
-- applying, because the backfill row count depends on live data.
-- =========================================================================
--
-- What this is for (docs/superpowers/specs/2026-08-01-intake-form-builder-design.md):
-- request types are a hardcoded array of 12 in
-- app/counsel/intake/create-intake-form.tsx, and the questions asked on an
-- intake are a schema-less capped list in
-- firms.metadata.partnerIntegration.questions. Legal cannot add a question,
-- reword one, or retire a request type without a deploy. This migration adds
-- the storage the builder needs. It adds storage ONLY.
--
-- Behaviour after applying is identical for every firm, because nothing in
-- the application reads these tables yet and no form rows are created. Every
-- firm starts with zero forms and zero published versions, so both the
-- employee Hub and GET /api/partner/v1/config keep falling back to exactly
-- what they serve today.
--
-- Who is affected when this is applied:
--   * Nobody's access changes. This creates new tables and adds one nullable
--     column. It drops nothing, alters no existing policy, and rewrites no
--     existing row. The only write to an existing table is
--     `add column form_version_id`, which is NULL on every existing row.
--   * Every firm gains 12 seeded request types, plus one per distinct
--     partner-app slug seen on its own intakes. Nothing reads them yet.
--   * Firm members whose role is `paralegal` or `staff` can read the new
--     tables but cannot write them. Publishing a form changes what every
--     employee in the company is asked, so it is a settings change, not case
--     work. This mirrors FIRM_MANAGE_ROLES in lib/firm-authz.ts.
--
-- Two vocabularies, deliberately not merged
-- -----------------------------------------
-- Request types already exist in the data under two different naming
-- schemes, and the backfill has to seed both:
--
--   1. Intakes filed through Advottic's own form store the display string
--      itself, for example 'NDA review', in matter_type and in
--      intake_answers.request_type. They match a seeded type by comparing
--      that stored string to `label`, so the seeded label must be the value
--      string VERBATIM. `key` is a slug of it.
--   2. Tickets filed through /api/partner/v1/* carry a lowercase slug of the
--      partner's own choosing in matter_type and leave
--      intake_answers.request_type null. For these, `key` IS the join
--      between a projected form and an arriving ticket, so it is the slug
--      VERBATIM and the label is humanised from it.
--
-- Zinpro will therefore end up with BOTH `nda` (partner) and `nda_review`
-- (seeded default). They are not merged. Merging guesses at intent and the
-- two may genuinely be different requests. Legal hides the unused one in the
-- builder, which is a reversible one-click action; a bad merge is not.
--
-- Renaming a seeded label after this runs detaches that type from its
-- pre-existing intakes, because the counsel intake page reads the stored
-- string rather than resolving the type. Accepted, per the spec. `key` never
-- changes, so the partner join is unaffected by renames.
--
-- Before applying, confirm the backfill inputs
-- -------------------------------------------
-- 1. The partner vocabulary. Every row with via_partner = true becomes one
--    seeded type for that firm:
--
--      select i.matter_type,
--             (i.intake_answers->'partner'->>'externalId') is not null as via_partner,
--             count(*)
--        from public.firm_matter_intakes i
--       group by 1, 2 order by 3 desc;
--
--    As of 2026-08-01 this returned nda, hr, contract-review and incident
--    with via_partner = true (all Zinpro), plus 'Document for safekeeping'
--    with via_partner = false, which is one of the hardcoded 12 and is
--    seeded from source 1 rather than source 2.
--
-- 2. The number of firms, which multiplies the 12 defaults:
--
--      select count(*) from public.firms;
--
--    As of 2026-08-01 there were 3 firms (Advottic, ANDERSON ENTERPRISE,
--    Zinpro), so this migration inserts 3 * 12 = 36 default types plus 4
--    partner types for Zinpro = 40 rows in firm_request_types, 0 rows in
--    firm_intake_forms and 0 rows in firm_intake_form_versions.
--
-- If either count differs from the above, stop and confirm with the owner
-- before applying. This repo's convention is that data-touching migrations
-- are verified against live counts immediately before they run.
--
-- After applying, verify:
--   select key, label, mode from public.firm_request_types
--    order by firm_id, sort_order;
--   select count(*) from public.firm_intake_forms;         -- expect 0
--   select count(*) from public.firm_intake_form_versions; -- expect 0
--
-- Remember to regenerate supabase/schema-fingerprint.sha256 after applying,
-- or the CI drift gate fails on the next push.
--
-- Statement order below is load-bearing. Postgres validates a function body
-- at CREATE time, so a helper that queries firm_intake_forms cannot be
-- created before that table exists. Tables first, then the private helpers,
-- then the policies that call them.

begin;

-- ── 1. tables ─────────────────────────────────────────────────────────────

-- A request type is what an employee picks first: 'NDA review', 'HR'. It
-- carries a stable `key` and a freely renamed `label` precisely because
-- renaming must not orphan historical intakes.
create table if not exists public.firm_request_types (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- Written once, never edited. For partner-facing types this equals the
  -- partner's own slug exactly, and is the join with their vocabulary.
  key text not null check (length(trim(key)) > 0),
  -- What legal sees and edits. For the seeded defaults this starts as the
  -- exact string existing intakes already store.
  label text not null check (length(trim(label)) > 0),
  -- Not cosmetic: 'client' is an outside-client matter, 'inhouse' is an
  -- internal request. The intake form branches on it.
  mode text not null check (mode in ('client', 'inhouse')),
  sort_order int not null default 0,
  -- Retiring a type hides it from the picker without deleting history.
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (firm_id, key),
  -- Redundant on its own, but it is the target of the composite foreign key
  -- on firm_intake_forms below, which is what stops one firm attaching a
  -- form to another firm's request type.
  unique (firm_id, id)
);
create index if not exists firm_request_types_firm_idx
  on public.firm_request_types (firm_id, sort_order);
alter table public.firm_request_types enable row level security;

-- One form per request type per firm. The draft lives here rather than in
-- the versions table so an unfinished edit can never be mistaken for
-- something publishable, and discarding it is one UPDATE.
create table if not exists public.firm_intake_forms (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  request_type_id uuid not null,
  -- Builder scratch space. May be invalid; it is validated on publish, not
  -- on save, so a half-finished edit survives a page reload.
  draft_payload jsonb,
  -- FK added after firm_intake_form_versions exists, below.
  published_version_id uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (firm_id, request_type_id),
  -- Composite rather than a plain reference to firm_request_types(id): the
  -- INSERT policy can only check the firm_id being written, so a plain FK
  -- would let a firm attach a form to another firm's request type by id.
  -- This makes that unrepresentable in the database rather than a rule the
  -- application has to remember. Deleting a request type still cascades to
  -- its form.
  constraint firm_intake_forms_request_type_fkey
    foreign key (firm_id, request_type_id)
    references public.firm_request_types (firm_id, id) on delete cascade
);
create index if not exists firm_intake_forms_firm_idx
  on public.firm_intake_forms (firm_id);
alter table public.firm_intake_forms enable row level security;

-- An immutable snapshot of a form at publish time. Never updated, never
-- deleted on its own. A submitted intake binds to one of these so reopening
-- an old request shows the questions that were actually asked, in the order
-- asked, in the wording used.
create table if not exists public.firm_intake_form_versions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null
    references public.firm_intake_forms(id) on delete cascade,
  version int not null check (version > 0),
  -- Validated by lib/form-schema.ts before insert. Not validated here: the
  -- invariants (forward references, unique question keys, row width) are not
  -- expressible as a sane CHECK, and duplicating them would let the two
  -- drift.
  payload jsonb not null,
  published_at timestamptz not null default now(),
  published_by uuid,
  unique (form_id, version)
);
create index if not exists firm_intake_form_versions_form_idx
  on public.firm_intake_form_versions (form_id, version desc);
alter table public.firm_intake_form_versions enable row level security;

-- The two references between forms and versions point in opposite
-- directions, so neither may cascade into the other: deleting a form
-- cascades to its versions, and this one only nulls the pointer.
do $$ begin
  alter table public.firm_intake_forms
    add constraint firm_intake_forms_published_version_fkey
    foreign key (published_version_id)
    references public.firm_intake_form_versions(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Which version a submitted intake was filled on. Nullable because every
-- existing intake predates this feature, and stays nullable for tickets from
-- partner apps that do not echo the version back.
--
-- `on delete set null` rather than restrict: deleting a form is a legitimate
-- builder action, and it must not be blocked forever by the first request
-- ever filed on it. Losing the binding degrades an old intake to exactly
-- today's behaviour rather than to nothing, because
-- intake_answers.questionAnswers still snapshots {id, label, value} per
-- answer. That snapshot is why this is safe; do not remove it.
alter table public.firm_matter_intakes
  add column if not exists form_version_id uuid
  references public.firm_intake_form_versions(id) on delete set null;
create index if not exists firm_matter_intakes_form_version_idx
  on public.firm_matter_intakes (form_version_id)
  where form_version_id is not null;

-- ── 2. helpers (security definer, so policies cannot recurse) ─────────────
-- These must come after the tables above: a function body is validated at
-- CREATE time.

-- The single place the write role set is written down. It mirrors
-- FIRM_MANAGE_ROLES in lib/firm-authz.ts, so the code gate and the database
-- gate agree. paralegal and staff are excluded on purpose.
create or replace function private.can_manage_intake_forms(_firm_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select private.is_firm_member_with_role(
    _firm_id, auth.uid(), array['owner', 'admin', 'attorney']
  );
$$;

-- firm_intake_form_versions carries no firm_id of its own, on purpose: the
-- form owns it and there is only one place the firm can come from.
create or replace function private.intake_form_firm_id(_form_id uuid)
returns uuid language sql stable security definer set search_path to 'public' as $$
  select f.firm_id from public.firm_intake_forms f where f.id = _form_id;
$$;

-- ── 3. policies ───────────────────────────────────────────────────────────
-- SELECT for any firm member. INSERT, UPDATE and DELETE for owner, admin and
-- attorney only. A null firm_id from intake_form_firm_id fails both closed,
-- because no firm_members row can match a null firm.

do $$ begin
  create policy firm_request_types_select on public.firm_request_types
    for select to authenticated
    using (private.is_firm_member(firm_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_request_types_insert on public.firm_request_types
    for insert to authenticated
    with check (private.can_manage_intake_forms(firm_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_request_types_update on public.firm_request_types
    for update to authenticated
    using (private.can_manage_intake_forms(firm_id))
    with check (private.can_manage_intake_forms(firm_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_request_types_delete on public.firm_request_types
    for delete to authenticated
    using (private.can_manage_intake_forms(firm_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_intake_forms_select on public.firm_intake_forms
    for select to authenticated
    using (private.is_firm_member(firm_id, auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_intake_forms_insert on public.firm_intake_forms
    for insert to authenticated
    with check (private.can_manage_intake_forms(firm_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_intake_forms_update on public.firm_intake_forms
    for update to authenticated
    using (private.can_manage_intake_forms(firm_id))
    with check (private.can_manage_intake_forms(firm_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_intake_forms_delete on public.firm_intake_forms
    for delete to authenticated
    using (private.can_manage_intake_forms(firm_id));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_intake_form_versions_select on public.firm_intake_form_versions
    for select to authenticated
    using (private.is_firm_member(private.intake_form_firm_id(form_id), auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy firm_intake_form_versions_insert on public.firm_intake_form_versions
    for insert to authenticated
    with check (private.can_manage_intake_forms(private.intake_form_firm_id(form_id)));
exception when duplicate_object then null; end $$;

-- A published version is immutable. There is deliberately no UPDATE policy
-- and no DELETE policy: correcting a published form means publishing the next
-- version, which is the whole point of versioning. Republishing v3 must leave
-- v2 byte identical.
--
-- The DELETE policy was written and then removed on the owner's ruling
-- (2026-08-01). The task brief asked for delete on all three tables, but
-- delete-then-reinsert reproduces exactly what the absent UPDATE policy
-- forbids, and it would null form_version_id on any intake bound to that
-- version, silently detaching a submitted request from the questions it was
-- actually asked. Nothing operational is lost: deleting a form still cascades
-- to its versions, so only the delete-one-version path is gone.

-- ── 4. backfill source 1: the hardcoded 12, per firm ──────────────────────
-- Copied verbatim from REQUEST_TYPES in
-- app/counsel/intake/create-intake-form.tsx as of 2026-08-01. `label` is the
-- `value` string, NOT the picker's display `label`, because `value` is what
-- existing intakes store in matter_type and match on. `key` is a slug of the
-- same string, written out literally rather than computed, so that a reader
-- can check every key by eye and no regexp surprise can change one later.
--
-- Idempotent: re-running inserts nothing, because (firm_id, key) is unique.

insert into public.firm_request_types (firm_id, key, label, mode, sort_order)
select f.id, d.key, d.label, d.mode, d.sort_order
  from public.firms f
  cross join (values
    ('new_case_matter',        'New case / matter',        'client',   0),
    ('new_contract_agreement', 'New contract / agreement', 'inhouse',  1),
    ('internal_review_request','Internal review request',  'inhouse',  2),
    ('document_for_safekeeping','Document for safekeeping', 'inhouse', 3),
    ('trademark_ip_filing',    'Trademark / IP filing',    'inhouse',  4),
    ('nda_review',             'NDA review',               'inhouse',  5),
    ('vendor_msa_review',      'Vendor / MSA review',      'inhouse',  6),
    ('employment_matter',      'Employment matter',        'inhouse',  7),
    ('compliance_question',    'Compliance question',      'inhouse',  8),
    ('litigation_hold',        'Litigation hold',          'inhouse',  9),
    ('demand_letter',          'Demand letter',            'inhouse', 10),
    ('other',                  'Other',                    'inhouse', 11)
  ) as d(key, label, mode, sort_order)
on conflict (firm_id, key) do nothing;

-- ── 5. backfill source 2: partner slugs actually seen, per firm ───────────
-- One type per distinct matter_type observed on that firm's partner-filed
-- intakes. `key` is the slug verbatim, because it is the join with the
-- partner app: a projected form and an arriving ticket meet on this string.
--
-- `label` is humanised only as a starting point. Legal renames it freely and
-- renaming cannot break anything, since the join is on `key`.
--
-- `mode` is 'inhouse' for all of them: a partner-app ticket is filed by the
-- company's own employee, which is by definition an internal request rather
-- than an outside-client matter.
--
-- Runs after source 1 so that a partner slug which happens to collide with a
-- seeded key (for example 'other') loses to the canonical seeded label.
-- Near duplicates such as `nda` and `nda_review` are left as two rows on
-- purpose. Do not add merging here.

insert into public.firm_request_types (firm_id, key, label, mode, sort_order)
select
  s.firm_id,
  s.slug,
  h.label,
  'inhouse',
  100 + (row_number() over (partition by s.firm_id order by s.slug))::int
from (
  select distinct i.firm_id, trim(i.matter_type) as slug
    from public.firm_matter_intakes i
   where (i.intake_answers->'partner'->>'externalId') is not null
     and nullif(trim(coalesce(i.matter_type, '')), '') is not null
) s
cross join lateral (
  select string_agg(
           -- Known acronyms stay uppercase, so 'nda' reads as NDA rather
           -- than Nda. Anything not listed is title cased.
           case when lower(t.tok) in ('nda','hr','ip','msa','sow','dpa','llc','sla','poa','it')
                then upper(t.tok)
                else initcap(t.tok) end,
           ' ' order by t.ord
         ) as label
    from regexp_split_to_table(
           regexp_replace(s.slug, '[-_]+', ' ', 'g'), '\s+'
         ) with ordinality as t(tok, ord)
   where t.tok <> ''
) h
on conflict (firm_id, key) do nothing;

-- No rows are inserted into firm_intake_forms or firm_intake_form_versions.
-- Every firm starts with nothing published, which is what makes this
-- migration invisible to users.

commit;
