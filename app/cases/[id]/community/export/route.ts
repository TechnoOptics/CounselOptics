import { NextResponse } from 'next/server';
import { getCase } from '@/lib/storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { generateCommunitySubmissionsPdf } from '@/lib/pdf';
import { generateCommunitySubmissionsDocx } from '@/lib/docx-export';
import { getCommunityCaseForCase, listWitnessSubmissions } from '@/lib/community-actions';

export const runtime = 'nodejs';
// Give a large packet room to render, but cap it so a stuck export can't
// pin the function. Peak memory is bounded separately by batching the
// image downloads below.
export const maxDuration = 60;

/**
 * GET /cases/[id]/community/export?format=pdf|docx
 *
 * Owner/attorney-only export of a Community Case's submissions as one
 * PDF (default) or Word document. Authorization comes entirely from RLS:
 * getCommunityCaseForCase and listWitnessSubmissions both go through the
 * RLS-scoped client, so a viewer/editor collaborator (or anyone else)
 * simply gets nothing back - there is no separate permission check to get
 * wrong here.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const format = new URL(req.url).searchParams.get('format') === 'docx' ? 'docx' : 'pdf';
  const caseRecord = await getCase(params.id);
  if (!caseRecord) return new NextResponse('Case not found', { status: 404 });

  const communityCase = await getCommunityCaseForCase(caseRecord.id);
  if (!communityCase) {
    return new NextResponse('No Community Case page for this case.', { status: 404 });
  }

  const submissions = await listWitnessSubmissions(communityCase.id);

  // Organizer identity block (see generateCommunitySubmissionsPdf's doc
  // comment for why). Looked up via the admin client because the current
  // viewer may be an attorney collaborator, not the organizer themselves,
  // and profiles RLS only allows selecting one's own row - this export
  // route already established the viewer is authorized (owner/attorney)
  // via the RLS-scoped reads above, so this one admin lookup is safe.
  const admin = createAdminSupabase();
  let organizerName = 'Unknown';
  let organizerEmail = 'unknown';
  let organizerCreatedAt: string | null = null;
  if (admin) {
    const [{ data: profileRow }, { data: authRow }] = await Promise.all([
      admin.from('profiles').select('display_name').eq('id', communityCase.organizerUserId).maybeSingle(),
      admin.schema('auth').from('users').select('email, created_at').eq('id', communityCase.organizerUserId).maybeSingle(),
    ]);
    organizerName = (profileRow as { display_name?: string } | null)?.display_name || 'Unknown';
    organizerEmail = (authRow as { email?: string } | null)?.email || 'unknown';
    organizerCreatedAt = (authRow as { created_at?: string } | null)?.created_at ?? null;
  }

  // Load image buffers for inline embedding. PDF/other evidence types
  // get a "see attached file" note in the packet rather than a full
  // splice-in for this first slice (see generateCommunitySubmissionsPdf).
  async function downloadBuffer(path: string | null): Promise<Buffer | null> {
    if (!admin || !path) return null;
    const { data } = await admin.storage.from('community-submissions').download(path);
    if (!data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  const buildRow = async (s: (typeof submissions)[number]) => {
      if (s.kind === 'letter_of_support') {
        const [signatureBuffer, idFrontBuffer, idBackBuffer] = await Promise.all([
          downloadBuffer(s.signatureImagePath),
          downloadBuffer(s.idFrontPath),
          downloadBuffer(s.idBackPath),
        ]);
        return {
          kind: 'letter_of_support' as const,
          fullName: s.fullName,
          testimonialText: null,
          evidenceFileName: null,
          evidenceFileType: null,
          evidenceFileSize: null,
          createdAt: s.createdAt,
          mailingAddress: s.mailingAddress,
          letterBody: s.letterBody,
          signatureBuffer,
          idFrontBuffer,
          idBackBuffer,
        };
      }
      let imageBuffer: Buffer | null = null;
      if (s.evidenceFileType?.startsWith('image/')) {
        imageBuffer = await downloadBuffer(s.evidenceFilePath);
      }
      return {
        kind: 'evidence' as const,
        fullName: s.fullName,
        testimonialText: s.testimonialText,
        evidenceFileName: s.evidenceFileName,
        evidenceFileType: s.evidenceFileType,
        evidenceFileSize: s.evidenceFileSize,
        createdAt: s.createdAt,
        imageBuffer,
      };
  };
  // Download image buffers in small concurrent batches so at most BATCH*3
  // are resident at once - a viral case with thousands of submissions
  // would otherwise buffer every ID/signature image in one Promise.all
  // and OOM the function.
  const BATCH = 6;
  const submissionsWithBuffers: Array<Awaited<ReturnType<typeof buildRow>>> = [];
  for (let i = 0; i < submissions.length; i += BATCH) {
    const rows = await Promise.all(submissions.slice(i, i + BATCH).map(buildRow));
    submissionsWithBuffers.push(...rows);
  }

  const exportData = {
    caseTitle: caseRecord.title,
    communityCase: {
      caseNumber: communityCase.caseNumber,
      displayName: communityCase.displayName,
      publicSummary: communityCase.publicSummary,
      status: communityCase.status,
      letterCount: communityCase.letterCount,
      evidenceCount: communityCase.evidenceCount,
    },
    organizer: { name: organizerName, email: organizerEmail, accountCreatedAt: organizerCreatedAt },
    submissions: submissionsWithBuffers,
  };

  const file = format === 'docx' ? await generateCommunitySubmissionsDocx(exportData) : await generateCommunitySubmissionsPdf(exportData);
  const ab = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;

  const safeTitle = communityCase.displayName.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'community-case';
  const filename = `${safeTitle}-submissions.${format}`;
  const contentType =
    format === 'docx'
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/pdf';

  return new NextResponse(ab, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}
