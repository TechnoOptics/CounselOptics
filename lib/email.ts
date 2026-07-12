/**
 * Tiny Resend wrapper for transactional email. We hit the REST API
 * directly with fetch instead of pulling in the resend SDK, since
 * the surface we need is small and we want to avoid a 200KB dependency.
 *
 * Required env: RESEND_API_KEY. Optional: RESEND_FROM (defaults to
 * "Advottic <invites@advottic.com>"). Returns false on any send failure
 * so callers can fall back to Supabase's built-in email path or simply
 * surface "we'll resend manually" copy to the user.
 */

const DEFAULT_FROM = 'Advottic <invites@advottic.com>';

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  /**
   * Override the sender display name (the address stays the verified
   * invites@advottic.com so DKIM/DMARC still align). Lets transactional
   * mail read as the firm, e.g. "Zinpro Legal <invites@advottic.com>".
   */
  fromName?: string;
}): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not configured.' };

  const baseFrom = process.env.RESEND_FROM?.trim() || DEFAULT_FROM;
  let from = baseFrom;
  if (input.fromName && input.fromName.trim()) {
    const addr = (baseFrom.match(/<([^>]+)>/)?.[1] || baseFrom).trim();
    // Strip characters that would break the RFC 5322 display-name.
    const safeName = input.fromName.replace(/["\r\n<>]/g, '').trim();
    from = `${safeName} <${addr}>`;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo,
      }),
      // Bounded so a provider that accepts the TCP connection but never
      // responds can't hang a Safe Witness alert (a safety-of-life path)
      // for the whole function timeout. An abort surfaces as a failed
      // send below, not an indefinite spinner.
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!res.ok || !body.id) {
      return { ok: false, error: body.message || `HTTP ${res.status}` };
    }
    return { ok: true, id: body.id };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'unknown email error',
    };
  }
}

/** Brand-styled invite email with a single CTA link. */
export function buildInviteEmailHtml(input: {
  inviterName: string;
  caseTitle: string;
  link: string;
  isNewUser: boolean;
}): string {
  const cta = input.isNewUser ? 'Accept invite & sign up' : 'Open the case';
  const intro = input.isNewUser
    ? `${escapeHtml(input.inviterName)} invited you to collaborate on a case file in Advottic. Click below to create your account and view it.`
    : `${escapeHtml(input.inviterName)} added you as a collaborator on a case file in Advottic. Click below to sign in and open it.`;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5edd6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#0f2d24;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5edd6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -4px rgba(15,45,36,0.10);">
        <tr><td style="background:linear-gradient(135deg,#0f2d24 0%,#173b30 60%,#23362f 100%);padding:24px 32px;">
          <p style="margin:0;color:#d5bb7e;font-size:11px;letter-spacing:0.28em;text-transform:uppercase;font-weight:600;">Advottic</p>
          <p style="margin:6px 0 0;color:#fbf7e9;font-size:18px;font-weight:600;">You've been invited to a case</p>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <h1 style="margin:0 0 12px;color:#0f2d24;font-size:22px;line-height:1.2;font-weight:600;letter-spacing:-0.01em;">${escapeHtml(input.caseTitle)}</h1>
          <p style="margin:0 0 20px;color:#3f3f46;font-size:14.5px;line-height:1.55;">${intro}</p>
          <p style="margin:0 0 24px;">
            <a href="${escapeAttribute(input.link)}" style="display:inline-block;background:#0f2d24;color:#fbf7e9;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;font-size:14px;letter-spacing:-0.005em;">${cta}</a>
          </p>
          <p style="margin:0 0 8px;color:#71717a;font-size:12px;line-height:1.55;">Or paste this link into your browser:</p>
          <p style="margin:0 0 24px;word-break:break-all;color:#52525b;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">${escapeHtml(input.link)}</p>
          <p style="margin:0;color:#a1a1aa;font-size:11.5px;line-height:1.55;">Advottic provides legal information and case organization, not legal advice. If you weren't expecting this invite, you can ignore the email.</p>
        </td></tr>
        <tr><td style="padding:0 32px 28px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 12px;" />
          <p style="margin:0;color:#a1a1aa;font-size:11px;letter-spacing:0.04em;">© ${new Date().getFullYear()} Advottic LLC. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Brand-styled meeting invite. Sent to every attendee when a meeting
 * is scheduled from the shared calendar, so Zoom invitees + any
 * non-Outlook recipient still get a proper invite (Microsoft Graph
 * already emails Outlook attendees for Teams events; this guarantees
 * universal delivery and a one-tap "add to calendar").
 */
export function buildMeetingInviteEmailHtml(input: {
  organizerName: string;
  topic: string;
  whenText: string;
  durationMin: number;
  providerLabel: string;
  joinUrl: string;
  addToCalendarUrl: string;
  /** The firm's brand name, e.g. "Zinpro Legal". Falls back to Advottic. */
  firmName?: string;
  /** The firm's uploaded logo (public URL). Rendered in the header if set. */
  logoUrl?: string | null;
}): string {
  const brand = (input.firmName || 'Advottic').trim() || 'Advottic';
  const year = new Date().getFullYear();
  // Black + gold enterprise theme. The header shows the firm's logo
  // when one is set, otherwise the firm name as a gold wordmark.
  const header = input.logoUrl
    ? `<img src="${escapeAttribute(input.logoUrl)}" alt="${escapeAttribute(
        brand,
      )}" height="40" style="display:block;max-height:40px;width:auto;border:0;outline:none;text-decoration:none;" />`
    : `<p style="margin:0;color:#e8c878;font-size:18px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;">${escapeHtml(
        brand,
      )}</p>`;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px -4px rgba(0,0,0,0.45);border:1px solid #1c1c1e;">
        <tr><td style="background:#0b0b0c;padding:26px 32px;border-bottom:2px solid #e8c878;">
          ${header}
          <p style="margin:10px 0 0;color:#f4f0e6;font-size:18px;font-weight:600;">You&rsquo;re invited to a meeting</p>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <h1 style="margin:0 0 14px;color:#0b0b0c;font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;">${escapeHtml(
            input.topic,
          )}</h1>
          <p style="margin:0 0 6px;color:#3f3f46;font-size:14.5px;line-height:1.55;"><strong>When:</strong> ${escapeHtml(
            input.whenText,
          )} (${input.durationMin} min)</p>
          <p style="margin:0 0 22px;color:#3f3f46;font-size:14.5px;line-height:1.55;"><strong>Where:</strong> ${escapeHtml(
            input.providerLabel,
          )} &middot; organized by ${escapeHtml(input.organizerName)}</p>
          <p style="margin:0 0 14px;">
            <a href="${escapeAttribute(
              input.joinUrl,
            )}" style="display:inline-block;background:#0b0b0c;color:#e8c878;text-decoration:none;padding:13px 24px;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:-0.005em;">Join the meeting</a>
          </p>
          <p style="margin:0 0 24px;">
            <a href="${escapeAttribute(
              input.addToCalendarUrl,
            )}" style="display:inline-block;color:#0b0b0c;text-decoration:none;padding:11px 20px;border:1px solid #c9a24a;border-radius:10px;font-weight:600;font-size:13px;">Add to calendar</a>
          </p>
          <p style="margin:0 0 8px;color:#71717a;font-size:12px;line-height:1.55;">Or paste this link into your browser:</p>
          <p style="margin:0 0 24px;word-break:break-all;color:#52525b;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">${escapeHtml(
            input.joinUrl,
          )}</p>
          <p style="margin:0;color:#a1a1aa;font-size:11.5px;line-height:1.55;">If you weren&rsquo;t expecting this invite, you can ignore the email.</p>
        </td></tr>
        <tr><td style="padding:0 32px 28px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 12px;" />
          <p style="margin:0;color:#a1a1aa;font-size:11px;letter-spacing:0.04em;">© ${year} ${escapeHtml(
            brand,
          )} &middot; Powered by Advottic</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Branded "please sign this document" email. Enterprise black + gold
 * theme, led by the firm's logo (or gold wordmark), so mail sent on a
 * firm's behalf reads as the firm - not a generic Advottic notice.
 * Pairs with buildSigningCodeEmailHtml: for external signers we send
 * this (the link) plus a separate code email, and the signer needs
 * both to open the document.
 */
export function buildSigningRequestEmailHtml(input: {
  firmName: string;
  logoUrl?: string | null;
  senderName: string;
  documentName: string;
  message?: string | null;
  link: string;
  /** True when a separate code email is also being sent. */
  codeSeparately?: boolean;
}): string {
  const brand = (input.firmName || 'Advottic').trim() || 'Advottic';
  const year = new Date().getFullYear();
  const header = input.logoUrl
    ? `<img src="${escapeAttribute(input.logoUrl)}" alt="${escapeAttribute(
        brand,
      )}" height="40" style="display:block;max-height:40px;width:auto;border:0;outline:none;text-decoration:none;" />`
    : `<p style="margin:0;color:#e8c878;font-size:18px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;">${escapeHtml(
        brand,
      )}</p>`;
  const messageBlock = input.message
    ? `<div style="margin:0 0 20px;padding:14px 16px;background:#faf7ef;border-left:3px solid #c9a24a;border-radius:4px;">
         <p style="margin:0;color:#3f3f46;font-size:13.5px;line-height:1.55;font-style:italic;">&ldquo;${escapeHtml(
           input.message,
         )}&rdquo;</p>
       </div>`
    : '';
  const codeNote = input.codeSeparately
    ? `<p style="margin:0 0 8px;color:#71717a;font-size:12.5px;line-height:1.55;">For your security, we&rsquo;ve sent a one-time access code to this same address in a separate email. You&rsquo;ll enter it to open the document.</p>`
    : `<p style="margin:0 0 8px;color:#71717a;font-size:12.5px;line-height:1.55;">This link is single-use and opens the document inside Advottic - it never leaves the app.</p>`;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px -4px rgba(0,0,0,0.45);border:1px solid #1c1c1e;">
        <tr><td style="background:#0b0b0c;padding:26px 32px;border-bottom:2px solid #e8c878;">
          ${header}
          <p style="margin:10px 0 0;color:#f4f0e6;font-size:18px;font-weight:600;">A document needs your signature</p>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <h1 style="margin:0 0 12px;color:#0b0b0c;font-size:22px;line-height:1.2;font-weight:700;letter-spacing:-0.01em;">${escapeHtml(
            input.documentName,
          )}</h1>
          <p style="margin:0 0 18px;color:#3f3f46;font-size:14.5px;line-height:1.55;">${escapeHtml(
            input.senderName,
          )} at ${escapeHtml(
    brand,
  )} has asked you to review and sign a document.</p>
          ${messageBlock}
          <p style="margin:0 0 22px;">
            <a href="${escapeAttribute(
              input.link,
            )}" style="display:inline-block;background:#0b0b0c;color:#e8c878;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:700;font-size:14px;letter-spacing:-0.005em;">Review &amp; sign</a>
          </p>
          ${codeNote}
          <p style="margin:0 0 22px;word-break:break-all;color:#52525b;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">${escapeHtml(
            input.link,
          )}</p>
          <p style="margin:0;color:#a1a1aa;font-size:11.5px;line-height:1.55;">If you weren&rsquo;t expecting this, you can ignore this email and nothing will be signed.</p>
        </td></tr>
        <tr><td style="padding:0 32px 28px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 12px;" />
          <p style="margin:0;color:#a1a1aa;font-size:11px;letter-spacing:0.04em;">© ${year} ${escapeHtml(
    brand,
  )} &middot; Powered by Advottic</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Branded one-time access-code email. Sent alongside (but separately
 * from) the sign-link email to external signers, so opening the
 * document requires control of the mailbox - a forwarded link alone
 * won't do. The code is large and centered for easy transcription.
 */
export function buildSigningCodeEmailHtml(input: {
  firmName: string;
  logoUrl?: string | null;
  documentName: string;
  code: string;
}): string {
  const brand = (input.firmName || 'Advottic').trim() || 'Advottic';
  const year = new Date().getFullYear();
  const header = input.logoUrl
    ? `<img src="${escapeAttribute(input.logoUrl)}" alt="${escapeAttribute(
        brand,
      )}" height="36" style="display:block;max-height:36px;width:auto;border:0;outline:none;text-decoration:none;" />`
    : `<p style="margin:0;color:#e8c878;font-size:16px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;">${escapeHtml(
        brand,
      )}</p>`;
  // Space the code so it's readable at a glance: "ABC 123".
  const spaced =
    input.code.length === 6
      ? `${input.code.slice(0, 3)} ${input.code.slice(3)}`
      : input.code;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 28px -4px rgba(0,0,0,0.45);border:1px solid #1c1c1e;">
        <tr><td style="background:#0b0b0c;padding:24px 32px;border-bottom:2px solid #e8c878;">
          ${header}
          <p style="margin:10px 0 0;color:#f4f0e6;font-size:17px;font-weight:600;">Your access code</p>
        </td></tr>
        <tr><td style="padding:28px 32px 8px;">
          <p style="margin:0 0 18px;color:#3f3f46;font-size:14.5px;line-height:1.55;">Enter this code to open &ldquo;<strong>${escapeHtml(
            input.documentName,
          )}</strong>&rdquo; for signature. It works once, on the sign page from your other email.</p>
          <div style="margin:0 0 20px;text-align:center;">
            <span style="display:inline-block;padding:14px 28px;background:#faf7ef;border:1px solid #e6d9b6;border-radius:12px;color:#0b0b0c;font-size:30px;font-weight:700;letter-spacing:0.28em;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">${escapeHtml(
              spaced,
            )}</span>
          </div>
          <p style="margin:0;color:#a1a1aa;font-size:11.5px;line-height:1.55;">Never share this code. ${escapeHtml(
            brand,
          )} will never ask for it by phone. If you weren&rsquo;t expecting it, you can ignore this email.</p>
        </td></tr>
        <tr><td style="padding:16px 32px 28px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 12px;" />
          <p style="margin:0;color:#a1a1aa;font-size:11px;letter-spacing:0.04em;">© ${year} ${escapeHtml(
    brand,
  )} &middot; Powered by Advottic</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Branded SIGN-IN code email. This is the email a user receives when they choose
 * "Email me a sign-in code" on /sign-in. Premium black + gold Advottic identity,
 * gold ADVOTTIC wordmark at the top, and a single large, spaced one-time code -
 * no magic link, so there is no "opened in a different browser" failure mode:
 * the code works in whichever browser the person started in.
 *
 * The code length is whatever Supabase mints (this project uses 8 digits); we
 * space it in the middle for legibility ("1234 5678" / "123 456").
 */
export function buildSignInCodeEmailHtml(input: {
  code: string;
  /** Minutes until the code expires (Supabase default is 60). */
  expiresMinutes?: number;
}): string {
  const year = new Date().getFullYear();
  const c = input.code.trim();
  const mid = Math.ceil(c.length / 2);
  const spaced = c.length >= 6 ? `${c.slice(0, mid)} ${c.slice(mid)}` : c;
  const mins = input.expiresMinutes ?? 60;
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:36px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 34px -6px rgba(0,0,0,0.55);border:1px solid #1c1c1e;">
        <tr><td align="center" style="background:linear-gradient(135deg,#0b0b0c 0%,#14140f 55%,#1b1710 100%);padding:30px 34px 26px;border-bottom:2px solid #e8c878;">
          <img src="https://advottic.com/advottic-mark.png" alt="Advottic" width="46" height="50" style="display:block;margin:0 auto;width:46px;height:auto;border:0;outline:none;text-decoration:none;" />
          <p style="margin:14px 0 0;color:#f4f0e6;font-size:16px;font-weight:600;letter-spacing:-0.005em;">Your sign-in code</p>
        </td></tr>
        <tr><td style="padding:30px 34px 6px;">
          <p style="margin:0 0 22px;color:#3f3f46;font-size:14.5px;line-height:1.6;">Enter this code on the sign-in screen to continue. For your security it expires in ${mins} minutes and can be used once.</p>
          <div style="margin:0 0 22px;text-align:center;">
            <span style="display:inline-block;padding:18px 30px;background:#faf7ef;border:1px solid #e6d9b6;border-radius:14px;color:#0b0b0c;font-size:34px;font-weight:700;letter-spacing:0.22em;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">${escapeHtml(
              spaced,
            )}</span>
          </div>
          <p style="margin:0 0 6px;color:#71717a;font-size:12.5px;line-height:1.6;">Type it into the field on the page you started from - you do not need to leave this email or click any link.</p>
          <p style="margin:0;color:#a1a1aa;font-size:11.5px;line-height:1.6;">Never share this code. Advottic will never ask for it by phone or email reply. If you did not request it, you can safely ignore this message and nothing will change.</p>
        </td></tr>
        <tr><td style="padding:18px 34px 30px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 12px;" />
          <p style="margin:0;color:#a1a1aa;font-size:11px;letter-spacing:0.04em;">© ${year} Advottic LLC &middot; Legal case organization, not legal advice.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escapeAttribute(s: string): string {
  return escapeHtml(s);
}
