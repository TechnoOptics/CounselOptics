import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { authorizeFirmActor } from '@/lib/portal-entitlements';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail, buildShareLinkEmailHtml, buildShareKeyEmailHtml } from '@/lib/email';
import {
  encryptDocument,
  storeShare,
  newShareToken,
  formatKey,
  type ShareMeta,
} from '@/lib/secure-share';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SHARE_TTL_DAYS = 14;
const MAX_BYTES = 15 * 1024 * 1024;
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Magic-byte allowlist: an employee can securely share the documents the
 *  portal itself produces or common evidence types, never executables. */
function sniffMime(buf: Buffer, declared: string): string | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (declared === 'text/plain') return 'text/plain';
  return null;
}

/**
 * Employee secure share (Hub): encrypt a document with a one-time AES-256-GCM
 * key and email the recipient a key-gated link: the LINK in one email, the
 * KEY in a second, so no single message ever contains both. Same machinery as
 * the counsel-side secure share, opened to the firm's employees for their own
 * documents (a filled form, a photo, a draft).
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') {
    return NextResponse.json({ error: 'Only Hub employees can use this share.' }, { status: 403 });
  }
  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });
  const firmId = persona.firm.id;
  const actor = await authorizeFirmActor(admin, firmId, user.id, 'requests.view');
  if (!actor.ok) return NextResponse.json({ error: 'No access.' }, { status: 403 });

  const allowed = await checkRateLimit(`portal-share:${user.id}`, { limit: 10, windowSeconds: 3600 });
  if (!allowed) {
    return NextResponse.json({ error: 'You have reached the hourly share limit. Try again later.' }, { status: 429 });
  }

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Send multipart form data.' }, { status: 400 });
  const file = form.get('file');
  const recipientEmail = String(form.get('recipientEmail') ?? '').trim().toLowerCase();
  const label = String(form.get('label') ?? '').trim().slice(0, 120) || 'Shared document';
  const note = String(form.get('note') ?? '').trim().slice(0, 500) || undefined;
  if (!(file instanceof File)) return NextResponse.json({ error: 'Attach a file.' }, { status: 400 });
  if (!emailOk(recipientEmail)) {
    return NextResponse.json({ error: 'Enter a valid recipient email.' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'The file must be between 1 byte and 15 MB.' }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffMime(bytes, file.type);
  if (!mime) {
    return NextResponse.json({ error: 'Only PDF, PNG, JPEG, or plain-text files can be shared.' }, { status: 400 });
  }

  const { blob, key } = await encryptDocument(bytes);
  const token = newShareToken();
  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 3600 * 1000);
  const senderName = persona.employee.displayName || user.email || null;
  const meta: ShareMeta = {
    caseId: 'portal',
    firmId,
    createdBy: user.id,
    createdByName: senderName,
    recipientEmail,
    filename: (file.name || 'document.pdf').replace(/[^\w .()-]+/g, '_').slice(0, 140),
    mime,
    caseTitle: label,
    scopeLabel: 'Employee secure share',
    sizeBytes: bytes.length,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const stored = await storeShare(admin, token, blob, meta);
  if (!stored) {
    return NextResponse.json({ error: 'Could not store the encrypted document.' }, { status: 500 });
  }

  const origin = new URL(req.url).origin;
  const link = `${origin}/share/${token}`;
  const shownKey = formatKey(key);
  const firmName = persona.firm.name || null;

  const linkEmail = await sendEmail({
    to: recipientEmail,
    fromName: firmName ?? undefined,
    subject: `${label}: secure document`,
    replyTo: user.email || undefined,
    text: [
      `${senderName || 'A colleague'} has securely shared a document with you: ${label}.`,
      note ? `\nNote: ${note}` : '',
      `\nOpen it here:\n${link}`,
      `\nThe document is encrypted. Your decryption key arrives in a separate email. You will need it to open the document.`,
      `\nThis link expires in ${SHARE_TTL_DAYS} days. Confidential: please do not forward.`,
    ]
      .filter(Boolean)
      .join('\n'),
    html: buildShareLinkEmailHtml({ caseTitle: label, senderName, firmName, link, expiresAt, note }),
  });
  const keyEmail = await sendEmail({
    to: recipientEmail,
    fromName: firmName ?? undefined,
    subject: 'Your decryption key',
    replyTo: user.email || undefined,
    text: `Here is your decryption key for the secure document "${label}":\n\n${shownKey}\n\nEnter it on the secure page you received in the separate email.`,
    html: buildShareKeyEmailHtml({ caseTitle: label, firmName, key: shownKey }),
  });
  const emailSent = linkEmail.ok && keyEmail.ok;

  return NextResponse.json({
    ok: true,
    link,
    key: shownKey,
    recipientEmail,
    emailSent,
    emailError: emailSent
      ? null
      : [!linkEmail.ok ? `link email: ${linkEmail.error}` : null, !keyEmail.ok ? `key email: ${keyEmail.error}` : null]
          .filter(Boolean)
          .join('; '),
    expiresAt: expiresAt.toISOString(),
  });
}
