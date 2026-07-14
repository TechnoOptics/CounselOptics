import { NextResponse } from 'next/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email';
import { logCaseActivity } from '@/lib/case-activity-log';
import {
  encryptDocument,
  storeShare,
  newShareToken,
  formatKey,
  type ShareMeta,
} from '@/lib/secure-share';
import { GET as matterExportGET } from '../export/route';
import { GET as approachExportGET } from '../approach/[approachId]/export/route';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SHARE_TTL_DAYS = 14;
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/**
 * Securely share an exported court packet. Authorizes the caller as a firm
 * member of the matter, rebuilds the requested export by invoking the existing
 * export route handler (so scope/section logic and access checks are reused
 * verbatim), encrypts the PDF with a one-time key, stores the ciphertext, and
 * emails the recipient a key-gated link. The plaintext key is returned to the
 * SENDER too, so they can relay it out-of-band if they prefer not to trust it
 * to the same channel.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });

  // Sharing is a firm-member action (it sends work product outside the firm);
  // co-counsel guests may export for themselves but not re-share.
  const ctx = await getActiveFirmContext();
  if (!ctx) return NextResponse.json({ error: 'Only firm members can share.' }, { status: 403 });
  const firmId = ctx.firm.id;
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('id')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return NextResponse.json({ error: 'No access to this firm.' }, { status: 403 });

  const { data: caseRow } = await admin
    .from('cases')
    .select('id, title, firm_id')
    .eq('id', params.id)
    .maybeSingle();
  const c = caseRow as { id: string; title: string; firm_id: string | null } | null;
  if (!c || c.firm_id !== firmId) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    recipientEmail?: string;
    path?: string;
    scopeLabel?: string;
    note?: string;
  };
  const recipientEmail = (body.recipientEmail || '').trim().toLowerCase();
  if (!emailOk(recipientEmail)) return NextResponse.json({ error: 'Enter a valid recipient email.' }, { status: 400 });

  // Validate the requested export path is one of THIS matter's export routes.
  const origin = new URL(req.url).origin;
  const rawPath = (body.path || `/counsel/cases/${params.id}/export`).trim();
  let target: URL;
  try {
    target = new URL(rawPath, origin);
  } catch {
    return NextResponse.json({ error: 'Invalid export target.' }, { status: 400 });
  }
  const matterBase = `/counsel/cases/${params.id}/export`;
  const approachRe = new RegExp(`^/counsel/cases/${params.id}/approach/([0-9a-f-]{36})/export$`, 'i');
  const approachMatch = target.pathname.match(approachRe);

  // Rebuild the export bytes via the real handler (auth + scope reused).
  const synthetic = new Request(target.toString(), { headers: req.headers });
  let exportRes: Response;
  if (target.pathname === matterBase) {
    exportRes = await matterExportGET(synthetic, { params: { id: params.id } });
  } else if (approachMatch) {
    exportRes = await approachExportGET(synthetic, { params: { id: params.id, approachId: approachMatch[1] } });
  } else {
    return NextResponse.json({ error: 'Invalid export target.' }, { status: 400 });
  }
  if (!exportRes.ok) {
    const msg = await exportRes.json().catch(() => ({ error: 'Could not build the export.' }));
    return NextResponse.json({ error: (msg as { error?: string }).error || 'Could not build the export.' }, { status: 400 });
  }
  const pdf = Buffer.from(await exportRes.arrayBuffer());
  if (!pdf.length) return NextResponse.json({ error: 'The export was empty.' }, { status: 400 });

  const { data: profile } = await admin.from('profiles').select('display_name').eq('id', user.id).maybeSingle();
  const senderName = (profile as { display_name?: string | null } | null)?.display_name || user.email || null;

  // Encrypt + store.
  const { blob, key } = encryptDocument(pdf);
  const token = newShareToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_DAYS * 24 * 3600 * 1000);
  const cd = exportRes.headers.get('content-disposition') || '';
  const filename = /filename="([^"]+)"/.exec(cd)?.[1] || 'court-packet.pdf';
  const meta: ShareMeta = {
    caseId: params.id,
    firmId,
    createdBy: user.id,
    createdByName: senderName,
    recipientEmail,
    filename,
    caseTitle: c.title,
    scopeLabel: (body.scopeLabel || 'Court packet').slice(0, 80),
    sizeBytes: pdf.length,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  const stored = await storeShare(admin, token, blob, meta);
  if (!stored) return NextResponse.json({ error: 'Could not store the encrypted document.' }, { status: 500 });

  const link = `${origin}/share/${token}`;
  const shownKey = formatKey(key);

  // Email the recipient the link + key. Firm-branded sender name.
  const email = await sendEmail({
    to: recipientEmail,
    fromName: ctx.firm.name || undefined,
    subject: `${c.title} — secure document`,
    replyTo: user.email || undefined,
    text: shareEmailText({ caseTitle: c.title, senderName, link, key: shownKey, expiresAt, note: body.note }),
    html: shareEmailHtml({ caseTitle: c.title, senderName, firmName: ctx.firm.name || null, link, key: shownKey, expiresAt, note: body.note }),
  });

  void logCaseActivity({ caseId: params.id, action: 'export', skipFirm: true });

  return NextResponse.json({
    ok: true,
    link,
    key: shownKey,
    recipientEmail,
    emailSent: email.ok,
    emailError: email.ok ? null : email.error,
    expiresAt: expiresAt.toISOString(),
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function shareEmailText(o: { caseTitle: string; senderName: string | null; link: string; key: string; expiresAt: Date; note?: string }): string {
  return [
    `${o.senderName || 'A colleague'} has securely shared a document with you: ${o.caseTitle}.`,
    o.note ? `\nNote: ${o.note}` : '',
    `\nOpen it here:\n${o.link}`,
    `\nYou will be asked for this key to unlock it:\n${o.key}`,
    `\nThe document is encrypted; the key is required to open it. This link expires ${fmtDate(o.expiresAt)}.`,
    `\nConfidential — please do not forward.`,
  ].filter(Boolean).join('\n');
}

function shareEmailHtml(o: { caseTitle: string; senderName: string | null; firmName: string | null; link: string; key: string; expiresAt: Date; note?: string }): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] as string));
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b">
  <p style="font-size:15px;line-height:1.5">${esc(o.senderName || 'A colleague')} has securely shared a document with you.</p>
  <p style="font-size:15px;font-weight:600;margin:0 0 4px">${esc(o.caseTitle)}</p>
  ${o.note ? `<p style="font-size:13px;color:#52525b;background:#faf8f2;border-radius:8px;padding:10px 12px">${esc(o.note)}</p>` : ''}
  <p style="margin:22px 0">
    <a href="${esc(o.link)}" style="background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;display:inline-block">Open the secure document</a>
  </p>
  <p style="font-size:13px;color:#52525b;margin:0 0 6px">You will be asked for this key to unlock it:</p>
  <p style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;font-weight:700;letter-spacing:1px;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:8px;padding:12px 14px;text-align:center">${esc(o.key)}</p>
  <p style="font-size:12px;color:#71717a;line-height:1.5;margin-top:18px">The document is encrypted and cannot be opened without this key. This secure link expires ${fmtDate(o.expiresAt)}. Confidential — please do not forward.</p>
  ${o.firmName ? `<p style="font-size:12px;color:#a1a1aa;margin-top:16px">Sent via ${esc(o.firmName)} on Advottic.</p>` : ''}
</div>`;
}
