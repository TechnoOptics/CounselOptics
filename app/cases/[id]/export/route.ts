import { NextResponse } from 'next/server';
import {
  getCase,
  getLatestReview,
  getProfile,
  listExhibitPlans,
  listExhibits,
} from '@/lib/storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { generateCasePdf } from '@/lib/pdf';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const caseRecord = await getCase(params.id);
  if (!caseRecord) {
    return new NextResponse('Case not found', { status: 404 });
  }

  const [exhibits, review, plans, profile, user] = await Promise.all([
    listExhibits(caseRecord.id),
    getLatestReview(caseRecord.id),
    listExhibitPlans(caseRecord.id),
    getProfile(),
    getCurrentUser(),
  ]);

  const clientName =
    profile?.displayName ||
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email ||
    null;

  const pdf = await generateCasePdf({
    caseRecord,
    exhibits,
    review,
    plans,
    profile,
    clientName,
  });
  const ab = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;

  const safeTitle = caseRecord.title.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'case';
  const filename = `${safeTitle}.pdf`;

  return new NextResponse(ab, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  });
}
