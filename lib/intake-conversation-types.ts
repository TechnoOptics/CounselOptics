/**
 * Shared types + pure helpers for the intake (legal request) conversation.
 * Deliberately outside the `'use server'` action module so client components
 * can import them without pulling server-only code into the bundle.
 */

export type MessageVisibility = 'shared' | 'internal';
export type MessageAuthorRole = 'employee' | 'legal' | 'system';

export type IntakeAttachment = {
  name: string;
  path: string;
  size: number;
  type: string;
  /** firm_documents.id, set when the file was filed into the ticket's documents. */
  documentId?: string | null;
};

export type IntakeMessage = {
  id: string;
  intakeId: string;
  authorUserId: string | null;
  authorName: string;
  authorRole: MessageAuthorRole;
  visibility: MessageVisibility;
  body: string;
  attachments: IntakeAttachment[];
  mentions: string[];
  kind: 'message' | 'event';
  eventType: string | null;
  createdAt: string;
};

/** Someone who can be @-mentioned or invited onto a ticket. */
export type IntakePerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** 'legal' = firm member, 'employee' = the requester or an invited colleague. */
  side: 'legal' | 'employee';
  role?: string | null;
};

export type IntakeParticipant = IntakePerson & {
  participantRole: 'watcher' | 'assignee';
};

export type IntakeDocument = {
  id: string;
  name: string;
  path: string;
  size: number | null;
  mimeType: string | null;
  status: string;
  uploadedAt: string;
  /** 'filed' = came in with the original request, 'chat' = shared in the conversation. */
  origin: 'filed' | 'chat' | 'requested';
};

export type IntakeUploadRequest = {
  id: string;
  label: string;
  note: string | null;
  token: string;
  expiresAt: string;
  revokedAt: string | null;
  completedAt: string | null;
  uploadCount: number;
  createdAt: string;
};

/**
 * A short, human-quotable reference for a ticket ("REQ-4F2A9C"). Derived from
 * the uuid so it needs no column and never collides in practice. Partner
 * tickets keep their own externalId; show that instead when present.
 */
export function ticketRef(intakeId: string): string {
  const hex = intakeId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `REQ-${hex}`;
}

/** Up to two initials for an avatar chip. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Every participant gets their own colour, held stable by hashing their id,
 * so you can tell who is speaking at a glance in a busy thread. Which SIDE a
 * message sits on carries the role (employee left, legal right), so the
 * colour is free to identify the person rather than their team.
 */
export type ParticipantStyle = {
  /** Message bubble background + border. */
  bubble: string;
  /** Avatar chip. */
  avatar: string;
  /** The author's name in the message header. */
  name: string;
};

const PARTICIPANT_PALETTE: ParticipantStyle[] = [
  {
    bubble: 'bg-gold-500/[0.12] border-gold-500/25',
    avatar: 'bg-gold-500/25 text-gold-800 dark:text-gold-100',
    name: 'text-gold-800 dark:text-gold-200',
  },
  {
    bubble: 'bg-sky-500/[0.12] border-sky-500/25',
    avatar: 'bg-sky-500/25 text-sky-800 dark:text-sky-100',
    name: 'text-sky-800 dark:text-sky-200',
  },
  {
    bubble: 'bg-emerald-500/[0.12] border-emerald-500/25',
    avatar: 'bg-emerald-500/25 text-emerald-800 dark:text-emerald-100',
    name: 'text-emerald-800 dark:text-emerald-200',
  },
  {
    bubble: 'bg-violet-500/[0.12] border-violet-500/25',
    avatar: 'bg-violet-500/25 text-violet-800 dark:text-violet-100',
    name: 'text-violet-800 dark:text-violet-200',
  },
  {
    bubble: 'bg-rose-500/[0.12] border-rose-500/25',
    avatar: 'bg-rose-500/25 text-rose-800 dark:text-rose-100',
    name: 'text-rose-800 dark:text-rose-200',
  },
  {
    bubble: 'bg-teal-500/[0.12] border-teal-500/25',
    avatar: 'bg-teal-500/25 text-teal-800 dark:text-teal-100',
    name: 'text-teal-800 dark:text-teal-200',
  },
  {
    bubble: 'bg-indigo-500/[0.12] border-indigo-500/25',
    avatar: 'bg-indigo-500/25 text-indigo-800 dark:text-indigo-100',
    name: 'text-indigo-800 dark:text-indigo-200',
  },
  {
    bubble: 'bg-amber-500/[0.12] border-amber-500/25',
    avatar: 'bg-amber-500/25 text-amber-800 dark:text-amber-100',
    name: 'text-amber-800 dark:text-amber-200',
  },
];

export function participantStyle(seed: string): ParticipantStyle {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PARTICIPANT_PALETTE[h % PARTICIPANT_PALETTE.length];
}

/** Just the avatar classes, the same colour the chat gives this person. */
export function avatarTint(seed: string): string {
  return participantStyle(seed).avatar;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A timestamp that is byte-identical on the server and in the browser.
 *
 * `relativeTime` below is deliberately clock-aware AND locale-aware, which
 * makes it correct for a mounted client and wrong for server-rendered HTML:
 * the server formats with the Vercel container's clock, UTC offset and ICU
 * default locale, the browser re-formats with the reader's, and React tears
 * the two apart as a text-content mismatch (React #425, which in turn errors
 * the surrounding Suspense boundary as #422). That is the crash the Hub's
 * request thread has been throwing on /portal/[id].
 *
 * So server render and the FIRST client render both use this: an explicit
 * en-US / UTC format that cannot drift. Once mounted, the component upgrades
 * to `relativeTime`, which is now a client-only concern and free to be local.
 */
export function absoluteTimestamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  // Assembled by hand rather than through Intl. Pinning the locale and the
  // timezone removes the clock, the offset and the language, but Node and the
  // browser ship independent ICU builds and en-US date patterns do change
  // between CLDR releases (the narrow no-break space before AM/PM is the
  // famous one). A version skew there would reproduce the exact #425 this
  // function exists to prevent, so nothing here consults ICU at all.
  const hours24 = d.getUTCHours();
  const hour12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minute = String(d.getUTCMinutes()).padStart(2, '0');
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}, ${hour12}:${minute} ${meridiem} UTC`;
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "just now" / "12 min ago" / "Tue 3:40 PM": quiet, never alarming.
 *
 * Client-only. Never call this during a server render or during the first
 * client render - see `absoluteTimestamp` above for why.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const d = new Date(iso);
  const days = Math.floor(hrs / 24);
  if (days < 7) {
    return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Group consecutive messages by the same author within 5 minutes. */
export function shouldGroupWithPrevious(
  msg: IntakeMessage,
  prev: IntakeMessage | undefined,
): boolean {
  if (!prev) return false;
  if (prev.kind === 'event' || msg.kind === 'event') return false;
  if (prev.authorUserId !== msg.authorUserId || prev.authorName !== msg.authorName) return false;
  if (prev.visibility !== msg.visibility) return false;
  const gap = new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime();
  return gap >= 0 && gap < 5 * 60 * 1000;
}

/** Merge incoming rows into a list, de-duped by id and sorted oldest-first. */
export function mergeMessages(
  existing: IntakeMessage[],
  incoming: IntakeMessage[],
): IntakeMessage[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
}

export const MAX_MESSAGE_CHARS = 8000;
export const MAX_CHAT_FILES = 6;
export const MAX_CHAT_FILE_BYTES = 25 * 1024 * 1024;
