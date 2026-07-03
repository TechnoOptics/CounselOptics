import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateIdPhoto } from '@/lib/upload-safety';
import { appendWitnessEvent } from '@/lib/witness-audit';
import { verifyTurnstileToken } from '@/lib/turnstile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_LETTER_BODY = 20_000;

/**
 * POST /api/community/[slug]/witness/letter
 *
 * Public, unauthenticated endpoint for the heavier "Letter of Support"
 * path: name, mailing address, letter text, a digital signature, and ID
 * front/back photos. Same trust model as the evidence route and
 * app/api/firm/sign/route.ts - every write goes through the service-role
 * client, so witness_submissions needs zero anon/authenticated RLS
 * policies.
 *
 * Interim safeguard (see supabase/fixes/2026-07-02-community-letters-pending-review.sql):
 * full malware/AV scanning isn't wired up yet, so every letter lands with
 * status='pending_review' instead of 'received'. That does NOT relax
 * upload validation here - magic-byte checks and a 10MB cap still apply
 * to both ID photos - it only changes how the organizer UI treats an
 * already-accepted file before someone marks it reviewed.
 *
 * multipart/form-data body:
 *   fullName: string (required)
 *   street, city, state, zip: string (required)
 *   letterBody: string (required)
 *   signatureDataUrl: string           - PNG data URL from canvas, like /api/firm/sign
 *   typedName?: string
 *   idFront: File (required)
 *   idBack: File (required)
 *   electronicRecordsConsentedAt, intentAffirmedAt: string (ISO timestamps)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } },
) {
  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' },
      { status: 500 },
    );
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const userAgent = req.headers.get('user-agent') ?? null;

  // Stricter than the evidence route (8/hour) - this path collects
  // government ID images, so the bar for "this looks like scripted
  // abuse" should be lower.
  const allowed = await checkRateLimit(`community:letter:${ip}`, {
    limit: 3,
    windowSeconds: 60 * 60,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many submissions from this connection. Please try again later.' },
      { status: 429 },
    );
  }

  const slug = params.slug;
  const { data: pageRows, error: pageErr } = await admin.rpc('get_public_community_case', {
    _slug: slug,
  });
  const page = (pageRows as Array<{ status: string; case_number: string }> | null)?.[0];
  if (pageErr || !page) {
    return NextResponse.json({ error: 'Community Case page not found.' }, { status: 404 });
  }
  if (page.status !== 'published') {
    return NextResponse.json(
      { error: 'This page is not currently accepting submissions.' },
      { status: 410 },
    );
  }

  const { data: ccRow } = await admin
    .from('community_cases')
    .select('id, case_id')
    .eq('slug', slug)
    .maybeSingle();
  const communityCase = ccRow as { id: string; case_id: string } | null;
  if (!communityCase) {
    return NextResponse.json({ error: 'Community Case page not found.' }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form submission.' }, { status: 400 });
  }

  const turnstileCheck = await verifyTurnstileToken(
    String(formData.get('turnstileToken') ?? ''),
    ip,
  );
  if (!turnstileCheck.ok) {
    return NextResponse.json({ error: turnstileCheck.error }, { status: 400 });
  }

  const fullName = String(formData.get('fullName') ?? '').trim();
  const street = String(formData.get('street') ?? '').trim();
  const city = String(formData.get('city') ?? '').trim();
  const state = String(formData.get('state') ?? '').trim();
  const zip = String(formData.get('zip') ?? '').trim();
  const letterBody = String(formData.get('letterBody') ?? '').trim();
  const signatureDataUrl = String(formData.get('signatureDataUrl') ?? '');
  const typedName = String(formData.get('typedName') ?? '').trim() || null;
  const electronicRecordsConsentedAt = String(formData.get('electronicRecordsConsentedAt') ?? '');
  const intentAffirmedAt = String(formData.get('intentAffirmedAt') ?? '');
  const idFront = formData.get('idFront');
  const idBack = formData.get('idBack');

  if (!fullName || !street || !city || !state || !zip) {
    return NextResponse.json({ error: 'Name and mailing address are required.' }, { status: 400 });
  }
  if (!letterBody) {
    return NextResponse.json({ error: 'Letter text is required.' }, { status: 400 });
  }
  if (letterBody.length > MAX_LETTER_BODY) {
    return NextResponse.json({ error: 'Letter is too long.' }, { status: 400 });
  }
  if (!signatureDataUrl.startsWith('data:image/png;base64,')) {
    return NextResponse.json({ error: 'A signature is required.' }, { status: 400 });
  }
  if (!electronicRecordsConsentedAt || !intentAffirmedAt) {
    return NextResponse.json({ error: 'Consent confirmation is missing.' }, { status: 400 });
  }
  if (!(idFront instanceof File) || idFront.size === 0 || !(idBack instanceof File) || idBack.size === 0) {
    return NextResponse.json({ error: 'Front and back photos of an ID are required.' }, { status: 400 });
  }

  const frontBuffer = Buffer.from(await idFront.arrayBuffer());
  const backBuffer = Buffer.from(await idBack.arrayBuffer());
  const frontCheck = validateIdPhoto(frontBuffer);
  if (!frontCheck.ok) {
    return NextResponse.json({ error: `Front of ID: ${frontCheck.reason}` }, { status: 400 });
  }
  const backCheck = validateIdPhoto(backBuffer);
  if (!backCheck.ok) {
    return NextResponse.json({ error: `Back of ID: ${backCheck.reason}` }, { status: 400 });
  }

  const sigBase64 = signatureDataUrl.split(',')[1] ?? '';
  const sigBuffer = Buffer.from(sigBase64, 'base64');
  if (sigBuffer.length === 0 || sigBuffer.length > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'Signature image is invalid.' }, { status: 400 });
  }

  const submissionId = crypto.randomUUID();
  const extByMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  const frontExt = extByMime[frontCheck.mimeType] ?? 'bin';
  const backExt = extByMime[backCheck.mimeType] ?? 'bin';
  const basePath = `${communityCase.case_id}/${submissionId}`;
  const frontPath = `${basePath}/id-front.${frontExt}`;
  const backPath = `${basePath}/id-back.${backExt}`;
  const signaturePath = `${basePath}/signature.png`;

  const uploads = await Promise.all([
    admin.storage
      .from('community-submissions')
      .upload(frontPath, frontBuffer, { contentType: frontCheck.mimeType, upsert: false }),
    admin.storage
      .from('community-submissions')
      .upload(backPath, backBuffer, { contentType: backCheck.mimeType, upsert: false }),
    admin.storage
      .from('community-submissions')
      .upload(signaturePath, sigBuffer, { contentType: 'image/png', upsert: false }),
  ]);
  if (uploads.some((u) => u.error)) {
    return NextResponse.json({ error: 'Could not save the submission. Please try again.' }, { status: 500 });
  }

  // Hashed at upload time, before any future purge - this is what lets
  // the audit trail prove an ID was checked even after the images
  // themselves are deleted on case close (see the plan's Retention
  // section).
  const idFrontSha256 = crypto.createHash('sha256').update(frontBuffer).digest('hex');
  const idBackSha256 = crypto.createHash('sha256').update(backBuffer).digest('hex');

  const { error: insertErr } = await admin.from('witness_submissions').insert({
    id: submissionId,
    community_case_id: communityCase.id,
    case_id: communityCase.case_id,
    kind: 'letter_of_support',
    status: 'pending_review',
    full_name: fullName,
    mailing_address: { street, city, state, zip },
    letter_body: letterBody,
    signature_image_path: signaturePath,
    id_front_path: frontPath,
    id_back_path: backPath,
    id_front_sha256: idFrontSha256,
    id_back_sha256: idBackSha256,
    consent_metadata: {
      electronicRecordsConsentedAt,
      intentAffirmedAt,
      typedName,
      uaSnapshot: userAgent,
    },
    submitter_ip: ip,
    submitter_user_agent: userAgent,
  });
  if (insertErr) {
    return NextResponse.json(
      { error: 'Could not record the submission. Please try again.' },
      { status: 500 },
    );
  }

  await appendWitnessEvent(admin, {
    submissionId,
    eventType: 'submitted',
    ipAddress: ip,
    userAgent,
    metadata: { kind: 'letter_of_support', caseNumber: page.case_number },
  });

  return NextResponse.json({ ok: true });
}
