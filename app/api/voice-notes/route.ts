import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/voice-notes
 *
 * Persist a voice note captured on the watch (or web) to the user's
 * vault. v1 saves the transcription text only - the underlying
 * audio bytes capture + upload from the watch is a follow-up that
 * needs MediaRecorder running alongside SpeechRecognizer. For now
 * the searchable, editable transcription is the deliverable.
 *
 * Auth: Bearer adv_ token with read scope (the watch's pairing
 * token). Body: { transcription: string, case_id?: string }
 *
 * Lands in user_drafts as a "voice_note" template.
 *
 * DEFECT, recorded rather than fixed here: nothing reads user_drafts.
 * There is no /inbox/drafts route (app/inbox has page.tsx, documents
 * and leads only) and no redirect to one, yet the response below still
 * hands the watch client `open_url: '/inbox/drafts'`, which 404s. A
 * saved voice note is currently unreachable in the product.
 */
export async function POST(req: NextRequest) {
  const verified = await verifyApiToken(req.headers.get('authorization'));
  if (!verified) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!tokenHasScope(verified, 'read')) {
    return NextResponse.json(
      { error: 'Token missing read scope.' },
      { status: 403 },
    );
  }
  const userId = verified.userId;
  if (!userId) {
    return NextResponse.json(
      { error: 'Voice notes need a user-bound token.' },
      { status: 403 },
    );
  }

  let body: { transcription?: string; case_id?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const text = (body.transcription ?? '').toString().trim();
  if (!text) {
    return NextResponse.json(
      { error: 'Transcription is empty.' },
      { status: 400 },
    );
  }
  if (text.length > 10000) {
    return NextResponse.json(
      { error: 'Transcription is too long (max 10000 characters).' },
      { status: 400 },
    );
  }
  const caseId = (body.case_id ?? '').toString().trim() || null;
  // Derive a short title from the first few words; user can rename later.
  const title =
    (body.title ?? '').toString().trim() ||
    `Voice note ${new Date().toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })}`;

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }
  const { data, error } = await admin
    .from('user_drafts')
    .insert({
      user_id: userId,
      template_id: 'voice_note',
      title,
      content: text,
      case_id: caseId,
    })
    .select('id')
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    draft_id: (data as { id: string } | null)?.id ?? null,
    open_url: '/inbox/drafts',
  });
}
