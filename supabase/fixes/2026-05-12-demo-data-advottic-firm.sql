-- Demo seed for the Advottic firm.
--
-- Populates 4 realistic matters so the /counsel dashboard does not
-- render an empty state during the Monday demo. Idempotent: skips
-- the insert if at least one case already exists for the Advottic
-- firm, so re-running this file does NOT duplicate matters.
--
-- The firm and owner ids below are the ones created earlier in the
-- session:
--   Firm: Advottic (slug 'advottic', id 9974e74f-1d75-4ed0-8db2-ed4309f9a390)
--   Owner: contact@advottic.com (user_id 1bdc4239-cd20-4a4b-83ac-a7b6f2971e1b)
--
-- Hearing dates use NOW() + interval so the countdown UI on each
-- case shows a forward-looking number on demo day regardless of
-- when this migration was applied.
--
-- Run via: Supabase Dashboard -> SQL Editor -> paste & Run.

do $$
declare
  firm_uuid uuid := '9974e74f-1d75-4ed0-8db2-ed4309f9a390';
  owner_uuid uuid := '1bdc4239-cd20-4a4b-83ac-a7b6f2971e1b';
  existing_count int;
begin
  -- Idempotency guard: only seed when the firm has no cases yet.
  select count(*) into existing_count
  from public.cases
  where firm_id = firm_uuid;

  if existing_count > 0 then
    raise notice '[demo seed] Advottic firm already has % case(s); skipping.', existing_count;
    return;
  end if;

  -- Matter 1: family-court custody. Hearing in 11 days.
  insert into public.cases (
    firm_id, user_id, title, subject_name, subject_type, case_type,
    posture, description, status, hearing_at, hearing_location,
    hearing_notes, jurisdiction_country, jurisdiction_state,
    jurisdiction_city, subject_profile
  ) values (
    firm_uuid, owner_uuid,
    'Smith v. Smith - custody modification',
    'Sarah Smith',
    'person',
    'family_custody',
    'claimant',
    'Mother seeks modification of the 2024 custody order. Father moved to a new school district in March; primary residence has not been updated. Subject school year ends in 6 weeks. Plan to file Motion to Modify under Minn. Stat. 518.18 with a request for emergency relief on the school-enrollment question.',
    'open',
    now() + interval '11 days',
    'Hennepin County Family Court, Room 5C',
    'Hon. M. Reyes. Bring 2024 order + March move documentation + school enrollment communication.',
    'US', 'MN', 'Minneapolis',
    '{"dob":"1989-04-12","notes":"Joint legal, primary physical w/ mother"}'::jsonb
  );

  -- Matter 2: commercial lease dispute. Hearing in 23 days.
  insert into public.cases (
    firm_id, user_id, title, subject_name, subject_type, case_type,
    posture, description, status, hearing_at, hearing_location,
    hearing_notes, jurisdiction_country, jurisdiction_state,
    jurisdiction_city, subject_profile
  ) values (
    firm_uuid, owner_uuid,
    'Bridgewater Cafe v. Northgate Properties',
    'Bridgewater Cafe LLC',
    'business',
    'commercial_lease',
    'claimant',
    'Tenant LLC sued by landlord for unpaid rent April-June 2026. Defense: HVAC failure constituted constructive eviction; landlord ignored 4 written maintenance requests. Counterclaim for diminished beneficial use + repair costs. Discovery substantially complete.',
    'under_review',
    now() + interval '23 days',
    'Hennepin County District Court, Room 1701',
    'Hon. J. Lin. Conciliation calendar. Bring lease, payment ledger, maintenance request emails, HVAC repair invoices.',
    'US', 'MN', 'Minneapolis',
    '{"entityType":"LLC","yearFormed":2018}'::jsonb
  );

  -- Matter 3: employment - wrongful termination intake. No hearing yet.
  insert into public.cases (
    firm_id, user_id, title, subject_name, subject_type, case_type,
    posture, description, status, jurisdiction_country,
    jurisdiction_state, jurisdiction_city, subject_profile
  ) values (
    firm_uuid, owner_uuid,
    'Chen - wrongful termination intake',
    'Daniel Chen',
    'person',
    'employment_wrongful_termination',
    'claimant',
    'Plaintiff terminated 60 days after FMLA leave for spinal surgery. Documented PIP started 3 days after return-to-work request. Reviewing for FMLA retaliation + ADA failure-to-accommodate. EEOC charge window closes in 47 days.',
    'needs_evidence',
    'US', 'MN', 'Minneapolis',
    '{"yearsEmployed":7,"lastTitle":"Senior Software Engineer"}'::jsonb
  );

  -- Matter 4: estate planning - just opened. No hearing.
  insert into public.cases (
    firm_id, user_id, title, subject_name, subject_type, case_type,
    posture, description, status, jurisdiction_country,
    jurisdiction_state, jurisdiction_city, subject_profile
  ) values (
    firm_uuid, owner_uuid,
    'Anderson estate plan - revocable trust',
    'Anderson Family',
    'matter',
    'estate_planning',
    'claimant',
    'Married couple, two minor children. Drafting revocable living trust + pour-over wills + healthcare POAs + financial POAs. Real property in MN and a vacation cabin in WI; coordinate Wisconsin ancillary handling. Initial draft to client in 14 days.',
    'draft',
    'US', 'MN', 'Wayzata',
    '{"familySize":4,"hasMinorChildren":true,"crossState":["MN","WI"]}'::jsonb
  );

  raise notice '[demo seed] Inserted 4 demo matters for Advottic firm.';
end $$;
