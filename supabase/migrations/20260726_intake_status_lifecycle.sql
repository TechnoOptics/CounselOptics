-- The intake status check predated the partner lifecycle: it allowed only
-- 'in_progress' and 'conflict_check_passed', so convertIntakeToCaseAction's
-- UPDATE to 'converted' failed silently (the Supabase client error was
-- unchecked) and the partner webhook then reported the stale row. This
-- widens the whitelist to the full documented lifecycle.
ALTER TABLE public.firm_matter_intakes DROP CONSTRAINT firm_matter_intakes_status_check;
ALTER TABLE public.firm_matter_intakes ADD CONSTRAINT firm_matter_intakes_status_check
  CHECK (status = ANY (ARRAY[
    'in_progress'::text,
    'conflict_check_passed'::text,
    'conflict_check_flagged'::text,
    'engaged'::text,
    'converted'::text,
    'rejected'::text,
    'closed'::text
  ]));
