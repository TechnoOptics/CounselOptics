import { redirect } from 'next/navigation';
import { getActiveFirmContext, listChannelsForUser } from '@/lib/firm-storage';
import { ChatShell } from './chat-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Chat · Counsel' };

export default async function CounselChatPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const channels = await listChannelsForUser(ctx.firm.id);

  return (
    <div className="space-y-4 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Chat</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Team conversations
        </h1>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1">
          Real-time via Supabase WebSockets. Messages, edits, and deletes propagate in ~100ms; a 60-second heartbeat refetch covers any dropped event.
        </p>
      </header>
      <ChatShell firmId={ctx.firm.id} initialChannels={channels} userId={ctx.membership.userId} />
    </div>
  );
}
