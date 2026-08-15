'use client';

import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Live presence indicator for a case. Uses Supabase Realtime presence
 * channels keyed on `case:{id}` so every visitor automatically appears
 * to every other visitor without any server roundtrips after the
 * initial subscribe.
 *
 * Renders a horizontal stack of avatar chips. Each chip carries a
 * small green pulsing dot to signal "live". The current user is
 * always shown first; collaborators appear after. Hovering a chip
 * shows the display name.
 */

type Viewer = {
  presenceRef: string; // unique per browser tab
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  initials: string;
};

export function PresenceIndicator({
  caseId,
  me,
}: {
  caseId: string;
  me: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  };
}) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createBrowserClient>['channel']> | null>(null);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return; // local dev without supabase: no presence

    const supabase = createBrowserClient(url, anon);
    const channel = supabase.channel(`case:${caseId}`, {
      config: { presence: { key: me.userId } },
    });
    channelRef.current = channel;

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<Viewer>();
      const flat: Viewer[] = [];
      for (const ref of Object.keys(state)) {
        const slots = state[ref];
        for (const v of slots) flat.push(v);
      }
      // Deduplicate by user (multiple tabs = one chip), with the
      // current user always first.
      const byUser = new Map<string, Viewer>();
      for (const v of flat) {
        if (!byUser.has(v.userId)) byUser.set(v.userId, v);
      }
      const list = Array.from(byUser.values());
      list.sort((a, b) => {
        if (a.userId === me.userId) return -1;
        if (b.userId === me.userId) return 1;
        return a.displayName.localeCompare(b.displayName);
      });
      setViewers(list);
    });

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;
      await channel.track({
        presenceRef: `${me.userId}:${typeof crypto !== 'undefined' ? crypto.randomUUID() : Date.now()}`,
        userId: me.userId,
        displayName: me.displayName,
        avatarUrl: me.avatarUrl,
        initials: computeInitials(me.displayName),
      });
    });

    return () => {
      void channel.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  if (viewers.length === 0) return null;

  return (
    <div
      role="status"
      aria-label="People currently viewing this case"
      className="flex items-center gap-2 flex-wrap"
    >
      {/*
        ONE value, no `dark:` twin, and that is the honest spelling.
        This label only ever renders inside the case hero, which wears
        `hero-bg` - a forest gradient that is dark in BOTH themes. So there is
        no light value to give: cream is correct either way, and confirmed in
        a browser at 6.9:1 on the gradient it actually lands on.
        The twin it used to carry (`dark:text-cream-100/55`) was worse than
        redundant. tests/consumer-light-legibility.ts reads a `dark:text-*`
        twin as the author stating "the other one is my LIGHT value", so the
        pair made the sweep measure cream on the white page and report 1.05:1
        for text that was never on white. `hero-bg` paints through
        background-IMAGE, so nothing downstream can see the ground either.
      */}
      <span className="text-[10px] uppercase tracking-[0.22em] font-semibold text-cream-100/70">
        Viewing
      </span>
      <div className="flex -space-x-2">
        {viewers.map((v) => (
          <ViewerChip
            key={v.userId}
            viewer={v}
            isMe={v.userId === me.userId}
          />
        ))}
      </div>
    </div>
  );
}

function ViewerChip({ viewer, isMe }: { viewer: Viewer; isMe: boolean }) {
  return (
    <span
      title={isMe ? `${viewer.displayName} (you)` : viewer.displayName}
      className="presence-chip relative inline-flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-forest-950/80 bg-forest-800 text-cream-100 text-[10px] font-semibold tracking-tight overflow-visible"
    >
      {viewer.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={viewer.avatarUrl}
          alt=""
          className="h-7 w-7 rounded-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="leading-none">{viewer.initials}</span>
      )}
      {/* Green glowing pulse dot - the "live" cue */}
      <span
        aria-hidden
        className="presence-pulse absolute -bottom-0.5 -right-0.5 inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-forest-950"
      />
    </span>
  );
}

function computeInitials(name: string): string {
  const clean = (name ?? '').trim();
  if (!clean) return '··';
  if (clean.includes('@')) return clean.slice(0, 2).toUpperCase();
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '');
  return letters.slice(0, 2).toUpperCase() || clean.slice(0, 2).toUpperCase();
}
