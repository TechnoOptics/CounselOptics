-- Recurring-face detection for firm evidence (BIOMETRIC / special-category data).
--
-- Two tables:
--   1. firm_settings      - per-firm feature flags. Home of the explicit opt-in
--                           for recurring-face detection, OFF by default. NO faces
--                           are processed for a firm until recurring_faces_enabled
--                           is true. See docs/face-detection-spike.md and R14 in
--                           docs/compliance/policies/risk-register.md.
--   2. case_evidence_faces - one row per detected face: bounding box + a
--                           self-hosted embedding + a cluster assignment. This is
--                           biometric identifier data (BIPA / GDPR Art. 9). It is
--                           NEVER an identity claim - it only supports "the same
--                           face recurs in N photos".
--
-- Retention: case_evidence_faces cascades on delete from cases (purge with the
-- case). It is ALSO hard-deleted for a whole firm when the firm switches the
-- opt-in off, enforced in application code (lib/face-settings.ts). The self-hosted
-- embedding never leaves Advottic infrastructure - no third-party face API.
--
-- Access: like the rest of firm evidence, firm members are NOT case members, so
-- reads/writes go through the ADMIN client gated on firm membership + case.firm_id
-- (lib/face-actions.ts, mirroring lib/case-evidence-actions.ts). The RLS below is
-- the safe default: firm members manage their own firm_settings row directly, and
-- case_evidence_faces is locked to case members (the admin client bypasses RLS for
-- the firm path, exactly as case_timeline_events does).

-- ── firm_settings: per-firm flags (opt-in home) ──────────────────────
create table if not exists public.firm_settings (
  firm_id uuid primary key references public.firms(id) on delete cascade,
  -- Explicit, informed opt-in for biometric recurring-face detection. OFF by
  -- default. Turning it off purges the firm's face rows (see lib/face-settings.ts).
  recurring_faces_enabled boolean not null default false,
  -- When and by whom the opt-in was last toggled (audit trail for a biometric
  -- consent decision).
  recurring_faces_updated_at timestamptz,
  recurring_faces_updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.firm_settings enable row level security;

-- Any firm member can read their firm's settings; owner/admin can write them.
drop policy if exists firm_settings_member_select on public.firm_settings;
create policy firm_settings_member_select on public.firm_settings
  for select to authenticated
  using (exists (
    select 1 from public.firm_members fm
    where fm.firm_id = firm_settings.firm_id and fm.user_id = auth.uid()
  ));

drop policy if exists firm_settings_admin_write on public.firm_settings;
create policy firm_settings_admin_write on public.firm_settings
  for all to authenticated
  using (exists (
    select 1 from public.firm_members fm
    where fm.firm_id = firm_settings.firm_id and fm.user_id = auth.uid()
      and fm.role = any (array['owner','admin'])
  ))
  with check (exists (
    select 1 from public.firm_members fm
    where fm.firm_id = firm_settings.firm_id and fm.user_id = auth.uid()
      and fm.role = any (array['owner','admin'])
  ));

-- ── case_evidence_faces: detected faces (BIOMETRIC) ──────────────────
create table if not exists public.case_evidence_faces (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases(id) on delete cascade,
  -- The evidence event (photo) this face was found in.
  event_id    uuid not null references public.case_timeline_events(id) on delete cascade,
  -- The stored image object this crop comes from (path inside the exhibits bucket).
  media_path  text not null,
  -- Normalised bounding box { x, y, width, height } in 0..1 image coordinates,
  -- plus optional detector confidence: { x, y, width, height, score }.
  bbox        jsonb not null,
  -- Self-hosted face embedding as a JSON array of numbers (e.g. 128-d descriptor).
  -- Cosine distance over these vectors is what groups recurring faces. This is
  -- biometric identifier data; it is generated on Advottic infra and never sent
  -- to any third party.
  embedding   jsonb not null,
  -- Cluster this face was assigned to (a recurring-person group). Null until the
  -- clustering pass runs. NOT an identity - just "these crops look like the same
  -- face". A firm can merge/split clusters and attach its own private label.
  cluster_id  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists case_evidence_faces_case_idx
  on public.case_evidence_faces (case_id);
create index if not exists case_evidence_faces_event_idx
  on public.case_evidence_faces (event_id);
create index if not exists case_evidence_faces_cluster_idx
  on public.case_evidence_faces (case_id, cluster_id) where cluster_id is not null;

-- ── case_face_clusters: the recurring-person groups ──────────────────
-- One row per detected recurring person in a case. Holds the firm's optional
-- private label (a note, NOT an identity assertion) and which face is shown as
-- the group's representative crop.
create table if not exists public.case_face_clusters (
  id              uuid primary key default gen_random_uuid(),
  case_id         uuid not null references public.cases(id) on delete cascade,
  -- Firm's own private label for the group ("the neighbour", "witness B"). Never
  -- surfaced as an identity in analysis output. Null = unlabelled.
  label           text,
  -- The face row shown as this cluster's representative crop.
  representative_face_id uuid references public.case_evidence_faces(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists case_face_clusters_case_idx
  on public.case_face_clusters (case_id);

-- ── RLS: case-member scoped (firm path bypasses via the admin client) ─
alter table public.case_evidence_faces enable row level security;
alter table public.case_face_clusters  enable row level security;

drop policy if exists case_evidence_faces_member_all on public.case_evidence_faces;
create policy case_evidence_faces_member_all on public.case_evidence_faces
  for all to authenticated
  using (private.is_case_member(case_id))
  with check (private.is_case_member(case_id));

drop policy if exists case_face_clusters_member_all on public.case_face_clusters;
create policy case_face_clusters_member_all on public.case_face_clusters
  for all to authenticated
  using (private.is_case_member(case_id))
  with check (private.is_case_member(case_id));

-- NOTE: after applying this migration to the live DB, regenerate the schema
-- fingerprint or CI (schema-drift gate) will fail:
--   psql "$SUPABASE_DB_URL" -X -q -t -A -f scripts/schema/fingerprint-hash.sql \
--     | tr -d '[:space:]' > supabase/schema-fingerprint.sha256
