/**
 * Community Case pages: a public, shareable companion page for an existing
 * `cases` row, so the community can rally support (fundraising link-outs,
 * a public story, bond amount, hearing date) and submit evidence,
 * testimonials, or a signed Letter of Support for the case's attorney.
 * See supabase/fixes/2026-07-02-community-cases.sql for the schema this
 * mirrors and the security rationale, and
 * supabase/fixes/2026-07-02-community-letters-pending-review.sql for the
 * `pending_review` status added for Letters of Support.
 */

export type CommunityCaseStatus = 'draft' | 'published' | 'closed';

export type CommunityCaseLinkPlatform =
  | 'gofundme'
  | 'cashapp'
  | 'zelle'
  | 'venmo'
  | 'paypal'
  | 'other';

export const COMMUNITY_CASE_LINK_PLATFORM_LABEL: Record<CommunityCaseLinkPlatform, string> = {
  gofundme: 'GoFundMe',
  cashapp: 'Cash App',
  zelle: 'Zelle',
  venmo: 'Venmo',
  paypal: 'PayPal',
  other: 'Other',
};

export type CommunityCase = {
  id: string;
  caseId: string;
  organizerUserId: string;
  caseNumber: string;
  slug: string;
  displayName: string;
  publicSummary: string | null;
  bondAmountCents: number | null;
  hearingDisplayOverride: string | null;
  bannerImagePath: string | null;
  status: CommunityCaseStatus;
  searchIndexable: boolean;
  letterCount: number;
  evidenceCount: number;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommunityCaseLink = {
  id: string;
  communityCaseId: string;
  platform: CommunityCaseLinkPlatform;
  label: string | null;
  url: string | null;
  handle: string | null;
  sortOrder: number;
};

/** The narrow, public-safe shape returned by get_public_community_case(). */
export type PublicCommunityCase = {
  caseNumber: string;
  slug: string;
  displayName: string;
  publicSummary: string | null;
  bondAmountCents: number | null;
  hearingDisplayOverride: string | null;
  bannerImagePath: string | null;
  status: CommunityCaseStatus;
  letterCount: number;
  evidenceCount: number;
  publishedAt: string | null;
  closedAt: string | null;
};

export type PublicCommunityCaseLink = {
  platform: CommunityCaseLinkPlatform;
  label: string | null;
  url: string | null;
  handle: string | null;
  sortOrder: number;
};

export type WitnessSubmissionKind = 'letter_of_support' | 'evidence';
export type WitnessSubmissionStatus =
  /** Letters of Support only - see the pending-review migration's comment
   * for why: no malware/AV scanning is wired up yet, so ID photos land
   * here instead of `received` and the organizer UI gates opening them
   * behind an explicit warning until someone marks the submission reviewed. */
  | 'pending_review'
  | 'received'
  | 'reviewed'
  | 'flagged'
  | 'pending_purge'
  | 'purged';

export type MailingAddress = {
  street: string;
  city: string;
  state: string;
  zip: string;
};

export type WitnessSubmission = {
  id: string;
  communityCaseId: string;
  caseId: string;
  kind: WitnessSubmissionKind;
  fullName: string | null;
  mailingAddress: MailingAddress | null;
  letterBody: string | null;
  signatureImagePath: string | null;
  idFrontPath: string | null;
  idBackPath: string | null;
  evidenceFilePath: string | null;
  evidenceFileName: string | null;
  evidenceFileType: string | null;
  evidenceFileSize: number | null;
  testimonialText: string | null;
  status: WitnessSubmissionStatus;
  createdAt: string;
};

/** 6-char code from a Crockford-Base32-style alphabet with 0/O/1/I/L
 * removed - avoids transcription errors when read off a flyer or spoken
 * out loud at a bond hearing. */
const CASE_NUMBER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function generateCaseNumber(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += CASE_NUMBER_ALPHABET[Math.floor(Math.random() * CASE_NUMBER_ALPHABET.length)];
  }
  return `CC-${out}`;
}

/**
 * Shared input shape for both export generators (lib/pdf.ts
 * generateCommunitySubmissionsPdf and lib/docx-export.ts
 * generateCommunitySubmissionsDocx). Defined once so the two generators
 * can't drift apart on what data they expect the export route to
 * assemble - the route builds this once and feeds it to either.
 */
export type CommunityExportData = {
  caseTitle: string;
  communityCase: {
    caseNumber: string;
    displayName: string;
    publicSummary: string | null;
    status: string;
    letterCount: number;
    evidenceCount: number;
  };
  organizer: { name: string; email: string; accountCreatedAt: string | null };
  submissions: Array<{
    kind: 'letter_of_support' | 'evidence';
    fullName: string | null;
    testimonialText: string | null;
    evidenceFileName: string | null;
    evidenceFileType: string | null;
    evidenceFileSize: number | null;
    createdAt: string;
    /** Loaded up front by the caller; only image types are drawn inline -
     * PDF/other evidence gets a "see attached file" note in v1 rather than
     * a full splice-in (that infrastructure exists for case exhibits via
     * mergeExhibitPdfs and can be extended here in a later pass). */
    imageBuffer?: Buffer | null;
    /** Letter of Support fields - present only when kind is 'letter_of_support'. */
    mailingAddress?: MailingAddress | null;
    letterBody?: string | null;
    signatureBuffer?: Buffer | null;
    idFrontBuffer?: Buffer | null;
    idBackBuffer?: Buffer | null;
  }>;
};

/** URL-safe slug: organizer's display name + a short suffix from the case
 * number, so the link is readable but still effectively unguessable. */
export function generateSlug(displayName: string, caseNumber: string): string {
  const base = displayName
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const suffix = caseNumber.replace('CC-', '').toLowerCase();
  return base ? `${base}-${suffix}` : suffix;
}
