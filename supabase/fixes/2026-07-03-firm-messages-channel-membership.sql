-- 2026-07-03: track firm_messages RLS in version control.
--
-- firm_messages and its RLS policies were never added to this repo's
-- tracked SQL (no schema.sql entry, no prior fix file) even though the
-- table and policies already exist live - an audit couldn't confirm
-- from the codebase alone that reads are actually scoped to channel
-- members, only that the API route (app/api/firm/messages/route.ts)
-- trusted a client-supplied channelId with no local proof of a backstop.
--
-- This file formalizes the policies that are already live and correct
-- (verified directly against the database before writing this), so the
-- next person auditing this table has something to read. Written with
-- drop-then-create so it's safe to apply against the existing database
-- without erroring on "already exists".

drop policy if exists firm_messages_member_select on public.firm_messages;
create policy firm_messages_member_select
  on public.firm_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.firm_channel_members cm
      where cm.channel_id = firm_messages.channel_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists firm_messages_member_insert on public.firm_messages;
create policy firm_messages_member_insert
  on public.firm_messages
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.firm_channel_members cm
      where cm.channel_id = firm_messages.channel_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists firm_messages_author_update on public.firm_messages;
create policy firm_messages_author_update
  on public.firm_messages
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.firm_channels c
      join public.firm_members me on me.firm_id = c.firm_id
      where c.id = firm_messages.channel_id
        and me.user_id = auth.uid()
        and me.role = any (array['owner', 'admin'])
    )
  );
