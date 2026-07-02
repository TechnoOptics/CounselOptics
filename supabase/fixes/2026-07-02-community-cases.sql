-- 2026-07-02: Community Case pages (v1 - evidence submissions only).
--
-- Lets a paid, verified Advottic user turn one of their own `cases` rows
-- into a public, shareable page so the community can rally support (bond
-- fundraising links, a public story, bond amount / hearing date) and submit
-- evidence or testimonials. Letters of Support with ID/signature capture are
-- a later slice - this migration only carries the `evidence` submission kind,
-- but the shape (kind check constraint, submitter_* audit columns) already
-- anticipates it so a follow-up migration only needs to add columns, not
-- restructure tables.
--
-- Security posture (see docs/compliance/policies/risk-register.md - this
-- feature is the first surface that accepts uploads/PII from anonymous,
-- unauthenticated members of the public):
--   * witness_submissions has NO RLS policies for anon/authenticated at all.
--     Every public write goes through a server action using the service-role
--     client (mirrors app/api/firm/sign/route.ts), so there is no PostgREST
--     policy to misconfigure - the whole write surface is server code.
--   * community_cases has no public SELECT policy either. The public page
--     reads through the get_public_community_case() SECURITY DEFINER RPC
--     below, which returns an explicit, narrow column allowlist. A future
--     column added to community_cases can't leak by accident - someone has
--     to consciously add it to the RPC.
--   * Organizer/attorney access reuses a new private.is_case_owner_or_attorney()
--     helper (narrower than the existing private.is_case_member() - viewer/
--     editor collaborators on the underlying case do NOT get witness-PII
--     access, only the owner and attorney-role collaborators do).

------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------

create table if not exists public.community_cases (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.cases(id) on delete cascade,
  organizer_user_id uuid not null references auth.users(id) on delete cascade,
  case_number text not null unique,
  slug text not null unique,
  display_name text not null,
  public_summary text,
  bond_amount_cents integer,
  hearing_display_override text,
  banner_image_path text,
  status text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  search_indexable boolean not null default false,
  letter_count integer not null default 0,
  evidence_count integer not null default 0,
  published_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_cases_organizer_idx
  on public.community_cases (organizer_user_id);

create table if not exists public.community_case_links (
  id uuid primary key default gen_random_uuid(),
  community_case_id uuid not null references public.community_cases(id) on delete cascade,
  platform text not null check (platform in ('gofundme', 'cashapp', 'zelle', 'venmo', 'paypal', 'other')),
  label text,
  url text,
  handle text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  -- Link-outs only, on purpose: this feature never processes or holds
  -- funds, so there is deliberately no amount/ledger column here.
  constraint community_case_links_url_or_handle check (url is not null or handle is not null)
);

create index if not exists community_case_links_case_idx
  on public.community_case_links (community_case_id, sort_order);

create table if not exists public.witness_submissions (
  id uuid primary key default gen_random_uuid(),
  community_case_id uuid not null references public.community_cases(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  kind text not null check (kind in ('letter_of_support', 'evidence')),
  full_name text,
  mailing_address jsonb,
  letter_body text,
  signature_image_path text,
  id_front_path text,
  id_back_path text,
  id_front_sha256 text,
  id_back_sha256 text,
  evidence_file_path text,
  evidence_file_name text,
  evidence_file_type text,
  evidence_file_size bigint,
  testimonial_text text,
  status text not null default 'received' check (
    status in ('received', 'reviewed', 'flagged', 'pending_purge', 'purged')
  ),
  submitter_ip text,
  submitter_user_agent text,
  consent_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists witness_submissions_community_case_idx
  on public.witness_submissions (community_case_id, created_at desc);
create index if not exists witness_submissions_case_idx
  on public.witness_submissions (case_id);

create table if not exists public.witness_submission_events (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.witness_submissions(id) on delete cascade,
  event_type text not null check (
    event_type in ('submitted', 'viewed_by_organizer', 'exported', 'flagged', 'purge_scheduled', 'purged')
  ),
  actor_user_id uuid references auth.users(id) on delete set null,
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  prev_event_hash text,
  event_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists witness_submission_events_submission_idx
  on public.witness_submission_events (submission_id, created_at asc);

------------------------------------------------------------
-- 2. Aggregate-count trigger (letter_count / evidence_count)
------------------------------------------------------------
-- Denormalized on community_cases so the public RPC never has to run a
-- row-returning join against the sensitive witness_submissions table just
-- to show "14 letters of support".

create or replace function public.bump_community_case_counts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    if new.kind = 'letter_of_support' then
      update public.community_cases set letter_count = letter_count + 1 where id = new.community_case_id;
    else
      update public.community_cases set evidence_count = evidence_count + 1 where id = new.community_case_id;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    if old.kind = 'letter_of_support' then
      update public.community_cases set letter_count = greatest(0, letter_count - 1) where id = old.community_case_id;
    else
      update public.community_cases set evidence_count = greatest(0, evidence_count - 1) where id = old.community_case_id;
    end if;
    return old;
  end if;
  return null;
end;
$$;

-- Trigger-only function - must never be callable directly via PostgREST
-- RPC. CREATE FUNCTION grants EXECUTE to PUBLIC by default; triggers run
-- with the function owner's privileges regardless of role grants, so this
-- revoke does not break the trigger below, only closes the direct-RPC path.
revoke execute on function public.bump_community_case_counts() from public, anon, authenticated;

drop trigger if exists witness_submissions_bump_counts on public.witness_submissions;
create trigger witness_submissions_bump_counts
  after insert or delete on public.witness_submissions
  for each row execute function public.bump_community_case_counts();

drop trigger if exists community_cases_set_updated_at on public.community_cases;
create trigger community_cases_set_updated_at
  before update on public.community_cases
  for each row execute function public.set_updated_at();

------------------------------------------------------------
-- 3. RLS
------------------------------------------------------------

alter table public.community_cases enable row level security;
alter table public.community_case_links enable row level security;
alter table public.witness_submissions enable row level security;
alter table public.witness_submission_events enable row level security;

-- Narrower than private.is_case_member(): only the case owner or an
-- attorney-role collaborator, never viewer/editor. This is the gate for
-- everything witness-PII-related.
create or replace function private.is_case_owner_or_attorney(_case_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    exists (select 1 from public.cases where id = _case_id and user_id = auth.uid())
    or exists (
      select 1 from public.case_collaborators
      where case_id = _case_id and user_id = auth.uid() and role = 'attorney'
    );
$$;

revoke execute on function private.is_case_owner_or_attorney(uuid) from public;
grant execute on function private.is_case_owner_or_attorney(uuid) to authenticated;

-- community_cases: NO public select policy on the base table (see the RPC
-- below). Owner/attorney get full-row access; only the organizer (owner)
-- may create/edit/publish/close - attorney collaborators can view but the
-- public page's claims stay single-authored.
drop policy if exists "community_cases_select_owner_or_attorney" on public.community_cases;
create policy "community_cases_select_owner_or_attorney"
  on public.community_cases for select
  using (private.is_case_owner_or_attorney(case_id));

drop policy if exists "community_cases_insert_owner" on public.community_cases;
create policy "community_cases_insert_owner"
  on public.community_cases for insert
  with check (private.is_case_owner(case_id) and organizer_user_id = auth.uid());

drop policy if exists "community_cases_update_owner" on public.community_cases;
create policy "community_cases_update_owner"
  on public.community_cases for update
  using (private.is_case_owner(case_id))
  with check (private.is_case_owner(case_id));

-- community_case_links: same visibility as the parent page's private view;
-- the PUBLIC read of links happens via the RPC, not this policy.
drop policy if exists "community_case_links_select" on public.community_case_links;
create policy "community_case_links_select"
  on public.community_case_links for select
  using (
    exists (
      select 1 from public.community_cases cc
      where cc.id = community_case_id and private.is_case_owner_or_attorney(cc.case_id)
    )
  );

drop policy if exists "community_case_links_write" on public.community_case_links;
create policy "community_case_links_write"
  on public.community_case_links for all
  using (
    exists (
      select 1 from public.community_cases cc
      where cc.id = community_case_id and private.is_case_owner(cc.case_id)
    )
  )
  with check (
    exists (
      select 1 from public.community_cases cc
      where cc.id = community_case_id and private.is_case_owner(cc.case_id)
    )
  );

-- witness_submissions / witness_submission_events: deliberately NO policies
-- for anon or authenticated beyond the owner/attorney SELECT below. There is
-- no INSERT policy at all - public submissions are written exclusively by
-- the service-role client from a server action (bypasses RLS entirely),
-- exactly like app/api/firm/sign/route.ts writes firm_signatures.
drop policy if exists "witness_submissions_select_owner_or_attorney" on public.witness_submissions;
create policy "witness_submissions_select_owner_or_attorney"
  on public.witness_submissions for select
  using (private.is_case_owner_or_attorney(case_id));

drop policy if exists "witness_submission_events_select_owner_or_attorney" on public.witness_submission_events;
create policy "witness_submission_events_select_owner_or_attorney"
  on public.witness_submission_events for select
  using (
    exists (
      select 1 from public.witness_submissions ws
      where ws.id = submission_id and private.is_case_owner_or_attorney(ws.case_id)
    )
  );

------------------------------------------------------------
-- 4. Public read RPC (the only way the public page reads community_cases)
------------------------------------------------------------
-- Explicit column allowlist. Adding a new sensitive column to
-- community_cases later does NOT expose it here automatically - it has to
-- be added to this SELECT list on purpose.

create or replace function public.get_public_community_case(_slug text)
returns table (
  case_number text,
  slug text,
  display_name text,
  public_summary text,
  bond_amount_cents integer,
  hearing_display_override text,
  banner_image_path text,
  status text,
  letter_count integer,
  evidence_count integer,
  published_at timestamptz,
  closed_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    cc.case_number,
    cc.slug,
    cc.display_name,
    cc.public_summary,
    cc.bond_amount_cents,
    cc.hearing_display_override,
    cc.banner_image_path,
    cc.status,
    cc.letter_count,
    cc.evidence_count,
    cc.published_at,
    cc.closed_at
  from public.community_cases cc
  where cc.slug = _slug and cc.status in ('published', 'closed');
$$;

revoke execute on function public.get_public_community_case(text) from public;
grant execute on function public.get_public_community_case(text) to anon, authenticated;

-- Same allowlist treatment for the fundraising links - public may read
-- links only for a published/closed page, and only these columns.
create or replace function public.get_public_community_case_links(_slug text)
returns table (
  platform text,
  label text,
  url text,
  handle text,
  sort_order int
)
language sql
security definer
stable
set search_path = public
as $$
  select l.platform, l.label, l.url, l.handle, l.sort_order
  from public.community_case_links l
  join public.community_cases cc on cc.id = l.community_case_id
  where cc.slug = _slug and cc.status in ('published', 'closed')
  order by l.sort_order asc;
$$;

revoke execute on function public.get_public_community_case_links(text) from public;
grant execute on function public.get_public_community_case_links(text) to anon, authenticated;

------------------------------------------------------------
-- 5. Storage bucket for community submissions
------------------------------------------------------------
-- Deliberately separate from the `exhibits` bucket: exhibits' policies key
-- off (storage.foldername(name))[1] = auth.uid()::text, which doesn't exist
-- for anonymous submitters. No SELECT/INSERT policy is defined for
-- anon/authenticated here on purpose - all reads go through short-TTL
-- signed URLs minted server-side after an is_case_owner_or_attorney check,
-- and all writes go through the service-role client. Path convention:
-- community-submissions/<case_id>/<submission_id>/evidence/<filename>
-- (and, once Letters of Support ship, .../id-front.*, id-back.*, signature.png).

insert into storage.buckets (id, name, public)
  values ('community-submissions', 'community-submissions', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('community-public', 'community-public', true)
  on conflict (id) do nothing;

-- community-public holds only banner/gallery images the organizer chose to
-- publish - safe to be a public bucket. Insert still goes through the
-- service-role client (organizer-facing server action), so no anon/authenticated
-- write policy is needed; read is public via getPublicUrl.
