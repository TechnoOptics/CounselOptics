import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { sendSms, isSmsConfigured } from '@/lib/sms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/safe/alert
 *
 * Trigger a Safe Witness alert to the user's configured safe
 * contact. Accepts either a Bearer adv_ token (the Wear OS watch
 * calls this with its read-scoped token; we treat the watch as
 * authorized to fire on the user's behalf since the user physically
 * tapped + held the button on their wrist) OR a Supabase session
 * cookie (the web /safe page).
 *
 * Body: { transcription?: string, source: 'watch' | 'web' | 'mobile',
 *         note?: string, lat?: number, lng?: number }
 *
 * Side effects:
 *   1. Looks up profiles.safe_contact_email for the user. If empty
 *      -> 400 with a clear "configure a safe contact first" message.
 *   2. Inserts a safe_witness_alerts row (audit). Created BEFORE the
 *      email send so a delivery failure still leaves a record.
 *   3. Sends a Resend email to the contact with timestamp, watcher
 *      identity, transcription (if any), and a short canned
 *      explainer of what Safe Witness is. Updates the audit row
 *      with email_sent + email_error.
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
      { error: 'Safe Witness requires a user-bound token.' },
      { status: 403 },
    );
  }

  let body: {
    transcription?: string;
    source?: 'watch' | 'web' | 'mobile';
    note?: string;
    lat?: number;
    lng?: number;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const sourceRaw = String(body.source ?? '').trim().toLowerCase();
  const source = ['watch', 'web', 'mobile'].includes(sourceRaw)
    ? (sourceRaw as 'watch' | 'web' | 'mobile')
    : 'watch';
  const transcription = (body.transcription ?? '').toString().slice(0, 6000);
  const note = (body.note ?? '').toString().slice(0, 1000);

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: 'Server misconfigured.' },
      { status: 500 },
    );
  }

  // Resolve the safe contact + the user's email for the message
  // body.
  const [profileResp, userResp, contactsResp] = await Promise.all([
    admin
      .from('profiles')
      .select(
        'safe_contact_email, safe_witness_pin, safe_witness_message, display_name',
      )
      .eq('id', userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(userId),
    admin
      .from('safe_witness_contacts')
      .select('id, display_name, email, phone')
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  ]);
  const profileRow = profileResp.data as
    | {
        safe_contact_email: string | null;
        safe_witness_pin: string | null;
        safe_witness_message: string | null;
        display_name: string | null;
      }
    | null;
  const userPin = profileRow?.safe_witness_pin?.trim() || null;
  const userMessage =
    profileRow?.safe_witness_message?.trim() ||
    'Safe mode activated. I need you. Please send help.';

  // Multi-contact: prefer the new safe_witness_contacts table. Fall
  // back to the legacy single safe_contact_email if the table is
  // empty (covers users who configured before the migration but
  // didn't yet re-save through the new UI).
  type ContactRow = {
    id: string;
    display_name: string | null;
    email: string | null;
    phone: string | null;
  };
  let contacts = (contactsResp.data as ContactRow[] | null) ?? [];
  if (contacts.length === 0 && profileRow?.safe_contact_email) {
    contacts = [
      {
        id: 'legacy',
        display_name: null,
        email: profileRow.safe_contact_email,
        phone: null,
      },
    ];
  }
  // Require at least one routable channel across the whole list.
  // A contact row without email AND without phone is filtered out
  // by the DB CHECK, so this just guards against an empty list.
  const routableContacts = contacts.filter((c) => c.email || c.phone);
  if (routableContacts.length === 0) {
    return NextResponse.json(
      {
        error:
          'No safe contacts configured. Add at least one at /profile under Safe Witness, then try again.',
      },
      { status: 400 },
    );
  }
  // Keep the existing audit-row's contact_email column populated
  // (primary email if any) for back-compat with old read paths.
  const contact = routableContacts.find((c) => c.email)?.email ?? '(sms-only)';
  const watcherEmail = userResp.data?.user?.email ?? null;
  const watcherName =
    ((profileResp.data as { display_name?: string } | null)?.display_name
      ?? null) ||
    (userResp.data?.user?.user_metadata as { full_name?: string } | null)
      ?.full_name ||
    null;
  const watcherLabel =
    watcherName && watcherEmail
      ? `${watcherName} (${watcherEmail})`
      : watcherEmail || 'an Advottic user';

  const firedAt = new Date();
  const metadata: Record<string, unknown> = {
    note,
    message: userMessage,
    pin_included: userPin !== null,
  };
  if (typeof body.lat === 'number' && typeof body.lng === 'number') {
    metadata.lat = body.lat;
    metadata.lng = body.lng;
  }

  // Audit row first so any later failure (email send, etc.) still
  // leaves a record the user can inspect.
  const insertResp = await admin
    .from('safe_witness_alerts')
    .insert({
      user_id: userId,
      fired_at: firedAt.toISOString(),
      source,
      transcription: transcription || null,
      contact_email: contact,
      metadata,
    })
    .select('id')
    .maybeSingle();
  if (insertResp.error) {
    return NextResponse.json(
      { error: insertResp.error.message },
      { status: 500 },
    );
  }
  const alertId = (insertResp.data as { id: string } | null)?.id;

  // Build + send the email. Plain HTML kept simple so it reads on a
  // phone preview without horizontal scroll.
  const tsHuman = firedAt.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  // Location pack: every URL the email/SMS can offer in one place.
  // If we don't have lat/lng, everything but Call 911 becomes null
  // and the email gracefully skips those rows.
  const hasLoc =
    typeof body.lat === 'number' && typeof body.lng === 'number';
  const lat = hasLoc ? body.lat! : null;
  const lng = hasLoc ? body.lng! : null;
  const mapLink = hasLoc
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : null;
  const directionsLink = hasLoc
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    : null;
  // Static Map image for the email body. Server-only env var
  // preferred; falls back to the public Maps key if present.
  // When neither is set, the map image is omitted; all the other
  // links still work (they don't require an API key).
  const mapsApiKey =
    (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim() ||
    null;
  const staticMapUrl =
    hasLoc && mapsApiKey
      ? `https://maps.googleapis.com/maps/api/staticmap?` +
        new URLSearchParams({
          center: `${lat},${lng}`,
          zoom: '15',
          size: '600x300',
          scale: '2',
          maptype: 'roadmap',
          markers: `color:red|label:S|${lat},${lng}`,
          key: mapsApiKey,
        }).toString()
      : null;
  // Mailto link that pre-fills a fresh email so the contact can
  // forward the alert to family / police / a second responder in
  // one tap. Body cap kept short - long mailto bodies break in
  // Gmail iOS.
  const shareSubject = encodeURIComponent(
    `Safe Witness alert: ${watcherLabel.split(' (')[0]}`,
  );
  const shareBody = encodeURIComponent(
    [
      `${watcherLabel.split(' (')[0]} just triggered an Advottic Safe Witness alert.`,
      '',
      userMessage,
      '',
      tsHuman,
      mapLink ? `Location: ${mapLink}` : null,
      'Forward this to anyone who needs to know.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  const shareLink = `mailto:?subject=${shareSubject}&body=${shareBody}`;
  const call911Link = 'tel:911';

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #0B1F19; color: #FBF7E9;">
  <div style="text-align: center; padding-bottom: 16px; border-bottom: 1px solid rgba(230, 206, 147, 0.25);">
    <p style="margin: 0; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; color: #E5816B; font-weight: 600;">Safe Witness Alert</p>
    <h1 style="margin: 8px 0 0; font-size: 24px; color: #E6CE93; font-weight: 600;">${watcherLabel}</h1>
  </div>

  <!-- The user's message is the loudest thing in the email - this
       is what they want their contact to read first. Big, gold,
       centered, never wrapped in noise. -->
  <div style="text-align: center; padding: 24px 12px; background: rgba(229, 129, 107, 0.08); border-radius: 12px; margin: 20px 0;">
    <p style="margin: 0; font-size: 19px; line-height: 1.4; color: #FBF7E9; font-weight: 500;">
      ${escapeHtml(userMessage)}
    </p>
  </div>

  ${
    userPin
      ? `<div style="text-align: center; padding: 14px 0; margin: 0 0 20px;">
           <p style="margin: 0 0 6px; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: rgba(251, 247, 233, 0.55);">Verification PIN (the code they pre-shared with you)</p>
           <p style="margin: 0; font-family: 'SFMono-Regular', Menlo, monospace; font-size: 28px; letter-spacing: 6px; color: #E6CE93; font-weight: 700;">
             ${escapeHtml(userPin)}
           </p>
           <p style="margin: 6px 0 0; font-size: 11px; color: rgba(251, 247, 233, 0.55);">
             If this matches what ${watcherLabel.split(' (')[0]} told you in advance, this alert is genuine.
           </p>
         </div>`
      : ''
  }

  ${
    staticMapUrl
      ? `<div style="margin: 0 0 16px;">
           <a href="${mapLink}" style="display: block; text-decoration: none;">
             <img src="${staticMapUrl}" alt="Their location on a map" width="600" style="display: block; width: 100%; max-width: 600px; height: auto; border-radius: 12px; border: 1px solid rgba(230, 206, 147, 0.25);" />
           </a>
           <p style="margin: 6px 0 0; font-size: 11px; color: rgba(251, 247, 233, 0.45); text-align: center;">
             Marker shows their location at the moment the alert fired.
           </p>
         </div>`
      : hasLoc
        ? `<p style="margin: 0 0 16px; font-size: 12px; color: rgba(251, 247, 233, 0.55);">
             Map preview disabled (operator: set GOOGLE_MAPS_API_KEY to enable). Use the View Location button below.
           </p>`
        : ''
  }

  <!-- Action buttons. Table-based so every email client (Outlook
       included) renders them as full-width tappable rectangles
       instead of inline links. Two rows of two on mobile, single
       wide row on desktop. -->
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 20px;">
    <tr>
      <td width="50%" style="padding: 4px;">
        <a href="${call911Link}" style="display: block; padding: 14px 8px; background: #E5816B; color: #FBF7E9; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px; letter-spacing: 0.5px;">
          Call 911
        </a>
      </td>
      <td width="50%" style="padding: 4px;">
        ${
          directionsLink
            ? `<a href="${directionsLink}" style="display: block; padding: 14px 8px; background: #E6CE93; color: #0B1F19; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px; letter-spacing: 0.5px;">Get directions</a>`
            : `<span style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.15); color: rgba(251, 247, 233, 0.4); text-align: center; border-radius: 10px; font-weight: 600; font-size: 13px;">No location captured</span>`
        }
      </td>
    </tr>
    <tr>
      <td width="50%" style="padding: 4px;">
        ${
          mapLink
            ? `<a href="${mapLink}" style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.15); color: #E6CE93; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 13px;">View location</a>`
            : `<span style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.05); color: rgba(251, 247, 233, 0.3); text-align: center; border-radius: 10px; font-weight: 600; font-size: 13px;">View location</span>`
        }
      </td>
      <td width="50%" style="padding: 4px;">
        <a href="${shareLink}" style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.15); color: #E6CE93; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 13px;">Share alert</a>
      </td>
    </tr>
  </table>

  <div style="padding: 0 0 20px;">
    <p style="margin: 16px 0 6px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: rgba(251, 247, 233, 0.55);">Fired at</p>
    <p style="margin: 0 0 16px; font-family: 'SFMono-Regular', Menlo, monospace; font-size: 15px; color: #E6CE93;">
      ${tsHuman}
    </p>
    <p style="margin: 0 0 16px; line-height: 1.55; color: rgba(251, 247, 233, 0.75);">
      Triggered from <strong>${source === 'watch' ? 'their Wear OS watch' : source === 'mobile' ? 'their phone' : 'the web'}</strong>. The watch button has to be PRESSED AND HELD for four full seconds to fire - this isn't an accidental tap.
    </p>
    ${
      transcription
        ? `<p style="margin: 16px 0 6px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: rgba(251, 247, 233, 0.55);">Voice transcription</p>
           <blockquote style="margin: 0 0 16px; padding: 12px 16px; background: rgba(251, 247, 233, 0.06); border-left: 3px solid #E6CE93; border-radius: 4px; font-size: 14px; line-height: 1.55; color: #FBF7E9;">
             ${escapeHtml(transcription)}
           </blockquote>`
        : ''
    }
    ${
      note
        ? `<p style="margin: 16px 0 6px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: rgba(251, 247, 233, 0.55);">Additional note</p>
           <p style="margin: 0 0 16px; line-height: 1.55;">${escapeHtml(note)}</p>`
        : ''
    }
  </div>

  <div style="padding-top: 16px; border-top: 1px solid rgba(230, 206, 147, 0.25); font-size: 12px; color: rgba(251, 247, 233, 0.6); line-height: 1.55;">
    <p style="margin: 0 0 8px;">
      <strong style="color: #FBF7E9;">What to do next:</strong> call ${watcherLabel.split(' (')[0]} right now. If they don't pick up, the next step depends on what you know about their situation - their last known location, who they were with, or whether you need to escalate to local emergency services (in the US: 911).
    </p>
    <p style="margin: 0;">
      Safe Witness is a feature in Advottic that lets a user discreetly
      notify someone they trust when they feel unsafe. You were chosen as that contact.
    </p>
  </div>
</div>`;
  // Fan out: every contact gets the alert via every channel they
  // listed. Email AND SMS go out concurrently per contact via
  // Promise.allSettled so a single failure (Twilio rate limit, a
  // typo'd phone) never blocks the rest of the deliveries.
  //
  // The SMS body is a single 1-2 sentence version of the alert so
  // it fits in one or two segments. Email carries the full HTML.
  const watcherFirstName = watcherLabel.split(' (')[0];
  // SMS body: every link a contact needs in one tap. Newlines
  // separate sections so each link is recognizable on iOS/Android.
  // Twilio segments at 153 chars (GSM-7) - this typically spans
  // 2-4 segments, which is acceptable for an emergency alert.
  const smsBody = [
    `ADVOTTIC SAFE WITNESS - ${watcherFirstName}`,
    userMessage,
    userPin ? `PIN: ${userPin}` : null,
    mapLink ? `Location: ${mapLink}` : null,
    directionsLink ? `Directions: ${directionsLink}` : null,
    'Call 911: tel:911',
  ]
    .filter(Boolean)
    .join('\n');

  type Dispatch =
    | {
        kind: 'email';
        to: string;
        contactName: string | null;
        ok: boolean;
        error?: string;
      }
    | {
        kind: 'sms';
        to: string;
        contactName: string | null;
        ok: boolean;
        error?: string;
      };
  const dispatches: Dispatch[] = [];
  const tasks: Promise<void>[] = [];

  for (const c of routableContacts) {
    if (c.email) {
      tasks.push(
        sendEmail({
          to: c.email,
          subject: `Safe Witness alert from ${watcherFirstName}`,
          html,
          fromName: 'Advottic Safe Witness',
        }).then((r) => {
          dispatches.push({
            kind: 'email',
            to: c.email!,
            contactName: c.display_name,
            ok: r.ok,
            error: r.ok ? undefined : r.error,
          });
        }),
      );
    }
    if (c.phone) {
      tasks.push(
        sendSms({ to: c.phone, body: smsBody }).then((r) => {
          dispatches.push({
            kind: 'sms',
            to: c.phone!,
            contactName: c.display_name,
            ok: r.ok,
            // 'sms-not-configured' is a deployment state, not a
            // delivery failure - surface it distinctly so the
            // caller can degrade the UI without alarming the user.
            error: r.ok ? undefined : r.error,
          });
        }),
      );
    }
  }
  await Promise.allSettled(tasks);

  const anyEmail = dispatches.some((d) => d.kind === 'email');
  const anyEmailOk = dispatches.some((d) => d.kind === 'email' && d.ok);
  const anySmsAttempted = dispatches.some((d) => d.kind === 'sms');
  const anySmsOk = dispatches.some((d) => d.kind === 'sms' && d.ok);
  const allFailed = dispatches.length > 0 && dispatches.every((d) => !d.ok);

  // Update the audit row with the dispatch results. Best-effort -
  // we never 500 a Safe Witness alert just because the audit-row
  // update failed.
  if (alertId) {
    try {
      await admin
        .from('safe_witness_alerts')
        .update({
          // Existing columns: email_sent reflects whether ANY email
          // succeeded; email_error captures the first failure
          // if all failed.
          email_sent: anyEmailOk,
          email_error: anyEmailOk
            ? null
            : dispatches.find((d) => !d.ok)?.error ?? null,
          metadata: {
            ...metadata,
            dispatches: dispatches.map((d) => ({
              kind: d.kind,
              to: d.to,
              contact_name: d.contactName,
              ok: d.ok,
              error: d.error ?? null,
            })),
            sms_configured: isSmsConfigured(),
          },
        })
        .eq('id', alertId);
    } catch {
      /* swallow - audit best-effort */
    }
  }

  if (allFailed) {
    return NextResponse.json(
      {
        ok: false,
        error: `Could not reach any contact. Failures: ${dispatches
          .map((d) => `${d.kind}:${d.error}`)
          .join(' | ')}`,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    alert_id: alertId ?? null,
    contacts_alerted: routableContacts.length,
    email_dispatched: anyEmail,
    email_ok: anyEmailOk,
    sms_attempted: anySmsAttempted,
    sms_ok: anySmsOk,
    sms_configured: isSmsConfigured(),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
