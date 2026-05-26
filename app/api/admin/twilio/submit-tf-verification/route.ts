import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/twilio/submit-tf-verification
 *
 * Submit a Toll-Free Verification request for a freshly-purchased
 * toll-free number. Body: { phone_number_sid: 'PN...' }.
 *
 * Reuses the same description / message samples / privacy URL /
 * terms URL we filed with the A2P 10DLC campaign so reviewers see
 * a consistent narrative across both submissions. Typical TF
 * verification window is 1-5 business days vs 2-3 weeks for A2P.
 *
 * Required fields per Twilio docs:
 *   - BusinessName, BusinessWebsite, BusinessStreetAddress, City,
 *     State, PostalCode, Country
 *   - BusinessContactFirstName, LastName, Email, Phone
 *   - NotificationEmail
 *   - UseCaseCategories[]
 *   - UseCaseSummary
 *   - ProductionMessageSample[]
 *   - OptInImageUrls[] (required for marketing/notifications)
 *   - OptInType (VERBAL | WEB_FORM | PAPER_FORM | VIA_TEXT | MOBILE_QR_CODE)
 *   - MessageVolume (10 | 100 | 1,000 | 10,000 | 100,000 | 250,000 | 500,000 | 750,000 | 1,000,000 | 5,000,000 | 10,000,000+)
 *   - TollfreePhoneNumberSid
 *
 * If anything is missing Twilio returns a 4xx with a precise error
 * which we surface verbatim so the caller can patch + retry.
 */

const ADMIN_EMAILS = new Set<string>(['contact@advottic.com']);

const MESSAGING_BASE = 'https://messaging.twilio.com/v1';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }
  if (!user.email || !ADMIN_EMAILS.has(user.email.toLowerCase())) {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) {
    return NextResponse.json(
      { error: 'Twilio creds not set on the server.' },
      { status: 503 },
    );
  }

  let body: { phone_number_sid?: string; ein?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const pnSid = body.phone_number_sid?.trim();
  if (!pnSid || !pnSid.startsWith('PN')) {
    return NextResponse.json(
      { error: 'phone_number_sid (PN...) required.' },
      { status: 400 },
    );
  }
  // EIN required because the business is registered as an LLC (per
  // the Trust Hub Customer Profile). Twilio refuses TF verification
  // without it.
  const ein = body.ein?.trim().replace(/[-\s]/g, '') ?? '';
  if (!/^\d{9}$/.test(ein)) {
    return NextResponse.json(
      { error: 'EIN must be 9 digits (e.g. 12-3456789).' },
      { status: 400 },
    );
  }

  // Reuse the exact narrative + message samples we filed on the
  // A2P 10DLC campaign so the reviewer sees a consistent story.
  const form = new URLSearchParams();
  form.set('TollfreePhoneNumberSid', pnSid);
  form.set('BusinessName', 'Techno Optics LLC (Advottic)');
  form.set('BusinessWebsite', 'https://advottic.com');
  form.set('NotificationEmail', 'contact@advottic.com');
  // Twilio TF taxonomy (verified from API 400 error response):
  //   TWO_FACTOR_AUTHENTICATION, ACCOUNT_NOTIFICATIONS, CUSTOMER_CARE,
  //   CHARITY_NONPROFIT, DELIVERY_NOTIFICATIONS, FRAUD_ALERT_MESSAGING,
  //   EVENTS, HIGHER_EDUCATION, K12, MARKETING,
  //   POLLING_AND_VOTING_NON_POLITICAL, POLITICAL_ELECTION_CAMPAIGNS,
  //   PUBLIC_SERVICE_ANNOUNCEMENT, SECURITY_ALERT
  // Twilio's TF endpoint accepts a SINGLE category. Safe Witness is
  // most precisely a SECURITY_ALERT (imminent-physical-danger
  // notification to trusted contacts). The pre-shared PIN inside
  // each alert is verification-flavored but not the primary use
  // case.
  form.set('UseCaseCategories', 'SECURITY_ALERT');
  // UseCaseSummary has a 500-char limit (verified from Twilio API
  // rejection 'Invalid use case summary'). Tight phrasing only.
  form.set(
    'UseCaseSummary',
    "Advottic Safe Witness sends a one-time emergency SMS to each trusted contact a user pre-saves in their account at advottic.com/profile. Triggered only when the user holds the Safe Witness button on their Wear OS watch for 4 seconds, or the equivalent web button. Message contains a pre-shared verification PIN, GPS location, and a link to call 911. No recurring sends, no marketing, only user-initiated emergency alerts.",
  );
  form.set(
    'ProductionMessageSample',
    "ADVOTTIC SAFE WITNESS - Abel\nSafe mode activated. I need you. Please send help.\nPIN: 4429\nLocation: https://www.google.com/maps?q=44.7619,-93.4731\nDirections: https://www.google.com/maps/dir/?api=1&destination=44.7619,-93.4731\nCall 911: tel:911\nReply STOP to opt out, HELP for help.",
  );
  form.append(
    'ProductionMessageSample',
    "Hi Friend - ADVOTTIC SAFE WITNESS - Jamie\nSafe mode activated. I need you. Please send help.\nPIN: 1234\nLocation: https://www.google.com/maps?q=37.7749,-122.4194\nCall Jamie: tel:+15555550199\nCall 911: tel:911",
  );
  form.set('OptInType', 'WEB_FORM');
  form.set(
    'OptInImageUrls',
    'https://advottic.com/profile',
  );
  form.set('MessageVolume', '10'); // Estimated daily volume - personal-safety alerts are inherently low-volume.
  // Business contact - Twilio surfaces this to the reviewer.
  form.set('BusinessContactFirstName', 'Abel');
  form.set('BusinessContactLastName', 'Muchai');
  form.set('BusinessContactEmail', 'contact@advottic.com');
  form.set('BusinessContactPhone', '+19523001600');
  // Business address - the Trust Hub Customer Profile already has
  // this but the TF verification asks for it separately.
  form.set('BusinessStreetAddress', '6800 France Ave S');
  form.set('BusinessStreetAddress2', 'Suite 158');
  form.set('BusinessCity', 'Edina');
  form.set('BusinessStateProvinceRegion', 'MN');
  form.set('BusinessPostalCode', '55435');
  form.set('BusinessCountry', 'US');
  // Business entity type + registration. Twilio's TF endpoint
  // uses BusinessRegistrationAuthority to enumerate the *type* of
  // identifier (EIN, VAT, CBN, etc.) and BusinessRegistrationNumber
  // for the actual identifier value. Verified from API 400 error:
  //   "form field BusinessRegistrationAuthority must be one of
  //    [EIN, CBN, CRN, PROVINCIAL_NUMBER, VAT, ACN, ABN, BRN,
  //     SIREN, SIRET, NZBN, USt-IdNr, CIF, NIF, CNPJ, UID, NEQ,
  //     OTHER]"
  // For a US LLC the authority is EIN.
  // Twilio TF BusinessType enum (verified from API 400):
  //   [PRIVATE_PROFIT, PUBLIC_PROFIT, SOLE_PROPRIETOR, NON_PROFIT, GOVERNMENT]
  // A Minnesota LLC owned by individuals is PRIVATE_PROFIT.
  form.set('BusinessType', 'PRIVATE_PROFIT');
  form.set('BusinessRegistrationNumber', ein);
  form.set('BusinessRegistrationAuthority', 'EIN');
  form.set('BusinessIndustry', 'TECHNOLOGY');
  // We don't sell embedded direct lending; we DO send embedded
  // phone numbers (tel:911 and tel:<user phone>) + embedded links
  // (Maps + Directions). Twilio gates on these specifically.
  form.set('AdditionalInformation', 'Each alert contains tel: links to 911 and the watcher\'s configured callback number, plus Google Maps links to the GPS location and driving directions. These are functional emergency-response affordances, not marketing.');

  const basicAuth = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  const resp = await fetch(`${MESSAGING_BASE}/Tollfree/Verifications`, {
    method: 'POST',
    headers: {
      Authorization: basicAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const text = await resp.text();
  if (!resp.ok) {
    return NextResponse.json(
      {
        ok: false,
        status: resp.status,
        error: 'Twilio TF verification submission failed.',
        detail: text.slice(0, 2000),
      },
      { status: 502 },
    );
  }
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { raw: text };
  }
  return NextResponse.json({ ok: true, verification: parsed });
}
