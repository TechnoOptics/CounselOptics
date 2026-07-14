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
 * Premium branded WELCOME email for a firm inviting counsel (or a client /
 * contributor) onto a matter. Unlike the terse buildInviteEmailHtml, this is a
 * full onboarding email: it personalizes to the invitee (name + organization),
 * names the inviter + firm + matter + their access level, gives the primary
 * "open the matter" link, and then walks them through BOTH ways to sign in with
 * real screenshots of the live sign-in screen and the branded code email, so a
 * first-time invitee is never lost. Images are hosted under /email on the site
 * (public/email/*.png); email clients that block remote images still get full,
 * self-explanatory alt text + numbered steps.
 */
export function buildCounselWelcomeEmailHtml(input: {
  inviteeName?: string | null;
  organization?: string | null;
  inviterName: string;
  firmName?: string | null;
  caseTitle: string;
  roleLabel: string;
  link: string;
}): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';
  const optionsImg = `${site}/email/login-options.png`;
  const codeImg = `${site}/email/login-code.png`;
  const greetingName = (input.inviteeName ?? '').trim();
  const greeting = greetingName ? `Hi ${escapeHtml(greetingName)},` : 'Hello,';
  const firmTrimmed = (input.firmName ?? '').trim();
  const fromWho =
    firmTrimmed && firmTrimmed.toLowerCase() !== input.inviterName.trim().toLowerCase()
      ? `${escapeHtml(input.inviterName)} at ${escapeHtml(firmTrimmed)}`
      : escapeHtml(input.inviterName);
  const orgTrimmed = (input.organization ?? '').trim();
  const orgLine = orgTrimmed ? ` on behalf of ${escapeHtml(orgTrimmed)}` : '';
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5edd6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#0f2d24;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5edd6;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px -4px rgba(15,45,36,0.10);">
        <tr><td style="background:linear-gradient(135deg,#0f2d24 0%,#173b30 60%,#23362f 100%);padding:28px 32px;text-align:center;">
          <p style="margin:0;color:#d5bb7e;font-size:22px;letter-spacing:0.30em;text-transform:uppercase;font-weight:700;">Advottic</p>
          <p style="margin:10px 0 0;color:#fbf7e9;font-size:15px;font-weight:500;letter-spacing:0.02em;">You've been invited to a matter</p>
        </td></tr>
        <tr><td style="padding:28px 32px 4px;">
          <p style="margin:0 0 14px;color:#0f2d24;font-size:15px;line-height:1.5;">${greeting}</p>
          <p style="margin:0 0 18px;color:#3f3f46;font-size:14.5px;line-height:1.6;">
            ${fromWho} invited you${orgLine} to collaborate on the matter below in Advottic as
            <strong style="color:#0f2d24;">${escapeHtml(input.roleLabel)}</strong>.
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;background:#f6f4ee;border:1px solid #e7e2d3;border-radius:12px;">
            <tr><td style="padding:16px 18px;">
              <p style="margin:0 0 3px;color:#8a7a52;font-size:10.5px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;">Matter</p>
              <p style="margin:0;color:#0f2d24;font-size:17px;font-weight:600;line-height:1.25;">${escapeHtml(input.caseTitle)}</p>
            </td></tr>
          </table>
          <p style="margin:0 0 26px;text-align:center;">
            <a href="${escapeAttribute(input.link)}" style="display:inline-block;background:#0f2d24;color:#fbf7e9;text-decoration:none;padding:13px 30px;border-radius:10px;font-weight:600;font-size:14.5px;">Open the matter</a>
          </p>
        </td></tr>

        <tr><td style="padding:0 32px 6px;">
          <hr style="border:none;border-top:1px solid #ececec;margin:0 0 20px;" />
          <p style="margin:0 0 4px;color:#0f2d24;font-size:16px;font-weight:600;">How to sign in</p>
          <p style="margin:0 0 18px;color:#71717a;font-size:13px;line-height:1.55;">
            Advottic creates your account on your first sign-in, using the email this invite was sent to. Pick whichever is easier, there is no separate signup form.
          </p>

          <p style="margin:0 0 8px;color:#0f2d24;font-size:14px;font-weight:600;">Option 1 &middot; Continue with a provider</p>
          <p style="margin:0 0 12px;color:#3f3f46;font-size:13.5px;line-height:1.55;">
            On the sign-in screen, tap <strong>Continue with Google</strong>, <strong>Continue with Microsoft</strong>, or <strong>Sign in with Apple</strong>, whichever matches your invited email. That is the whole step.
          </p>
          <img src="${escapeAttribute(optionsImg)}" width="536" alt="Advottic sign-in screen showing Continue with Google, Continue with Microsoft, Sign in with Apple, and an Email me a sign-in code option" style="display:block;width:100%;max-width:536px;height:auto;border:1px solid #e7e2d3;border-radius:12px;margin:0 0 26px;" />

          <p style="margin:0 0 8px;color:#0f2d24;font-size:14px;font-weight:600;">Option 2 &middot; Email yourself a sign-in code</p>
          <p style="margin:0 0 12px;color:#3f3f46;font-size:13.5px;line-height:1.55;">
            Prefer no provider? Enter your email and tap <strong>Email me a sign-in code</strong>. Advottic sends a one-time <strong>8-digit code</strong> in a separate email (shown below). Type it into the same screen to finish. The code expires in 60 minutes and works only once.
          </p>
          <img src="${escapeAttribute(codeImg)}" width="536" alt="The Advottic sign-in code email, showing an example 8-digit code such as 4829 3107 to enter on the sign-in screen" style="display:block;width:100%;max-width:536px;height:auto;border:1px solid #e7e2d3;border-radius:12px;margin:0 0 8px;" />
          <p style="margin:0 0 22px;color:#a1a1aa;font-size:11.5px;line-height:1.5;">The code above (4829 3107) is only an example of what the email looks like. Your real code arrives when you tap "Email me a sign-in code."</p>
        </td></tr>

        <tr><td style="padding:0 32px 8px;">
          <p style="margin:0 0 8px;color:#71717a;font-size:12px;line-height:1.55;">If a button does not open, paste this link into your browser:</p>
          <p style="margin:0 0 20px;word-break:break-all;color:#52525b;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">${escapeHtml(input.link)}</p>
          <p style="margin:0;color:#a1a1aa;font-size:11.5px;line-height:1.55;">Advottic provides legal information and case organization, not legal advice. If you weren't expecting this invitation, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="padding:18px 32px 28px;">
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

/**
 * Shared premium shell for the secure-share emails: near-black outer canvas,
 * white card, black-gradient masthead carrying the REAL Advottic wordmark (the
 * same /advottic-wordmark.png the app header renders) over a gold rule, and a
 * gold security eyebrow. Matches the sign-in code email's executive look.
 */
function secureShareShell(input: { eyebrow: string; headline: string; bodyHtml: string; firmName?: string | null }): string {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0b;padding:36px 16px;">
    <tr><td align="center">
      <table role="presentation" width="500" cellpadding="0" cellspacing="0" style="max-width:500px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 34px -6px rgba(0,0,0,0.55);border:1px solid #1c1c1e;">
        <tr><td align="center" style="background:linear-gradient(135deg,#0b0b0c 0%,#14140f 55%,#1b1710 100%);padding:30px 34px 24px;border-bottom:2px solid #e8c878;">
          <img src="https://advottic.com/advottic-wordmark.png" alt="Advottic" width="150" style="display:block;margin:0 auto;width:150px;height:auto;border:0;outline:none;text-decoration:none;" />
          <p style="margin:16px 0 0;color:#e8c878;font-size:10.5px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;">${escapeHtml(input.eyebrow)}</p>
          <p style="margin:8px 0 0;color:#f4f0e6;font-size:17px;font-weight:600;letter-spacing:-0.005em;">${escapeHtml(input.headline)}</p>
        </td></tr>
        <tr><td style="padding:28px 34px 8px;">${input.bodyHtml}</td></tr>
        <tr><td style="padding:16px 34px 28px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0 0 12px;" />
          ${input.firmName ? `<p style="margin:0 0 4px;color:#71717a;font-size:11.5px;">Sent on behalf of <span style="font-weight:600;color:#3f3f46;">${escapeHtml(input.firmName)}</span></p>` : ''}
          <p style="margin:0;color:#a1a1aa;font-size:11px;letter-spacing:0.04em;">© ${year} Advottic LLC &middot; End-to-end encrypted document delivery.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function buildShareLinkEmailHtml(input: {
  caseTitle: string;
  senderName: string | null;
  firmName: string | null;
  link: string;
  expiresAt: Date;
  note?: string;
}): string {
  const expires = input.expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const body = `
    <p style="margin:0 0 6px;color:#3f3f46;font-size:14.5px;line-height:1.6;">${escapeHtml(input.senderName || 'A colleague')} has shared an encrypted document with you.</p>
    <p style="margin:0 0 18px;color:#0b0b0c;font-size:15.5px;font-weight:700;line-height:1.4;">${escapeHtml(input.caseTitle)}</p>
    ${input.note ? `<p style="margin:0 0 18px;color:#52525b;font-size:13px;line-height:1.6;background:#faf7ef;border:1px solid #e6d9b6;border-radius:12px;padding:12px 14px;">${escapeHtml(input.note)}</p>` : ''}
    <div style="margin:0 0 20px;text-align:center;">
      <a href="${escapeAttribute(input.link)}" style="display:inline-block;background:linear-gradient(135deg,#e8c878 0%,#d5bb7e 100%);color:#0b0b0c;text-decoration:none;padding:14px 30px;border-radius:12px;font-size:14.5px;font-weight:700;letter-spacing:0.01em;">Open the secure document</a>
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#0b0b0c;border-radius:12px;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0 0 3px;color:#e8c878;font-size:10.5px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Encrypted &middot; AES-256</p>
        <p style="margin:0;color:#d4d4d8;font-size:12.5px;line-height:1.6;">This document is sealed with a one-time key. <span style="color:#f4f0e6;font-weight:600;">Your decryption key arrives in a separate email</span> — you will need it to open the document.</p>
      </td></tr>
    </table>
    <p style="margin:0;color:#a1a1aa;font-size:11.5px;line-height:1.6;">This secure link expires ${escapeHtml(expires)}. Confidential — please do not forward.</p>`;
  return secureShareShell({ eyebrow: 'Secure document delivery', headline: 'A document has been shared with you', bodyHtml: body, firmName: input.firmName });
}

export function buildShareKeyEmailHtml(input: {
  caseTitle: string;
  firmName: string | null;
  key: string;
}): string {
  const body = `
    <p style="margin:0 0 18px;color:#3f3f46;font-size:14.5px;line-height:1.6;">Here is your decryption key for the secure document <span style="font-weight:700;color:#0b0b0c;">${escapeHtml(input.caseTitle)}</span>:</p>
    <div style="margin:0 0 18px;text-align:center;">
      <span style="display:inline-block;max-width:100%;padding:16px 20px;background:#faf7ef;border:1px solid #e6d9b6;border-radius:14px;color:#0b0b0c;font-size:15px;font-weight:700;letter-spacing:0.06em;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all;">${escapeHtml(input.key)}</span>
    </div>
    <p style="margin:0 0 6px;color:#71717a;font-size:12.5px;line-height:1.6;">Enter it on the secure page from the previous email, then complete the quick human-verification step to unlock the document.</p>
    <p style="margin:0;color:#a1a1aa;font-size:11.5px;line-height:1.6;">Never share this key. Advottic will never ask for it by phone or email reply.</p>`;
  return secureShareShell({ eyebrow: 'Encrypted · AES-256', headline: 'Your decryption key', bodyHtml: body, firmName: input.firmName });
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
