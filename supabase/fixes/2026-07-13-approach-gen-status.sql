-- Background generation status for the firm approach builder.
--
-- The approach re-run deep-reads the whole matter and calls the model, taking
-- roughly three minutes. That exceeds a single serverless request budget, so
-- generation now runs AFTER the response is sent (Next unstable_after) and the
-- client polls for completion. These columns carry that job state and let a
-- run survive a page reload while it is still assembling.
--
-- Idempotent: safe to re-run.

alter table public.case_approaches
  add column if not exists gen_status text not null default 'idle',
  add column if not exists gen_error text,
  add column if not exists gen_started_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'case_approaches_gen_status_chk'
  ) then
    alter table public.case_approaches
      add constraint case_approaches_gen_status_chk
      check (gen_status in ('idle','running','done','error'));
  end if;
end $$;

-- Existing rows that already hold an assembled argument are 'done'.
update public.case_approaches set gen_status = 'done' where generated is not null and gen_status = 'idle';
