import { NextResponse, type NextRequest } from 'next/server';
import { verifyApiToken, tokenHasScope } from '@/lib/api-tokens';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { formatDateWith, formatDistanceFromMeters } from '@/lib/format';
import { sendSms, isSmsConfigured } from '@/lib/sms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Cap the function so a stuck email/SMS provider (each bounded to 8s via
// AbortSignal in lib/email + lib/sms) can't pin this safety-of-life route.
export const maxDuration = 20;

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
  // Two auth paths. Bearer adv_ token (watch) OR Supabase session
  // cookie (phone web view + desktop browser on /safe). Either way
  // we resolve to a user_id; everything else in the endpoint is
  // identical.
  let userId: string | null = null;
  const auth = req.headers.get('authorization');
  if (auth) {
    const verified = await verifyApiToken(auth);
    if (!verified) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }
    if (!tokenHasScope(verified, 'read')) {
      return NextResponse.json(
        { error: 'Token missing read scope.' },
        { status: 403 },
      );
    }
    userId = verified.userId;
  } else {
    const { getCurrentUser } = await import('@/lib/supabase/server');
    const user = await getCurrentUser().catch(() => null);
    userId = user?.id ?? null;
  }
  if (!userId) {
    return NextResponse.json(
      { error: 'Sign in or attach a bearer token to fire a Safe Witness alert.' },
      { status: 401 },
    );
  }

  let body: {
    transcription?: string;
    source?: 'watch' | 'web' | 'mobile';
    note?: string;
    lat?: number;
    lng?: number;
    /** 68%-confidence radius in meters from the device's
     *  FusedLocationProvider. Drives the "approximate location"
     *  banner + decides whether the pin renders confidently. */
    accuracy_m?: number;
    /** True when the device never reached a good GPS fix and is
     *  shipping the best last-known sample. We always treat this
     *  as approximate regardless of accuracy_m. */
    location_timed_out?: boolean;
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
        'safe_contact_email, safe_witness_pin, safe_witness_message, display_name, first_name, phone',
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
        first_name: string | null;
        phone: string | null;
      }
    | null;
  const userPin = profileRow?.safe_witness_pin?.trim() || null;
  const userMessage =
    profileRow?.safe_witness_message?.trim() ||
    'Safe mode activated. I need you. Please send help.';
  // User's own phone for the "Call user" button. Optional - the
  // button is only rendered when this is set.
  const userPhone = profileRow?.phone?.trim() || null;
  // Short, personal label used inside the SMS body and email
  // greeting ("Call Abel", "Hi Friend - ADVOTTIC SAFE WITNESS -
  // Abel"). Separate from display_name so users whose display_name
  // is a company ("Advottic LLC") still get a human-sounding label
  // on outbound alerts. Fallback chain: profiles.first_name ->
  // first token of display_name -> email local-part -> 'a friend'.
  const userFirstName = profileRow?.first_name?.trim() || null;

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
  // watcherName is the LONG label that appears as the alert headline
  // (e.g. the email's <h1>). It can legitimately be a company name
  // ("Advottic LLC") because the headline answers "whose alert is
  // this." For the more personal *first-name* references that read
  // aloud in SMS and in body copy ("Call Abel", "Hi Sarah - ABEL has
  // triggered a Safe Witness alert"), we use the dedicated
  // userFirstName field, falling back to the long name's first token
  // only when first_name isn't set.
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
  // Surface the accuracy + timeout flags in the audit row so the
  // founder can later inspect whether a pin was reliable. Critical
  // for the "did this user actually go to the place we showed"
  // forensic question after a Safe Witness fire.
  if (typeof body.accuracy_m === 'number') {
    metadata.accuracy_m = body.accuracy_m;
  }
  if (body.location_timed_out === true) {
    metadata.location_timed_out = true;
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
  const tsHuman = formatDateWith(firedAt, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  // Short clock-only form for inside the map caption, so the contact
  // sees "Last known location at 5:34 AM CDT" without the date noise.
  // Used to anchor the moving-target caveat: the longer it's been
  // since this timestamp, the wider the search radius the contact
  // should consider when responding.
  const timeShort = formatDateWith(firedAt, {
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
  // Accuracy gating - prevents the worst-case failure where the
  // email confidently shows a Wi-Fi-triangulated pin that's
  // hundreds of meters off. Anything wider than 150m gets the
  // "approximate" treatment: a warning banner is added, and the
  // pulsing-pin map is replaced with a coarse circle so the
  // contact doesn't trust the dot to the meter.
  const accuracyM =
    typeof body.accuracy_m === 'number' && body.accuracy_m > 0
      ? body.accuracy_m
      : null;
  const locationTimedOut = body.location_timed_out === true;
  const APPROX_THRESHOLD_M = 150;
  // True when the location is reliable enough to render as a pinned
  // dot. Coarse fixes still get a map + link, but rendered as a
  // wider circle and labeled "approximate" so the contact knows.
  const locationIsConfident =
    hasLoc &&
    !locationTimedOut &&
    accuracyM !== null &&
    accuracyM <= APPROX_THRESHOLD_M;
  // Human-readable label in US customary units: "±98 ft" / "±0.31 mi".
  // The contact reading this is in the United States and is about to
  // decide how far they have to travel.
  const accuracyLabel: string | null =
    accuracyM === null ? null : `±${formatDistanceFromMeters(accuracyM)}`;
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
  // Map zoom: tight when we trust the fix, wider when it's
  // approximate so the contact sees the surrounding blocks they
  // need to consider. The pin style also differs: confident fixes
  // get a labeled red drop-pin; approximate fixes get a smaller
  // dot inside a translucent radius circle drawn as a path
  // (Static Maps Encoded Polyline approximation isn't available
  // for true circles, so we hint at the radius with a wider zoom
  // and a less-confident label).
  const staticMapZoom = locationIsConfident ? '15' : '13';
  const staticMapMarkers = locationIsConfident
    ? `color:red|label:S|${lat},${lng}`
    : // Smaller dot, no letter, slightly muted color when we're not
      // sure - reads as "somewhere near here" not "exactly here."
      `color:0xCC4444|size:small|${lat},${lng}`;
  const staticMapUrl =
    hasLoc && mapsApiKey
      ? `https://maps.googleapis.com/maps/api/staticmap?` +
        new URLSearchParams({
          center: `${lat},${lng}`,
          zoom: staticMapZoom,
          // v6: was 600x300, bumped to 640x440 after user feedback
          // that the map was too compressed to actually read the
          // streets around the pin. Aspect is now ~1.45:1 which is
          // wide enough to span the email column and tall enough to
          // show a meaningful block radius around the marker.
          size: '640x440',
          scale: '2',
          maptype: 'roadmap',
          markers: staticMapMarkers,
          key: mapsApiKey,
        }).toString()
      : null;
  // Live tracker URL. Points at /safe/alert/<alert-id>, which is the
  // browser page that pairs the static map in the email with the
  // contact's own live position (via navigator.geolocation), updates
  // the distance read-out as they move, and surfaces the same quick-
  // action buttons. The URL contains an unguessable UUID so knowing
  // the link IS the auth - the recipient does not need an Advottic
  // account.
  // We fall back to the apex site URL if NEXT_PUBLIC_SITE_URL is
  // unset; this matters in dev where the host differs.
  const siteUrlForLinks =
    (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim().replace(/\/+$/, '') ||
    'https://advottic.com';
  const trackerLink = alertId
    ? `${siteUrlForLinks}/safe/alert/${alertId}`
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
  // One-tap dial to the user themselves. Many clients won't even
  // render tel: links if the value is malformed, so check first.
  const callUserLink =
    userPhone && /^\+[1-9]\d{1,14}$/.test(userPhone)
      ? `tel:${userPhone}`
      : null;
  // Pre-filled SMS to the user with a quick "I'm coming" so the
  // contact can reach back instantly. Falls back to the same tel:
  // link when no phone is set, so the button never breaks.
  const smsUserLink = userPhone
    ? `sms:${userPhone};?&body=${encodeURIComponent(
        `Hi - got your Advottic Safe Witness alert. On my way / call me back.`,
      )}`
    : null;
  // Maps searches for nearby emergency resources. Each opens the
  // Google Maps app/web with the search pre-populated at the user's
  // location.
  const hospitalsLink = hasLoc
    ? `https://www.google.com/maps/search/hospital/@${lat},${lng},15z`
    : `https://www.google.com/maps/search/hospital`;
  const policeLink = hasLoc
    ? `https://www.google.com/maps/search/police+station/@${lat},${lng},15z`
    : `https://www.google.com/maps/search/police+station`;

  // v3 enhancement: personalized per-contact greeting. Each contact
  // in the fan-out gets a copy with their own name in the salutation.
  // The rest of the email is shared, so we build it once and let the
  // function inject the greeting line.
  //
  // We render a pulsing red ring AROUND the map image using a
  // wrapper <td> with a CSS animation. Outlook + most email clients
  // strip @keyframes, so we also paint a solid red border as the
  // baseline. Clients that DO honor the animation (Apple Mail,
  // Gmail web on Chromium, Thunderbird) get the pulse.
  // Personal short label. Order of preference:
  //   1. profiles.first_name (explicitly set by user on /profile)
  //   2. first token of display_name -> handles "Sarah Connor" style
  //      but does NOT help users whose display_name is a company
  //      (e.g. "Advottic LLC" -> we don't want "Call Advottic")
  //   3. email local-part (last-resort human-ish string)
  //   4. literal 'a friend'
  // We only use option 2 when it looks like a personal first name
  // (single token, not the entire label, and the label has a space
  // separating first/last - companies usually don't).
  const looksLikePersonalName =
    watcherName !== null && watcherName.includes(' ');
  const fallbackFirst = looksLikePersonalName
    ? watcherName!.split(/\s+/)[0]
    : watcherEmail
      ? watcherEmail.split('@')[0]
      : 'a friend';
  const watcherFirst = userFirstName || fallbackFirst;
  const buildEmailHtml = (contactName: string | null): string => `
<div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #0B1F19; color: #FBF7E9;">
  <style>
    @keyframes advPulse {
      0%   { box-shadow: 0 0 0 0   rgba(229, 80, 80, 0.85); }
      70%  { box-shadow: 0 0 0 14px rgba(229, 80, 80, 0); }
      100% { box-shadow: 0 0 0 0   rgba(229, 80, 80, 0); }
    }
    .adv-pulse-wrap { animation: advPulse 1.6s ease-out infinite; }
  </style>
  <!-- Advottic brand header. We use the same gold 'A' mark that the
       Wear OS watch shows on its launcher + tile, so the recipient's
       inbox preview reads as the same product their watcher just used
       to fire the alert. v6: bumped from 72px to 128px after user
       feedback that the mark was too quiet relative to the headline
       under it. -->
  <div style="text-align: center; padding-bottom: 22px; margin-bottom: 6px; border-bottom: 1px solid rgba(230, 206, 147, 0.25);">
    <a href="https://advottic.com" style="text-decoration: none; display: inline-block;">
      <img
        src="https://advottic.com/advottic-mark.png"
        alt="Advottic"
        width="128"
        height="128"
        style="display: inline-block; width: 128px; height: 128px; max-width: 128px; margin: 0 0 16px;"
      />
    </a>
    <p style="margin: 0; font-size: 12px; letter-spacing: 3px; text-transform: uppercase; color: #E5816B; font-weight: 600;">Safe Witness Alert</p>
    <h1 style="margin: 10px 0 0; font-size: 26px; color: #E6CE93; font-weight: 600;">${watcherLabel}</h1>
  </div>

  ${
    contactName
      ? `<p style="margin: 18px 0 0; font-size: 15px; color: #FBF7E9; line-height: 1.5;">
           Hi <strong style="color: #E6CE93;">${escapeHtml(contactName)}</strong>,
         </p>
         <p style="margin: 6px 0 0; font-size: 14px; color: rgba(251, 247, 233, 0.75); line-height: 1.5;">
           ${escapeHtml(watcherFirst)} just triggered a Safe Witness alert and listed you as a trusted contact. Their message is below.
         </p>`
      : `<p style="margin: 18px 0 0; font-size: 14px; color: rgba(251, 247, 233, 0.75); line-height: 1.5;">
           ${escapeHtml(watcherFirst)} just triggered a Safe Witness alert and listed you as a trusted contact. Their message is below.
         </p>`
  }

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
             If this matches what ${escapeHtml(watcherFirst)} told you in advance, this alert is genuine.
           </p>
         </div>`
      : ''
  }

  ${
    // Approximate-location warning. Renders ABOVE the map whenever
    // we don't trust the dot. This is the "wrong pin can be life or
    // death" guardrail: rather than confidently showing a fix that
    // could be 800m off, we explicitly tell the contact "the dot
    // is approximate, treat the surrounding area as the search
    // zone."
    hasLoc && !locationIsConfident
      ? `<div style="margin: 0 0 12px; padding: 12px 16px; background: rgba(229, 129, 107, 0.18); border-radius: 10px; border-left: 3px solid #E5816B;">
           <p style="margin: 0; font-size: 13px; color: #FBF7E9; line-height: 1.55; font-weight: 600;">
             ${
               locationTimedOut
                 ? 'Approximate location - the watch could not get a precise GPS fix.'
                 : 'Approximate location - low-confidence fix.'
             }
           </p>
           <p style="margin: 4px 0 0; font-size: 12px; color: rgba(251, 247, 233, 0.85); line-height: 1.55;">
             ${
               accuracyLabel
                 ? `The pin below could be off by up to <strong>${accuracyLabel}</strong>. Treat the surrounding blocks as the search area, not the exact point.`
                 : 'Treat the surrounding blocks as the search area, not the exact point.'
             }
           </p>
         </div>`
      : ''
  }
  ${
    staticMapUrl
      ? `<div style="margin: 0 0 16px;">
           <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse: separate;">
             <tr>
               <td ${
                 locationIsConfident ? 'class="adv-pulse-wrap"' : ''
               } style="padding: 0; border-radius: 14px; border: 3px solid ${
                 locationIsConfident ? '#E55050' : 'rgba(229, 129, 107, 0.45)'
               };">
                 <a href="${trackerLink ?? mapLink}" style="display: block; text-decoration: none;">
                   <img src="${staticMapUrl}" alt="Their location on a map" width="600" style="display: block; width: 100%; max-width: 600px; height: auto; border-radius: 11px;" />
                 </a>
               </td>
             </tr>
           </table>
           <p style="margin: 8px 0 0; font-size: 11px; color: rgba(251, 247, 233, 0.55); text-align: center;">
             <span style="display: inline-block; width: 8px; height: 8px; background: ${
               locationIsConfident ? '#E55050' : '#CC4444'
             }; border-radius: 50%; vertical-align: middle; margin-right: 6px;"></span>
             ${
               locationIsConfident
                 ? `Last known location at <strong>${escapeHtml(timeShort)}</strong>. Tap to open the live tracker.`
                 : `Approximate location ${
                     accuracyLabel ? `(${accuracyLabel} radius)` : ''
                   } at <strong>${escapeHtml(timeShort)}</strong>. Tap to open the live tracker.`
             }
           </p>
           <!-- Moving-target caveat: the pin is a single point in
                time, captured the second the press fired. If
                ${escapeHtml(watcherFirst)} is being moved (by car,
                walking, etc.), the actual location now is somewhere
                near this dot but not exactly on it. The longer it
                takes you to read this email, the wider the search
                radius. Treat the pin as a starting point. -->
           <p style="margin: 6px 0 0; font-size: 11px; color: rgba(251, 247, 233, 0.55); text-align: center; font-style: italic;">
             ${escapeHtml(watcherFirst)} could be moving. Use this dot as a starting point - the longer ago this alert fired, the wider the search radius.
           </p>
         </div>`
      : hasLoc
        ? `<div style="margin: 0 0 16px; padding: 14px 16px; background: rgba(251, 247, 233, 0.04); border-radius: 10px; border-left: 3px solid rgba(229, 129, 107, 0.45);">
             <p style="margin: 0; font-size: 12.5px; color: rgba(251, 247, 233, 0.85); line-height: 1.55;">
               Map preview unavailable right now. Tap <strong>View location</strong> below to open the coordinates in Maps - the pin works regardless.
             </p>
             <p style="margin: 6px 0 0; font-size: 11px; color: rgba(251, 247, 233, 0.55); line-height: 1.55;">
               Last known location at <strong>${escapeHtml(timeShort)}</strong>. ${escapeHtml(watcherFirst)} could be moving - widen your search the longer this email has been sitting.
             </p>
           </div>`
        : ''
  }

  <!-- Voice / video clip section. v3 ships the transcription;
       audio + video bytes are a follow-up that requires
       MediaRecorder + a foreground service on the watch. Until then,
       we render the transcription as the recording-stand-in so the
       contact can read what was said. -->
  ${
    transcription
      ? `<div style="margin: 0 0 20px; padding: 14px 16px; background: rgba(230, 206, 147, 0.08); border-radius: 12px; border-left: 3px solid #E6CE93;">
           <p style="margin: 0 0 6px; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: rgba(251, 247, 233, 0.6);">
             ${source === 'watch' ? 'Voice memo from their watch' : 'Voice memo'}
           </p>
           <p style="margin: 0; font-size: 14px; line-height: 1.55; color: #FBF7E9; font-style: italic;">
             &ldquo;${escapeHtml(transcription)}&rdquo;
           </p>
           <p style="margin: 8px 0 0; font-size: 10.5px; color: rgba(251, 247, 233, 0.45); line-height: 1.4;">
             Transcribed from a one-minute clip captured at the moment the button was held. Audio playback will appear here in a future build.
           </p>
         </div>`
      : `<div style="margin: 0 0 20px; padding: 14px 16px; background: rgba(251, 247, 233, 0.04); border-radius: 12px; border-left: 3px solid rgba(230, 206, 147, 0.25);">
           <p style="margin: 0; font-size: 12px; color: rgba(251, 247, 233, 0.6); line-height: 1.55;">
             No voice memo accompanied this alert. ${escapeHtml(watcherFirst)} held the button silently or recording was unavailable.
           </p>
         </div>`
  }

  <!-- Quick-act buttons. Table-based so every email client (Outlook
       included) renders them as full-width tappable rectangles
       instead of inline links. Three rows of two: 911 + Directions
       (most urgent), Call User + Text User (reach them), Hospitals
       + Police (find help nearby). View + Share live in a final row
       so the primary actions stay above the fold. -->
  <p style="margin: 14px 0 8px; font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: rgba(251, 247, 233, 0.55); text-align: center;">Quick actions</p>
  ${
    trackerLink
      ? `<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin: 0 0 8px;">
           <tr>
             <td style="padding: 4px;">
               <a href="${trackerLink}" style="display: block; padding: 16px 8px; background: #E6CE93; color: #0B1F19; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 800; font-size: 15px; letter-spacing: 0.4px;">
                 Open live tracker &rarr;
               </a>
               <p style="margin: 6px 0 0; font-size: 10.5px; color: rgba(251, 247, 233, 0.55); text-align: center; line-height: 1.5;">
                 Shows ${escapeHtml(watcherFirst)}&rsquo;s last-known pin plus your own live position and the distance between you.
               </p>
             </td>
           </tr>
         </table>`
      : ''
  }
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
          callUserLink
            ? `<a href="${callUserLink}" style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.18); color: #E6CE93; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px; letter-spacing: 0.3px;">Call ${escapeHtml(watcherFirst)}</a>`
            : `<span style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.05); color: rgba(251, 247, 233, 0.3); text-align: center; border-radius: 10px; font-weight: 600; font-size: 12px;">No phone on file</span>`
        }
      </td>
      <td width="50%" style="padding: 4px;">
        ${
          smsUserLink
            ? `<a href="${smsUserLink}" style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.18); color: #E6CE93; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 700; font-size: 14px; letter-spacing: 0.3px;">Text &ldquo;On my way&rdquo;</a>`
            : `<span style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.05); color: rgba(251, 247, 233, 0.3); text-align: center; border-radius: 10px; font-weight: 600; font-size: 12px;">No phone on file</span>`
        }
      </td>
    </tr>
    <tr>
      <td width="50%" style="padding: 4px;">
        <a href="${hospitalsLink}" style="display: block; padding: 14px 8px; background: rgba(229, 129, 107, 0.15); color: #FBF7E9; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 13px;">Hospitals nearby</a>
      </td>
      <td width="50%" style="padding: 4px;">
        <a href="${policeLink}" style="display: block; padding: 14px 8px; background: rgba(229, 129, 107, 0.15); color: #FBF7E9; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 13px;">Police nearby</a>
      </td>
    </tr>
    <tr>
      <td width="50%" style="padding: 4px;">
        ${
          mapLink
            ? `<a href="${mapLink}" style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.10); color: #E6CE93; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 13px;">View location</a>`
            : `<span style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.05); color: rgba(251, 247, 233, 0.3); text-align: center; border-radius: 10px; font-weight: 600; font-size: 13px;">View location</span>`
        }
      </td>
      <td width="50%" style="padding: 4px;">
        <a href="${shareLink}" style="display: block; padding: 14px 8px; background: rgba(230, 206, 147, 0.10); color: #E6CE93; text-align: center; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 13px;">Forward alert</a>
      </td>
    </tr>
  </table>

  <div style="padding: 0 0 20px;">
    <p style="margin: 16px 0 6px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: rgba(251, 247, 233, 0.55);">Fired at</p>
    <p style="margin: 0 0 16px; font-family: 'SFMono-Regular', Menlo, monospace; font-size: 15px; color: #E6CE93;">
      ${tsHuman}
    </p>
    <p style="margin: 0 0 16px; line-height: 1.55; color: rgba(251, 247, 233, 0.75);">
      Triggered from <strong>${source === 'watch' ? 'their Wear OS watch' : source === 'mobile' ? 'their phone' : 'the web'}</strong>. The watch button has to be PRESSED AND HELD for four full seconds to fire, this isn't an accidental tap.
    </p>
    ${
      note
        ? `<p style="margin: 16px 0 6px; font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: rgba(251, 247, 233, 0.55);">Additional note</p>
           <p style="margin: 0 0 16px; line-height: 1.55;">${escapeHtml(note)}</p>`
        : ''
    }
  </div>

  <div style="padding-top: 16px; border-top: 1px solid rgba(230, 206, 147, 0.25); font-size: 12px; color: rgba(251, 247, 233, 0.6); line-height: 1.55;">
    <p style="margin: 0 0 8px;">
      <strong style="color: #FBF7E9;">What to do next:</strong> ${
        callUserLink
          ? `tap <strong>Call ${escapeHtml(watcherFirst)}</strong> above and reach them directly. If they don't pick up,`
          : `call ${escapeHtml(watcherFirst)} right now. If they don't pick up,`
      } the next step depends on what you know about their situation: their last known location, who they were with, or whether you need to escalate to local emergency services (in the US: 911).
    </p>
    <p style="margin: 0;">
      Safe Witness is a feature in <img src="https://advottic.com/advottic-mark.png" alt="Advottic" width="16" height="16" style="display: inline-block; width: 16px; height: 16px; vertical-align: -3px; margin: 0 1px;" /> that lets a user discreetly
      notify someone they trust when they feel unsafe. You were chosen as that contact.
    </p>
  </div>
</div>`;
  // Fan out: every contact gets the alert via every channel they
  // listed. Email AND SMS go out concurrently per contact via
  // Promise.allSettled so a single failure (Twilio rate limit, a
  // typo'd phone) never blocks the rest of the deliveries. The HTML
  // is built PER contact so each one sees their own name.
  //
  // The SMS body is a single 1-2 sentence version of the alert so
  // it fits in one or two segments. Email carries the full HTML.
  const watcherFirstName = watcherFirst;
  // SMS body: every link a contact needs in one tap. Newlines
  // separate sections so each link is recognizable on iOS/Android.
  // Twilio segments at 153 chars (GSM-7), this typically spans
  // 2-4 segments which is acceptable for an emergency alert.
  // Per-contact greeting is added inside the loop below so the same
  // base body can be reused.
  // Transmission-security hardening (HIPAA 164.312(e)): the SMS no longer
  // embeds exact GPS coordinates or the plaintext verification PIN. It links
  // to the secure live-tracker page instead (an unguessable per-alert UUID),
  // which shows the live map, the PIN, directions, and call buttons - the
  // same primary CTA the email already uses, and a richer emergency view
  // than a static pin. Offline-capable tel: links (call the user, call 911)
  // stay in the body so a contact with no data connection can still act.
  // Falls back to the raw maps link only if the tracker URL couldn't be
  // built (e.g. the audit row insert returned no id).
  const smsLocationLink = trackerLink ?? mapLink;
  const smsBodyBase = [
    `ADVOTTIC SAFE WITNESS - ${watcherFirstName}`,
    userMessage,
    smsLocationLink ? `Live location + details: ${smsLocationLink}` : null,
    callUserLink ? `Call ${watcherFirstName}: ${callUserLink}` : null,
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
    // Per-contact personalization. HTML gets a "Hi <name>,"
    // greeting; SMS gets a leading "Hi <name>" when we have one.
    const perContactHtml = buildEmailHtml(c.display_name);
    const smsBody = c.display_name
      ? `Hi ${c.display_name} - ${smsBodyBase}`
      : smsBodyBase;
    if (c.email) {
      tasks.push(
        sendEmail({
          to: c.email,
          subject: `Safe Witness alert from ${watcherFirstName}`,
          html: perContactHtml,
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
            // delivery failure, surface it distinctly so the
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
