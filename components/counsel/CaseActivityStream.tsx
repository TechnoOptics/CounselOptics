'use client';

import { useState, type ReactNode } from 'react';
import type { CaseActivityEvent } from '@/lib/case-activity-log';

/**
 * Firm-only activity feed for a matter: shows when an outside co-counsel (guest)
 * viewed the matter, opened a section, commented, or downloaded the packet. The
 * page gates this to the owner/admins; it is never shown to the guest.
 */

const ACTION_META: Record<
  string,
  { icon: ReactNode; verb: (detail: Record<string, unknown>) => string; tone: 'view' | 'act' | 'comment' | 'download' }
> = {
  view_matter: { icon: <EyeIcon />, verb: () => 'opened the matter', tone: 'view' },
  login: { icon: <EyeIcon />, verb: () => 'signed in', tone: 'view' },
  view_timeline: { icon: <ClockIcon />, verb: () => 'opened the timeline', tone: 'view' },
  view_evidence: { icon: <FolderIcon />, verb: () => 'opened the evidence files', tone: 'view' },
  open_section: {
    icon: <PanelIcon />,
    verb: (d) => (d.section ? `opened “${String(d.section)}”` : 'opened a section'),
    tone: 'act',
  },
  comment: {
    icon: <ChatIcon />,
    verb: (d) => (d.where ? `commented in ${String(d.where)}` : 'left a comment'),
    tone: 'comment',
  },
  download: { icon: <DownloadIcon />, verb: () => 'downloaded the packet', tone: 'download' },
  export: { icon: <DownloadIcon />, verb: () => 'downloaded the export packet', tone: 'download' },
  delete_evidence: {
    icon: <FolderIcon />,
    verb: (d) =>
      d.title ? `deleted evidence: ${String(d.title)}` : 'deleted evidence from the matter',
    tone: 'act',
  },
};

const KIND_LABEL: Record<string, string> = {
  guest: 'Co-counsel',
  client: 'Client',
  firm: 'Firm',
  other: 'Visitor',
};

export function CaseActivityStream({ events }: { events: CaseActivityEvent[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? events : events.slice(0, 12);

  return (
    <section className="rounded-xl border border-cream-50/10 bg-forest-900/30 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-medium text-cream-100">Activity</h2>
          <p className="mt-0.5 text-[12.5px] text-cream-100/55">
            Who’s been on this matter, visible only to your firm.
          </p>
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gold-metal/12 text-gold-metal ring-1 ring-gold-metal/25">
          <PulseIcon />
        </span>
      </div>

      {events.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-cream-50/12 px-4 py-6 text-center text-[13px] text-cream-100/45">
          No activity yet. When co-counsel signs in and works the matter, it shows up here.
        </p>
      ) : (
        <>
          <ol className="mt-4 space-y-1">
            {visible.map((e) => {
              const meta = ACTION_META[e.action] ?? {
                icon: <DotIcon />,
                verb: () => e.action.replace(/_/g, ' '),
                tone: 'view' as const,
              };
              return (
                <li key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-forest-900/40">
                  <span
                    className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ring-1 ${toneRing(
                      meta.tone,
                    )}`}
                  >
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] leading-snug text-cream-100/90">
                      <span className="font-semibold text-cream-50" data-no-translate>
                        {e.actorLabel || 'Someone'}
                      </span>{' '}
                      <span className="text-cream-100/70">{meta.verb(e.detail)}</span>
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-cream-100/45">
                      <span className="rounded-full bg-cream-100/8 px-1.5 py-px font-medium text-cream-100/60">
                        {KIND_LABEL[e.actorKind] ?? e.actorKind}
                      </span>
                      <span aria-hidden>·</span>
                      <time dateTime={e.createdAt} title={new Date(e.createdAt).toLocaleString()}>
                        {relativeTime(e.createdAt)}
                      </time>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {events.length > 12 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 text-[12.5px] font-semibold text-gold-metal/85 hover:text-gold-300"
            >
              {showAll ? 'Show less' : `Show all ${events.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function toneRing(tone: 'view' | 'act' | 'comment' | 'download'): string {
  switch (tone) {
    case 'download':
      return 'bg-gold-metal/12 text-gold-metal ring-gold-metal/25';
    case 'comment':
      return 'bg-sky-500/12 text-sky-300 ring-sky-400/25';
    case 'act':
      return 'bg-emerald-500/12 text-emerald-300 ring-emerald-400/25';
    default:
      return 'bg-cream-100/8 text-cream-100/60 ring-cream-50/15';
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── icons ──
function EyeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function PanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M3 9h18" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 5h16v11H8l-4 3V5Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DotIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 12h4l2-6 4 12 2-6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
