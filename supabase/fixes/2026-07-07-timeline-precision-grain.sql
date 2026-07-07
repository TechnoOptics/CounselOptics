-- Smart timeline picker: widen occurred_precision to fine grains
-- (seconds -> months). Purely additive: every previously-allowed value stays
-- valid, so all existing rows remain conformant. occurred_at is already
-- timestamptz, so the finer grains need no column change, only a relaxed
-- display-precision check.
--
-- Applied to production 2026-07-07 via the Supabase MCP; committed here for
-- source tracking. Idempotent (drop-if-exists then add).

alter table public.case_timeline_events
  drop constraint if exists case_timeline_events_occurred_precision_check;

alter table public.case_timeline_events
  add constraint case_timeline_events_occurred_precision_check
  check (occurred_precision in (
    'second','minute','hour','exact','day','week','month','year','unknown'
  ));
