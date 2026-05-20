import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';

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
  const [profileResp, userResp] = await Promise.all([
    admin
      .from('profiles')
      .select(
        'safe_contact_email, safe_witness_pin, safe_witness_message, display_name',
      )
      .eq('id', userId)
      .maybeSingle(),
    admin.auth.admin.getUserById(userId),
  ]);
  const profileRow = profileResp.data as
    | {
        safe_contact_email: string | null;
        safe_witness_pin: string | null;
        safe_witness_message: string | null;
        display_name: string | null;
      }
    | null;
  const contact = profileRow?.safe_contact_email?.trim();
  const userPin = profileRow?.safe_witness_pin?.trim() || null;
  const userMessage =
    profileRow?.safe_witness_message?.trim() ||
    'Safe mode activated. I need you. Please send help.';
  if (!contact) {
    return NextResponse.json(
      {
        error:
          'No safe contact configured. Add one at /profile under Safe Witness, then try again.',
      },
      { status: 400 },
    );
  }
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
  const mapLink =
    typeof body.lat === 'number' && typeof body.lng === 'number'
      ? `https://www.google.com/maps?q=${body.lat},${body.lng}`
      : null;

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
    ${
      mapLink
        ? `<p style="margin: 16px 0 6px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: rgba(251, 247, 233, 0.55);">Location</p>
           <p style="margin: 0 0 16px; line-height: 1.55;"><a href="${mapLink}" style="color: #E6CE93;">Open in Google Maps</a></p>`
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
  const emailResp = await sendEmail({
    to: contact,
    subject: `Safe Witness alert from ${watcherLabel.split(' (')[0]}`,
    html,
    fromName: 'Advottic Safe Witness',
  });

  // Update the audit row with delivery result. Best-effort - we never
  // 500 a Safe Witness alert just because the audit-row update
  // failed.
  if (alertId) {
    try {
      await admin
        .from('safe_witness_alerts')
        .update({
          email_sent: emailResp.ok,
          email_error: emailResp.ok ? null : emailResp.error ?? 'unknown',
        })
        .eq('id', alertId);
    } catch {
      /* swallow - audit best-effort */
    }
  }

  if (!emailResp.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Could not send the alert email: ${emailResp.error}`,
      },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, contact, alert_id: alertId ?? null });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
