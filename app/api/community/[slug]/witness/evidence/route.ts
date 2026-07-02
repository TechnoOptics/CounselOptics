import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { checkRateLimit } from '@/lib/rate-limit';
import { validateCommunityUpload } from '@/lib/upload-safety';
import { appendWitnessEvent } from '@/lib/witness-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/community/[slug]/witness/evidence
 *
 * Public, unauthenticated endpoint - anyone with the case's public link
 * can submit evidence or a testimonial. Mirrors the trust model of
 * app/api/firm/sign/route.ts: every write happens through the
 * service-role client, never a client-side Supabase call, so
 * witness_submissions needs zero RLS policies for anon/authenticated
 * (there simply is no PostgREST path into this table from the browser).
 *
 * multipart/form-data body:
 *   file?: File            - optional evidence file (image or PDF)
 *   testimonialText?: string
 *   fullName?: string       - optional; submitter may stay anonymous
 *
 * At least one of `file` or `testimonialText` is required.
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

  // Rate limit before touching the DB or storage at all - generous
  // enough for a family submitting a few items from one connection,
  // tight enough to blunt scripted abuse of a public, unauthenticated
  // form. Per-IP, not per-case, so one bad actor can't work around it
  // by hitting many different case pages.
  const allowed = await checkRateLimit(`community:evidence:${ip}`, {
    limit: 8,
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

  // The RPC only returns the public-safe columns; we need the real ids
  // for the insert, so look those up directly with the admin client
  // (bypasses RLS - this route IS the trusted server boundary).
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

  const testimonialText = String(formData.get('testimonialText') ?? '').trim();
  const fullName = String(formData.get('fullName') ?? '').trim();
  const file = formData.get('file');
  const hasFile = file instanceof File && file.size > 0;

  if (!hasFile && !testimonialText) {
    return NextResponse.json(
      { error: 'Please add a testimonial, a file, or both.' },
      { status: 400 },
    );
  }
  if (testimonialText.length > 10_000) {
    return NextResponse.json({ error: 'Testimonial is too long.' }, { status: 400 });
  }

  let evidenceFilePath: string | null = null;
  let evidenceFileName: string | null = null;
  let evidenceFileType: string | null = null;
  let evidenceFileSize: number | null = null;

  const submissionId = crypto.randomUUID();

  if (hasFile) {
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const check = validateCommunityUpload(buffer);
    if (!check.ok) {
      return NextResponse.json({ error: check.reason }, { status: 400 });
    }
    const extByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    };
    const ext = extByMime[check.mimeType] ?? 'bin';
    const path = `${communityCase.case_id}/${submissionId}/evidence/file.${ext}`;
    const { error: uploadErr } = await admin.storage
      .from('community-submissions')
      .upload(path, buffer, { contentType: check.mimeType, upsert: false });
    if (uploadErr) {
      return NextResponse.json({ error: 'Could not save the file. Please try again.' }, { status: 500 });
    }
    evidenceFilePath = path;
    evidenceFileName = (file as File).name || `evidence.${ext}`;
    evidenceFileType = check.mimeType;
    evidenceFileSize = buffer.length;
  }

  const { error: insertErr } = await admin.from('witness_submissions').insert({
    id: submissionId,
    community_case_id: communityCase.id,
    case_id: communityCase.case_id,
    kind: 'evidence',
    full_name: fullName || null,
    testimonial_text: testimonialText || null,
    evidence_file_path: evidenceFilePath,
    evidence_file_name: evidenceFileName,
    evidence_file_type: evidenceFileType,
    evidence_file_size: evidenceFileSize,
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
    metadata: { kind: 'evidence', hasFile, caseNumber: page.case_number },
  });

  return NextResponse.json({ ok: true });
}
