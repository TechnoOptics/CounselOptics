'use server';

import { getCurrentUser, createServerSupabase } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import type {
  AuthorCard,
  CaseParticipant,
  ChatMessage,
  SectionComment,
  SectionType,
} from './case-collab-types';
import { GENERAL_THREAD_KEY, dmThreadKey } from './case-collab-types';

/**
 * FIRM-side actions for case timeline collaboration (section comments + chat).
 *
 * Mirrors lib/firm-timeline-actions.ts: every action gates on firm membership
 * + case.firm_id and goes through the ADMIN client, because firm members are
 * NOT case members of a firm matter and would otherwise be denied by RLS. The
 * RLS policies on case_section_comments / case_chat_messages additionally
 * admit firm members so the counsel surface's Realtime subscriptions work
 * (they run on the authed browser client, which honours RLS).
 */

const MAX_BODY = 4000;

/** The current user is a member of `firmId` AND `caseId` belongs to that firm. */
async function assertFirmCase(
  firmId: string,
  caseId: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('id')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You do not have access to this firm.' };
  const { data: kase } = await supabase
    .from('cases')
    .select('id')
    .eq('id', caseId)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (!kase) return { ok: false, error: 'That matter is not in this firm.' };
  return { ok: true, userId: user.id };
}

type AdminClient = NonNullable<ReturnType<typeof createAdminSupabase>>;

/** Resolve display name + avatar for a set of user ids, best-effort. */
async function hydrateAuthors(
  admin: AdminClient,
  userIds: string[],
): Promise<Map<string, AuthorCard>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const out = new Map<string, AuthorCard>();
  if (ids.length === 0) return out;
  const [{ data: profiles }, { data: members }] = await Promise.all([
    admin.from('profiles').select('id, display_name, avatar_url').in('id', ids),
    admin.from('firm_members').select('user_id, display_name').in('user_id', ids),
  ]);
  const memberName = new Map<string, string>();
  for (const m of (members ?? []) as { user_id: string; display_name: string | null }[]) {
    if (m.display_name) memberName.set(m.user_id, m.display_name);
  }
  for (const id of ids) {
    const p = ((profiles ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]).find(
      (r) => r.id === id,
    );
    out.set(id, {
      userId: id,
      displayName: p?.display_name || memberName.get(id) || 'Member',
      avatarUrl: p?.avatar_url ?? null,
    });
  }
  return out;
}

// ── Participants (firm members + accepted collaborators) ──────────────────
export async function getCaseParticipants(
  firmId: string,
  caseId: string,
): Promise<CaseParticipant[]> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return [];
  const admin = createAdminSupabase();
  if (!admin) return [];

  const [{ data: firmRows }, { data: collabRows }] = await Promise.all([
    admin.from('firm_members').select('user_id, display_name, role').eq('firm_id', firmId),
    admin
      .from('case_collaborators')
      .select('user_id, email, role, accepted_at')
      .eq('case_id', caseId)
      .not('user_id', 'is', null),
  ]);

  const firmMembers = (firmRows ?? []) as { user_id: string; display_name: string | null; role: string }[];
  const collabs = (collabRows ?? []) as {
    user_id: string; email: string | null; role: string; accepted_at: string | null;
  }[];

  const ids = [
    ...firmMembers.map((m) => m.user_id),
    ...collabs.map((c) => c.user_id),
  ];
  const authors = await hydrateAuthors(admin, ids);

  const seen = new Set<string>();
  const out: CaseParticipant[] = [];
  for (const m of firmMembers) {
    if (seen.has(m.user_id)) continue;
    seen.add(m.user_id);
    const a = authors.get(m.user_id);
    out.push({
      userId: m.user_id,
      displayName: a?.displayName || m.display_name || 'Member',
      avatarUrl: a?.avatarUrl ?? null,
      kind: 'firm',
      role: m.role,
      canPost: true,
    });
  }
  for (const c of collabs) {
    if (seen.has(c.user_id)) continue;
    seen.add(c.user_id);
    const a = authors.get(c.user_id);
    out.push({
      userId: c.user_id,
      displayName: a?.displayName || c.email || 'Guest',
      avatarUrl: a?.avatarUrl ?? null,
      kind: 'collaborator',
      role: c.role,
      // Mirrors private.can_add_to_case: editor / attorney / represented post.
      canPost: ['editor', 'attorney', 'represented'].includes(c.role),
    });
  }
  return out.sort((x, y) => x.displayName.localeCompare(y.displayName));
}

// ── Section comments ──────────────────────────────────────────────────────
type CommentRow = {
  id: string; case_id: string; section_type: SectionType; target_ref: string;
  author_user_id: string; body: string; created_at: string;
};
function toComment(r: CommentRow): SectionComment {
  return {
    id: r.id, caseId: r.case_id, sectionType: r.section_type, targetRef: r.target_ref,
    authorUserId: r.author_user_id, body: r.body, createdAt: r.created_at,
  };
}

export async function getSectionComments(
  firmId: string,
  caseId: string,
): Promise<{ comments: SectionComment[]; authors: AuthorCard[] }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { comments: [], authors: [] };
  const admin = createAdminSupabase();
  if (!admin) return { comments: [], authors: [] };
  const { data } = await admin
    .from('case_section_comments')
    .select('id, case_id, section_type, target_ref, author_user_id, body, created_at')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  const comments = ((data ?? []) as CommentRow[]).map(toComment);
  const authors = await hydrateAuthors(admin, comments.map((c) => c.authorUserId));
  return { comments, authors: Array.from(authors.values()) };
}

export async function postSectionComment(
  firmId: string,
  caseId: string,
  sectionType: SectionType,
  targetRef: string,
  body: string,
): Promise<{ ok: boolean; error?: string; comment?: SectionComment }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const trimmed = body.trim();
  if (!trimmed) return { ok: false, error: 'Write something first.' };
  if (!targetRef.trim()) return { ok: false, error: 'Missing section reference.' };
  const { data, error } = await admin
    .from('case_section_comments')
    .insert({
      case_id: caseId,
      section_type: sectionType,
      target_ref: targetRef,
      author_user_id: gate.userId,
      body: trimmed.slice(0, MAX_BODY),
    })
    .select('id, case_id, section_type, target_ref, author_user_id, body, created_at')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not post.' };
  return { ok: true, comment: toComment(data as CommentRow) };
}

export async function deleteSectionComment(
  firmId: string,
  caseId: string,
  commentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  // Only the author may remove their own comment (firm path still gated).
  const { error } = await admin
    .from('case_section_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId)
    .eq('case_id', caseId)
    .eq('author_user_id', gate.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ── Chat ──────────────────────────────────────────────────────────────────
type ChatRow = {
  id: string; case_id: string; thread_kind: 'general' | 'dm'; thread_key: string;
  participants: string[] | null; author_user_id: string; body: string; created_at: string;
};
function toMessage(r: ChatRow): ChatMessage {
  return {
    id: r.id, caseId: r.case_id, threadKind: r.thread_kind, threadKey: r.thread_key,
    participants: Array.isArray(r.participants) ? r.participants : [],
    authorUserId: r.author_user_id, body: r.body, createdAt: r.created_at,
  };
}

export async function getChatThread(
  firmId: string,
  caseId: string,
  threadKey: string,
  limit = 100,
): Promise<ChatMessage[]> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return [];
  const admin = createAdminSupabase();
  if (!admin) return [];
  // A firm member may open any DM thread on the matter from the counsel side,
  // but must actually be one of its two people to read it.
  if (threadKey !== GENERAL_THREAD_KEY && !threadKey.includes(gate.userId)) return [];
  const { data } = await admin
    .from('case_chat_messages')
    .select('id, case_id, thread_kind, thread_key, participants, author_user_id, body, created_at')
    .eq('case_id', caseId)
    .eq('thread_key', threadKey)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  return ((data ?? []) as ChatRow[]).map(toMessage).reverse();
}

export async function postChatMessage(
  firmId: string,
  caseId: string,
  input: { threadKind: 'general' | 'dm'; otherUserId?: string; body: string },
): Promise<{ ok: boolean; error?: string; message?: ChatMessage }> {
  const gate = await assertFirmCase(firmId, caseId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Service unavailable.' };
  const trimmed = input.body.trim();
  if (!trimmed) return { ok: false, error: 'Write something first.' };

  let threadKey = GENERAL_THREAD_KEY;
  let participants: string[] = [];
  if (input.threadKind === 'dm') {
    if (!input.otherUserId) return { ok: false, error: 'Pick someone to message.' };
    if (input.otherUserId === gate.userId) return { ok: false, error: 'Cannot message yourself.' };
    threadKey = dmThreadKey(gate.userId, input.otherUserId);
    participants = [gate.userId, input.otherUserId].sort();
  }

  const { data, error } = await admin
    .from('case_chat_messages')
    .insert({
      case_id: caseId,
      thread_kind: input.threadKind,
      thread_key: threadKey,
      participants,
      author_user_id: gate.userId,
      body: trimmed.slice(0, MAX_BODY),
    })
    .select('id, case_id, thread_kind, thread_key, participants, author_user_id, body, created_at')
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not send.' };
  return { ok: true, message: toMessage(data as ChatRow) };
}
