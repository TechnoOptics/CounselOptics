import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentUser, isCurrentUserAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/twilio/buy-tf
 *
 * Admin-only Twilio helper: searches for an available US toll-free
 * SMS-capable number, purchases it, and attaches it to the existing
 * Messaging Service (TWILIO_FROM when that env var is a MG... SID).
 * This bypasses the Twilio Console "Buy a Number" UI, which has been
 * locking up under the load of paginated results when filtering by
 * type/capability. The Twilio REST API is rock-solid for the same
 * operations.
 *
 * Auth: isCurrentUserAdmin, which reads profiles.is_admin. This is
 * the HQ axis, and it is the same one app/admin and the other
 * /api/admin routes use. It used to be a Set of email addresses
 * written into this file, which was wrong in both directions: it
 * kept granting access to anyone whose address was still listed
 * after they left, and it was invisible to whoever manages admin
 * access, who has no reason to expect a grant to live in a route
 * handler. Revoking admin in the database now revokes it here.
 *
 * This is the only place in the codebase that directly touches
 * Twilio's account-level APIs (buying numbers, changing senders),
 * and a route handler is a public HTTP endpoint, so the check has
 * to be here rather than on whatever page links to it.
 *
 * Response: { ok: true, phone_number: '+18...', phone_number_sid:
 * 'PNxxx', messaging_service_sid: 'MGxxx', attached: true }
 *
 * Idempotency: not idempotent - re-calling buys another number. The
 * caller is responsible for only invoking once per intended purchase.
 */

const TWILIO_BASE = 'https://api.twilio.com/2010-04-01';
const MESSAGING_BASE = 'https://messaging.twilio.com/v1';

export async function POST(_req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 });
  }
  if (!(await isCurrentUserAdmin())) {
    return NextResponse.json(
      { error: 'Admin only.' },
      { status: 403 },
    );
  }

  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM?.trim();
  if (!sid || !token) {
    return NextResponse.json(
      { error: 'TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN must be set.' },
      { status: 503 },
    );
  }
  // Resolve the Messaging Service SID. Either TWILIO_FROM is itself
  // a MG... SID (the preferred config), or we have to bail because
  // we don't know which service to attach the new TF number to.
  const messagingServiceSid = from && from.startsWith('MG') ? from : null;
  if (!messagingServiceSid) {
    return NextResponse.json(
      {
        error:
          "TWILIO_FROM doesn't look like a Messaging Service SID (MG...). Set it to the Messaging Service that owns the 10DLC campaign so the toll-free number lands in the same service.",
      },
      { status: 503 },
    );
  }

  const basicAuth = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  const headers = { Authorization: basicAuth };

  // 1) Find an available US toll-free SMS-capable number. PageSize=1
  // because we only buy one per call and the API guarantees the
  // first result is buyable at the moment of the lookup.
  const searchUrl =
    `${TWILIO_BASE}/Accounts/${sid}/AvailablePhoneNumbers/US/TollFree.json` +
    `?SmsEnabled=true&PageSize=1`;
  const searchResp = await fetch(searchUrl, { headers });
  if (!searchResp.ok) {
    const errText = await searchResp.text().catch(() => '');
    return NextResponse.json(
      {
        error: `Twilio search failed: ${searchResp.status}`,
        detail: errText.slice(0, 500),
      },
      { status: 502 },
    );
  }
  const searchJson = (await searchResp.json()) as {
    available_phone_numbers?: Array<{ phone_number?: string }>;
  };
  const available = searchJson.available_phone_numbers?.[0]?.phone_number;
  if (!available) {
    return NextResponse.json(
      { error: 'No US toll-free numbers available right now.' },
      { status: 503 },
    );
  }

  // 2) Buy the number. Twilio expects form-encoded; no JSON body.
  const buyForm = new URLSearchParams({
    PhoneNumber: available,
    FriendlyName: `Advottic Safe Witness ${new Date().toISOString().slice(0, 10)}`,
  });
  const buyResp = await fetch(
    `${TWILIO_BASE}/Accounts/${sid}/IncomingPhoneNumbers.json`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buyForm.toString(),
    },
  );
  if (!buyResp.ok) {
    const errText = await buyResp.text().catch(() => '');
    return NextResponse.json(
      {
        error: `Twilio purchase failed: ${buyResp.status}`,
        detail: errText.slice(0, 500),
      },
      { status: 502 },
    );
  }
  const boughtJson = (await buyResp.json()) as {
    sid?: string;
    phone_number?: string;
  };
  const phoneNumberSid = boughtJson.sid;
  const phoneNumber = boughtJson.phone_number ?? available;
  if (!phoneNumberSid) {
    return NextResponse.json(
      { error: 'Twilio purchase response missing PN sid.' },
      { status: 502 },
    );
  }

  // 3) Attach the new PN SID to the Messaging Service so outbound
  // sends via the existing sender pool can use it.
  const attachForm = new URLSearchParams({ PhoneNumberSid: phoneNumberSid });
  const attachResp = await fetch(
    `${MESSAGING_BASE}/Services/${messagingServiceSid}/PhoneNumbers`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: attachForm.toString(),
    },
  );
  const attached = attachResp.ok;
  let attachErr: string | null = null;
  if (!attached) {
    attachErr = (await attachResp.text().catch(() => '')).slice(0, 500);
  }

  return NextResponse.json({
    ok: true,
    phone_number: phoneNumber,
    phone_number_sid: phoneNumberSid,
    messaging_service_sid: messagingServiceSid,
    attached,
    attach_error: attachErr,
  });
}
