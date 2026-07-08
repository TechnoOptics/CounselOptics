'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import {
  getSectionComments,
  postSectionComment,
  deleteSectionComment,
} from '@/lib/case-collab-actions';
import type {
  AuthorCard,
  CaseParticipant,
  SectionComment,
  SectionType,
} from '@/lib/case-collab-types';

/**
 * Client context shared by the timeline's collaboration surfaces (section
 * comments now, and the chat panel reuses the participant + author data).
 *
 * All firm-side reads/writes go through the admin-gated server actions in
 * lib/case-collab-actions.ts. On top of that, one Supabase Realtime channel
 * pushes new comments live; a slow poll reconciles anything Realtime missed
 * (flaky networks, or a deployment where Realtime authorization is not yet
 * wired for these tables).
 */

type CollabValue = {
  firmId: string;
  caseId: string;
  currentUserId: string;
  participants: CaseParticipant[];
  canPost: boolean;
  author: (userId: string) => AuthorCard;
  commentsFor: (sectionType: SectionType, targetRef: string) => SectionComment[];
  countFor: (sectionType: SectionType, targetRef: string) => number;
  addComment: (
    sectionType: SectionType,
    targetRef: string,
    body: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  removeComment: (id: string) => Promise<{ ok: boolean; error?: string }>;
};

const CollabContext = createContext<CollabValue | null>(null);

const POLL_MS = 30_000;

export function CollabProvider({
  firmId,
  caseId,
  currentUserId,
  participants,
  initialComments,
  initialAuthors,
  children,
}: {
  firmId: string;
  caseId: string;
  currentUserId: string;
  participants: CaseParticipant[];
  initialComments: SectionComment[];
  initialAuthors: AuthorCard[];
  children: React.ReactNode;
}) {
  const [comments, setComments] = useState<SectionComment[]>(initialComments);
  const authorsRef = useRef<Map<string, AuthorCard>>(new Map());

  // Seed the author index from participants + any comment authors the server
  // already resolved. Kept in a ref so lookups are stable across renders.
  useMemo(() => {
    const m = authorsRef.current;
    for (const p of participants) {
      m.set(p.userId, { userId: p.userId, displayName: p.displayName, avatarUrl: p.avatarUrl });
    }
    for (const a of initialAuthors) m.set(a.userId, a);
  }, [participants, initialAuthors]);

  const me = participants.find((p) => p.userId === currentUserId);
  const canPost = me?.canPost ?? true; // firm members always may post

  const author = useCallback(
    (userId: string): AuthorCard =>
      authorsRef.current.get(userId) ?? { userId, displayName: 'Member', avatarUrl: null },
    [],
  );

  const commentsFor = useCallback(
    (sectionType: SectionType, targetRef: string) =>
      comments
        .filter((c) => c.sectionType === sectionType && c.targetRef === targetRef)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [comments],
  );
  const countFor = useCallback(
    (sectionType: SectionType, targetRef: string) =>
      comments.reduce(
        (n, c) => (c.sectionType === sectionType && c.targetRef === targetRef ? n + 1 : n),
        0,
      ),
    [comments],
  );

  const upsert = useCallback((c: SectionComment) => {
    setComments((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c]));
  }, []);

  const addComment = useCallback(
    async (sectionType: SectionType, targetRef: string, body: string) => {
      const res = await postSectionComment(firmId, caseId, sectionType, targetRef, body);
      if (res.ok && res.comment) upsert(res.comment);
      return { ok: res.ok, error: res.error };
    },
    [firmId, caseId, upsert],
  );

  const removeComment = useCallback(
    async (id: string) => {
      const res = await deleteSectionComment(firmId, caseId, id);
      if (res.ok) setComments((prev) => prev.filter((c) => c.id !== id));
      return { ok: res.ok, error: res.error };
    },
    [firmId, caseId],
  );

  // Realtime: live comment inserts + soft-delete updates for this case.
  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();
    const sub = supabase
      .channel(`case-comments:${caseId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'case_section_comments', filter: `case_id=eq.${caseId}` },
        (payload) => {
          if (cancelled) return;
          const r = payload.new as Record<string, unknown>;
          if (r.deleted_at) return;
          upsert({
            id: r.id as string,
            caseId: r.case_id as string,
            sectionType: r.section_type as SectionType,
            targetRef: r.target_ref as string,
            authorUserId: r.author_user_id as string,
            body: r.body as string,
            createdAt: r.created_at as string,
          });
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'case_section_comments', filter: `case_id=eq.${caseId}` },
        (payload) => {
          if (cancelled) return;
          const r = payload.new as Record<string, unknown>;
          if (r.deleted_at) setComments((prev) => prev.filter((c) => c.id !== (r.id as string)));
        },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
  }, [caseId, upsert]);

  // Poll fallback: reconcile the full comment set periodically.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(async () => {
      const { comments: fresh, authors } = await getSectionComments(firmId, caseId);
      if (cancelled) return;
      for (const a of authors) authorsRef.current.set(a.userId, a);
      setComments(fresh);
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [firmId, caseId]);

  const value: CollabValue = {
    firmId,
    caseId,
    currentUserId,
    participants,
    canPost,
    author,
    commentsFor,
    countFor,
    addComment,
    removeComment,
  };
  return <CollabContext.Provider value={value}>{children}</CollabContext.Provider>;
}

export function useCollab(): CollabValue {
  const ctx = useContext(CollabContext);
  if (!ctx) throw new Error('useCollab must be used within CollabProvider');
  return ctx;
}
