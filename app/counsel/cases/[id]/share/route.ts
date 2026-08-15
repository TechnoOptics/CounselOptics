import { NextResponse } from 'next/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { getCurrentUser, createServerSupabase } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { sendEmail, buildShareLinkEmailHtml, buildShareKeyEmailHtml } from '@/lib/email';
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
import { GET as evidenceDownloadGET } from '../evidence/download/route';
import { caseFileRefusal } from '@/lib/case-file';

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

  // Sharing rebuilds the document through the export handlers below, which
  // refuse a closed case file themselves - and this is stated again here on
  // purpose. A share is the one control on this page that puts a matter's
  // contents into somebody else's inbox, and "it is safe because the thing it
  // calls is safe" is a claim that quietly stops being true the first time a
  // new branch is added to the dispatch.
  const caseFileClosed = await caseFileRefusal(params.id);
  if (caseFileClosed) {
    return NextResponse.json({ error: caseFileClosed.error }, { status: 403 });
  }

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
  // Sharing an exhibit's ORIGINAL file(s) reuses the evidence download route
  // (single file direct, several zipped, exhibit-numbered names).
  const evidenceBase = `/counsel/cases/${params.id}/evidence/download`;

  // Rebuild the document bytes via the real handler (auth + scope reused).
  const synthetic = new Request(target.toString(), { headers: req.headers });
  let exportRes: Response;
  if (target.pathname === matterBase) {
    exportRes = await matterExportGET(synthetic, { params: { id: params.id } });
  } else if (approachMatch) {
    exportRes = await approachExportGET(synthetic, { params: { id: params.id, approachId: approachMatch[1] } });
  } else if (target.pathname === evidenceBase) {
    exportRes = await evidenceDownloadGET(synthetic, { params: { id: params.id } });
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
    mime: exportRes.headers.get('content-type') || 'application/pdf',
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

  // TWO separate emails by default: the link in one, the key in another. A
  // single forwarded/leaked message then never contains both credentials.
  const linkEmail = await sendEmail({
    to: recipientEmail,
    fromName: ctx.firm.name || undefined,
    subject: `${c.title}: secure document`,
    replyTo: user.email || undefined,
    text: linkEmailText({ caseTitle: c.title, senderName, link, expiresAt, note: body.note }),
    html: buildShareLinkEmailHtml({ caseTitle: c.title, senderName, firmName: ctx.firm.name || null, link, expiresAt, note: body.note }),
  });
  const keyEmail = await sendEmail({
    to: recipientEmail,
    fromName: ctx.firm.name || undefined,
    subject: `Your decryption key`,
    replyTo: user.email || undefined,
    text: keyEmailText({ caseTitle: c.title, key: shownKey }),
    html: buildShareKeyEmailHtml({ caseTitle: c.title, firmName: ctx.firm.name || null, key: shownKey }),
  });
  const emailSent = linkEmail.ok && keyEmail.ok;
  const emailError = emailSent
    ? null
    : [!linkEmail.ok ? `link email: ${linkEmail.error}` : null, !keyEmail.ok ? `key email: ${keyEmail.error}` : null]
        .filter(Boolean)
        .join('; ');

  void logCaseActivity({ caseId: params.id, action: 'export', skipFirm: true });

  return NextResponse.json({
    ok: true,
    link,
    key: shownKey,
    recipientEmail,
    emailSent,
    emailError,
    expiresAt: expiresAt.toISOString(),
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function linkEmailText(o: { caseTitle: string; senderName: string | null; link: string; expiresAt: Date; note?: string }): string {
  return [
    `${o.senderName || 'A colleague'} has securely shared a document with you: ${o.caseTitle}.`,
    o.note ? `\nNote: ${o.note}` : '',
    `\nOpen it here:\n${o.link}`,
    `\nThe document is encrypted. Your decryption key arrives in a separate email. You will need it to open the document.`,
    `\nThis link expires ${fmtDate(o.expiresAt)}. Confidential: please do not forward.`,
  ].filter(Boolean).join('\n');
}

function keyEmailText(o: { caseTitle: string; key: string }): string {
  return [
    `Here is your decryption key for the secure document "${o.caseTitle}":`,
    `\n${o.key}`,
    `\nEnter it on the secure page from the previous email to unlock the document.`,
    `Keep this key confidential and do not forward it.`,
  ].join('\n');
}
