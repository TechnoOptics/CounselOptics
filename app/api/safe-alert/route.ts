import { NextResponse, type NextRequest } from 'next/server';
import { sendEmail } from '@/lib/email';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Cap the function so a stuck email/SMS provider (each bounded to 8s via
// AbortSignal in lib/email + lib/sms) can't pin this safety-of-life route.
export const maxDuration = 20;

// Safe Witness alert. Server-side so it fires reliably even if the
// phone is then taken or destroyed. Sends an urgent message with a
// live map link + tamper-evident integrity hash to the user's OWN
// pre-chosen emergency contact AND to the user's account email
// (off-device preservation). It deliberately does NOT contact law
// enforcement - that stays an explicit one-tap action by the user.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in to use Safe Witness.' }, { status: 401 });
  }
  // A few re-sends in an incident are fine. checkRateLimit fails OPEN
  // on a store error, same as everywhere else - never let a rate-limit
  // backend hiccup block an emergency alert.
  const allowed = await checkRateLimit(`safe-alert:${user.id}`, {
    limit: 6,
    windowSeconds: 5 * 60,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'Alert already sent moments ago.' },
      { status: 429 },
    );
  }

  let b: {
    contactName?: string;
    contactEmail?: string;
    lat?: number;
    lng?: number;
    accuracy?: number;
    startedAt?: string;
    sha256?: string;
    note?: string;
  };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  const contactEmail = (b.contactEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(contactEmail)) {
    return NextResponse.json(
      { error: 'A valid emergency-contact email is required.' },
      { status: 400 },
    );
  }
  const contactName = (b.contactName || 'there').toString().slice(0, 80);
  const who = user.email || 'An Advottic user';
  const when = b.startedAt ? new Date(b.startedAt) : new Date();
  const whenStr = when.toLocaleString('en-US', { timeZoneName: 'short' });
  const hasLoc =
    typeof b.lat === 'number' &&
    typeof b.lng === 'number' &&
    Number.isFinite(b.lat) &&
    Number.isFinite(b.lng);
  const mapUrl = hasLoc
    ? `https://www.google.com/maps?q=${b.lat},${b.lng}`
    : null;
  const acc =
    typeof b.accuracy === 'number' && Number.isFinite(b.accuracy)
      ? ` (±${Math.round(b.accuracy)} m)`
      : '';

  const sha = (b.sha256 || '').replace(/[^a-f0-9]/gi, '').slice(0, 64);

  const lines = [
    `${who} triggered Safe Witness and asked Advottic to reach you.`,
    '',
    `Time: ${whenStr}`,
    hasLoc
      ? `Live location: ${mapUrl}${acc}`
      : 'Location: not available (permission off or no signal).',
    b.note ? `Note: ${b.note.toString().slice(0, 300)}` : '',
    sha
      ? `Evidence integrity hash (SHA-256): ${sha}\nThis proves a recording exists and has not been altered.`
      : '',
    '',
    'What to do:',
    `1. Try to reach ${who} now.`,
    '2. If you cannot, and you believe they are in danger, contact your local emergency services.',
    '3. Keep this email - the time, location and hash are evidence.',
    '',
    'Sent automatically by Advottic Safe Witness. Advottic does not contact law enforcement on anyone’s behalf.',
  ].filter((l) => l !== '');

  const text = lines.join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6;color:#0f2d24">
<p style="font-size:18px;font-weight:700;color:#b91c1c">Safe Witness alert</p>
<p>Hi ${escapeHtml(contactName)},</p>
<p><strong>${escapeHtml(who)}</strong> triggered Safe Witness and asked Advottic to reach you immediately.</p>
<p><strong>Time:</strong> ${escapeHtml(whenStr)}<br/>
${
    hasLoc
      ? `<strong>Live location:</strong> <a href="${mapUrl}">${mapUrl}</a>${escapeHtml(acc)}`
      : '<strong>Location:</strong> not available'
  }</p>
${b.note ? `<p><strong>Note:</strong> ${escapeHtml(b.note.toString().slice(0, 300))}</p>` : ''}
${
    sha
      ? `<p style="font-size:12px;color:#52525b"><strong>Evidence integrity (SHA-256):</strong><br/><code>${sha}</code><br/>Proof a recording exists and is unaltered.</p>`
      : ''
  }
<ol><li>Try to reach them now.</li><li>If you can’t and you believe they’re in danger, contact your local emergency services.</li><li>Keep this email - the time, location and hash are evidence.</li></ol>
<p style="font-size:12px;color:#71717a">Sent automatically by Advottic Safe Witness. Advottic does not contact law enforcement on anyone’s behalf.</p>
</div>`;

  const subject = `🛡 Safe Witness alert from ${who}`;

  // Fire to the contact and to the user themselves (off-device copy).
  const targets = [contactEmail];
  if (user.email && user.email.toLowerCase() !== contactEmail) {
    targets.push(user.email.toLowerCase());
  }
  const results = await Promise.allSettled(
    targets.map((to) => sendEmail({ to, subject, html, text })),
  );
  const anyOk = results.some(
    (r) => r.status === 'fulfilled' && r.value && (r.value as { ok?: boolean }).ok,
  );

  return NextResponse.json(
    { ok: anyOk, delivered: anyOk, targets: targets.length },
    { status: anyOk ? 200 : 502 },
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
