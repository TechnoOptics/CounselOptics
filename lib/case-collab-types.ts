/**
 * Shared types for case timeline collaboration (section comments + chat).
 * Kept out of the 'use server' action module so client components can import
 * the types and the pure helpers without pulling in server-only code.
 */

export type SectionType = 'evidence' | 'event' | 'calendar';

export type SectionComment = {
  id: string;
  caseId: string;
  sectionType: SectionType;
  targetRef: string;
  authorUserId: string;
  body: string;
  createdAt: string;
};

export type ChatThreadKind = 'general' | 'dm';

export type ChatMessage = {
  id: string;
  caseId: string;
  threadKind: ChatThreadKind;
  threadKey: string;
  participants: string[];
  authorUserId: string;
  body: string;
  createdAt: string;
};

/** A person on the matter - a firm member or an accepted invited collaborator. */
export type CaseParticipant = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  kind: 'firm' | 'collaborator';
  /** Firm role (owner/admin/attorney/...) or collaborator role (viewer/editor/attorney/represented/witness). */
  role: string;
  /** True when this participant may post (not a viewer / not a witness collaborator). */
  canPost: boolean;
};

/** A lightweight author card for rendering names + avatars in threads. */
export type AuthorCard = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
};

/** The general room key, and a stable, order-independent key for a DM pair. */
export const GENERAL_THREAD_KEY = 'general';

export function dmThreadKey(a: string, b: string): string {
  return 'dm:' + [a, b].sort().join(':');
}

/** The section anchor key for a calendar period (day/month/year ISO prefix). */
export function calendarTargetRef(iso: string, grain: 'day' | 'month' | 'year'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (grain === 'year') return String(d.getUTCFullYear());
  if (grain === 'month') return d.toISOString().slice(0, 7);
  return d.toISOString().slice(0, 10);
}
