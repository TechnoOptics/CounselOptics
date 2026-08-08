import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listChannelsForUser,
  ensureFirmTeamChannel,
} from '@/lib/firm-storage';
import { ChatShell } from './chat-shell';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chat · Counsel' };

export default async function CounselChatPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  // Guarantee a shared team channel everyone on the legal team is in
  // (and pull in any members added since they last opened chat) so
  // the department can actually communicate out of the box.
  await ensureFirmTeamChannel(ctx.firm.id, ctx.membership.userId);
  const channels = await listChannelsForUser(ctx.firm.id);

  return (
    <div className="flex flex-col gap-4 animate-fade-up h-[calc(100dvh-9.5rem)] min-h-[28rem]">
      {/* The blurb goes through `children`, not `subtitle`: it is
          infrastructure fine print at 12px, and running it at subtitle
          size would make it the loudest thing on a page budgeted to fit
          one screen. Hidden under sm for the same reason. */}
      <PageHeader
        className="flex-none"
        eyebrow={<T>Chat</T>}
        title={<T>Team conversations</T>}
      >
        <p className="hidden sm:block text-[12px] text-muted mt-1">
          <T>Real-time via Supabase WebSockets. Messages, edits, and deletes propagate in ~100ms; a 60-second heartbeat refetch covers any dropped event.</T>
        </p>
      </PageHeader>
      <div className="flex-1 min-h-0">
        <ChatShell firmId={ctx.firm.id} initialChannels={channels} userId={ctx.membership.userId} />
      </div>
    </div>
  );
}
