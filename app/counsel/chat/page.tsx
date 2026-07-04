import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listChannelsForUser,
  ensureFirmTeamChannel,
} from '@/lib/firm-storage';
import { ChatShell } from './chat-shell';
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
      <header className="flex-none">
        <p className="eyebrow mb-1"><T>Chat</T></p>
        <h1 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Team conversations</T>
        </h1>
        <p className="hidden sm:block text-[12px] text-ink-500 dark:text-cream-100/55 mt-1">
          <T>Real-time via Supabase WebSockets. Messages, edits, and deletes propagate in ~100ms; a 60-second heartbeat refetch covers any dropped event.</T>
        </p>
      </header>
      <div className="flex-1 min-h-0">
        <ChatShell firmId={ctx.firm.id} initialChannels={channels} userId={ctx.membership.userId} />
      </div>
    </div>
  );
}
