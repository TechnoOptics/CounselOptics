import { NextResponse } from 'next/server';
import {
  getCase,
  getCurrentSubscription,
  getEffectiveTrialState,
  getLatestReview,
  getProfile,
  listExhibits,
} from '@/lib/storage';
import { getCurrentUser } from '@/lib/supabase/server';
import { generateCasePdf } from '@/lib/pdf';
import { hasFeature, isFullAccessTrial } from '@/lib/tier';
import { currentUserTrialGrant } from '@/lib/user-trials';
import { isRealReview, isReviewStale, lastCompositionEditAt } from '@/lib/composition';
import { formatDateTimeShort } from '@/lib/format';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const caseRecord = await getCase(params.id);
  if (!caseRecord) {
    return new NextResponse('Case not found', { status: 404 });
  }

  const [exhibits, review, profile, user, trialState, sub] = await Promise.all([
    listExhibits(caseRecord.id),
    getLatestReview(caseRecord.id),
    getProfile(),
    getCurrentUser(),
    getEffectiveTrialState().catch(() => null),
    getCurrentSubscription().catch(() => null),
  ]);

  const clientName =
    profile?.displayName ||
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email ||
    null;
  // Watermark trial-period exports so they can't be passed off as a
  // finished packet without subscribing. isFullAccessTrial covers
  // both the email-anchored 7-day free trial AND the 7-day Stripe
  // trial. Active subscribers get a clean export (no watermark).
  const isTrial = trialState ? isFullAccessTrial(trialState) : false;

  // Advottic Review (the AI summary) is gated to Standard / Pro tiers
  // OR to anyone inside an active trial. Without entitlement we omit
  // the Review section entirely from the export so a Basic / expired
  // -trial user does not get a packet that includes a review they
  // can no longer access in-app.
  const hqTrial = await currentUserTrialGrant().catch(() => undefined);
  const reviewEntitled = isTrial || hasFeature(sub, 'aiReview', hqTrial);

  // What goes into the packet, and what must never go into it.
  //
  // A demo placeholder is dropped rather than printed. lib/pdf.ts does tag it
  // "DEMO RESPONSE", but that tag sits above several pages of invented
  // issue-spotting, and this document is one somebody hands to a court or to
  // an attorney. A packet with no review section is honest; a packet with a
  // fabricated one and a label is not worth the chance of the label being
  // missed.
  //
  // A review written before the person rewrote their account is kept, because
  // it is a real record of what was said at the time, but the packet says so
  // in the first line anyone reads of it. The marking is prepended to the
  // summary here, on a copy, so nothing in lib/pdf.ts changes and nothing is
  // written back to the stored review.
  const realReview = isRealReview(review) ? review : null;
  const history = caseRecord.descriptionHistory ?? [];
  const staleSince = isReviewStale(realReview, history)
    ? lastCompositionEditAt(history)
    : null;
  const packetReview =
    realReview && staleSince
      ? {
          ...realReview,
          summary:
            'NOTE: this review was written before the account of what happened was rewritten on ' +
            `${formatDateTimeShort(staleSince)}. It reflects the earlier wording, not the account ` +
            'as it now stands.\n\n' +
            realReview.summary,
        }
      : realReview;

  const pdf = await generateCasePdf({
    caseRecord,
    exhibits,
    review: packetReview,
    profile,
    clientName,
    trial: isTrial,
    reviewEntitled,
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
