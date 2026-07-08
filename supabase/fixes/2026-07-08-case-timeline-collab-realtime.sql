-- 2026-07-08  Case timeline collaboration: enable Realtime
--
-- The timeline collaboration surfaces (section comments + chat/presence, see
-- 2026-07-08-case-timeline-collab.sql) subscribe to postgres_changes on these
-- two tables from the authed browser client. For those events to be delivered,
-- the tables must belong to the `supabase_realtime` publication. RLS still
-- applies to Realtime, so subscribers only receive rows their SELECT policy
-- admits (general room + their own DMs / case + firm members).
--
-- Publication membership is NOT part of the schema fingerprint, so this does
-- not require a fingerprint regeneration. Idempotent.

do $$
begin
  begin
    alter publication supabase_realtime add table public.case_section_comments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.case_chat_messages;
  exception when duplicate_object then null;
  end;
end $$;
