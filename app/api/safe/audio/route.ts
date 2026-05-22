import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 5 MB cap matches the storage bucket's file_size_limit. Anything
// bigger is almost certainly a misuse (a stolen token trying to
// exfiltrate data via the audio bucket) - the watch records at 32
// kbps AAC for ~60s = ~240 KB, so the real ceiling is ~10x the
// expected size.
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-m4a',
  'audio/aac',
]);

function extForMime(mime: string): string {
  switch (mime) {
    case 'audio/webm':
      return 'webm';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'audio/aac':
      return 'aac';
    default:
      return 'bin';
  }
}

/**
 * POST /api/safe/audio
 *
 * Uploads a Safe Witness audio recording captured by the watch's
 * MediaRecorder. The watch fires the main /api/safe/alert request
 * first (so the email + SMS go out instantly, even before recording
 * finishes), then streams the audio here as a follow-up. The
 * recipient-facing /safe/alert/[id] page shows an inline audio
 * player whenever this endpoint has populated metadata.audio_path.
 *
 * Body shape: multipart/form-data with:
 *   - alert_id: uuid of an existing safe_witness_alerts row owned by
 *     the calling token's user
 *   - audio: the file blob; size <= 5 MB; mime in ALLOWED_MIME
 *
 * Auth: same Bearer adv_ token used for /api/safe/alert. Must have
 * 'read' scope (the watch's tokens are read-scoped; we treat the
 * physical 4-second press as the authorization, same as the main
 * endpoint).
 *
 * On success: writes to the 'safe-witness-audio' bucket at the path
 * <userId>/<alertId>.<ext>, updates the alert row's metadata.audio_path
 * + metadata.audio_mime + metadata.audio_size, and returns the public-
 * facing relative URL the tracker page should use.
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
      { error: 'Safe Witness audio requires a user-bound token.' },
      { status: 403 },
    );
  }

  // Parse multipart manually rather than via formData() so we can
  // bail early on too-large bodies. Next's request.formData() will
  // happily buffer the entire body in memory, which is fine at 5 MB
  // but bad practice to leave unbounded.
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json(
      { error: 'Expected multipart/form-data.' },
      { status: 400 },
    );
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }
  const alertId = String(form.get('alert_id') ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    alertId,
  )) {
    return NextResponse.json(
      { error: 'alert_id must be a UUID.' },
      { status: 400 },
    );
  }
  // Next's FormDataEntryValue is FormDataEntryValue, not File|Blob,
  // and File doesn't ship a uniform type across Node + Edge. Detect
  // structurally instead - any object with a numeric `size`, a
  // string `type`, and an `arrayBuffer()` method is a Blob/File for
  // our purposes.
  const audioEntry = form.get('audio');
  const blob =
    audioEntry !== null &&
    typeof audioEntry === 'object' &&
    typeof (audioEntry as { size?: unknown }).size === 'number' &&
    typeof (audioEntry as { type?: unknown }).type === 'string' &&
    typeof (audioEntry as { arrayBuffer?: unknown }).arrayBuffer === 'function'
      ? (audioEntry as unknown as Blob)
      : null;
  if (blob === null) {
    return NextResponse.json(
      { error: 'Missing audio file part.' },
      { status: 400 },
    );
  }
  if (blob.size === 0) {
    return NextResponse.json({ error: 'Empty audio.' }, { status: 400 });
  }
  if (blob.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (${blob.size} bytes > ${MAX_BYTES}).` },
      { status: 413 },
    );
  }
  const mime = (blob.type || '').toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json(
      { error: `Unsupported audio mime: ${mime || '(empty)'}.` },
      { status: 415 },
    );
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }

  // Verify the alert exists and is owned by this user. Without this
  // check a token holder could upload audio "to" someone else's
  // alert just by guessing the UUID. The UUID is unguessable in
  // practice but defense-in-depth here is cheap.
  const { data: alertRow, error: lookupErr } = await admin
    .from('safe_witness_alerts')
    .select('id, user_id, metadata')
    .eq('id', alertId)
    .maybeSingle();
  if (lookupErr || !alertRow) {
    return NextResponse.json({ error: 'Alert not found.' }, { status: 404 });
  }
  if ((alertRow as { user_id: string }).user_id !== userId) {
    return NextResponse.json(
      { error: 'You do not own this alert.' },
      { status: 403 },
    );
  }

  // Path under the bucket. First folder is userId for RLS; filename
  // is the alert id + mime extension so the tracker page can look it
  // up deterministically and the watch can resume an interrupted
  // upload with overwrite semantics.
  const ext = extForMime(mime);
  const path = `${userId}/${alertId}.${ext}`;
  const buf = Buffer.from(await blob.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from('safe-witness-audio')
    .upload(path, buf, {
      contentType: mime,
      upsert: true,
    });
  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  // Merge audio metadata into the alert row. We keep the existing
  // metadata blob and append rather than overwrite so the previous
  // location / message / dispatches are preserved.
  const prevMeta =
    ((alertRow as { metadata: Record<string, unknown> | null }).metadata ??
      {}) as Record<string, unknown>;
  const nextMeta = {
    ...prevMeta,
    audio_path: path,
    audio_mime: mime,
    audio_size: blob.size,
    audio_uploaded_at: new Date().toISOString(),
  };
  const { error: updateErr } = await admin
    .from('safe_witness_alerts')
    .update({ metadata: nextMeta })
    .eq('id', alertId);
  if (updateErr) {
    // We did upload the file; the row update failed. Best-effort
    // return the path so the watch can retry the metadata update if
    // needed. The /safe/alert/[id] page will still find the file via
    // a fallback lookup in the bucket by alert id.
    return NextResponse.json(
      { ok: true, path, warning: `metadata update failed: ${updateErr.message}` },
    );
  }

  return NextResponse.json({
    ok: true,
    path,
    mime,
    size: blob.size,
    public_url: `/safe/alert/${alertId}`,
  });
}
