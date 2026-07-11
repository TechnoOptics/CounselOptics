import 'server-only';
import { simpleParser, type AddressObject } from 'mailparser';
import type { AiExtracted } from './timeline-types';

/**
 * Email evidence parser. Turns a raw email file into the same shape the rest of
 * the timeline pipeline speaks: a text body (fed to the reader for analysis)
 * plus a partial AiExtracted carrying the header facts (sender, recipients,
 * date, subject) so people/dates flow into the timeline and the map exactly
 * like any other item.
 *
 * .eml (RFC 822) is parsed fully via `mailparser`. Outlook .msg is a binary
 * OLE container `mailparser` does not read, so it is handled best-effort: we
 * still create the entry and surface a note asking for a .eml export.
 */

export type ParsedEmail = {
  /** From / To / Date / Subject header block + the plain-text body. */
  text: string;
  /** Header facts merged into the item's analysis. */
  extracted: Partial<AiExtracted>;
  /** Set when the file could only be handled best-effort (e.g. .msg). */
  error?: string;
};

// Common webmail hosts are not meaningful "organizations".
const WEBMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com',
  'hotmail.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me',
  'protonmail.com', 'msn.com', 'gmx.com',
]);

function namesFrom(addr: AddressObject | AddressObject[] | undefined): string[] {
  if (!addr) return [];
  const list = Array.isArray(addr) ? addr : [addr];
  const out: string[] = [];
  for (const a of list) {
    for (const v of a.value ?? []) {
      const label = (v.name?.trim() || v.address?.trim() || '').trim();
      if (label) out.push(label);
    }
  }
  return out;
}

function addressesFrom(addr: AddressObject | AddressObject[] | undefined): string[] {
  if (!addr) return [];
  const list = Array.isArray(addr) ? addr : [addr];
  const out: string[] = [];
  for (const a of list) {
    for (const v of a.value ?? []) {
      if (v.address) out.push(v.address.trim());
    }
  }
  return out;
}

function orgsFromAddresses(addresses: string[]): string[] {
  const orgs = new Set<string>();
  for (const a of addresses) {
    const domain = a.split('@')[1]?.toLowerCase().trim();
    if (domain && !WEBMAIL.has(domain)) orgs.add(domain);
  }
  return [...orgs];
}

function uniq(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

/**
 * Flatten an HTML email part to readable plain text. Used only when the message
 * carries no text/plain alternative (HTML-only marketing / rich mail), which
 * would otherwise render as an empty body. Deliberately minimal - block tags
 * become line breaks, everything else is stripped, common entities decoded.
 */
function htmlToPlain(html: string | false | undefined): string {
  if (!html) return '';
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function parseEmail(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<ParsedEmail> {
  const isMsg = /\.msg$/i.test(filename) || /vnd\.ms-outlook|x-msg/i.test(mime);
  try {
    const mail = await simpleParser(buffer);

    const fromNames = namesFrom(mail.from);
    const toNames = namesFrom(mail.to);
    const ccNames = namesFrom(mail.cc);
    const allAddresses = [
      ...addressesFrom(mail.from),
      ...addressesFrom(mail.to),
      ...addressesFrom(mail.cc),
    ];

    const subject = mail.subject?.trim() || null;
    const date = mail.date ? mail.date.toISOString() : null;
    // Prefer the text/plain part; fall back to flattening HTML so an HTML-only
    // message still shows a readable body instead of a blank pane.
    const body = (mail.text ?? '').trim() || htmlToPlain(mail.html);
    const attachments = uniq(
      (mail.attachments ?? [])
        .map((a) => a.filename ?? '')
        .filter(Boolean),
    );

    // A .msg run that yields nothing usable: mailparser could not read the
    // binary container. Fall back to the best-effort branch.
    if (isMsg && !subject && !body && fromNames.length === 0) {
      return msgFallback(filename);
    }

    const headerBlock = [
      fromNames.length ? `From: ${fromNames.join(', ')}` : null,
      toNames.length ? `To: ${toNames.join(', ')}` : null,
      ccNames.length ? `Cc: ${ccNames.join(', ')}` : null,
      date ? `Date: ${date}` : null,
      subject ? `Subject: ${subject}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const text = `${headerBlock}\n\n${body}`.trim();

    const extracted: Partial<AiExtracted> = {
      ocr_text: text,
      detected_people: uniq([...fromNames, ...toNames, ...ccNames]),
      detected_dates: date ? [date] : [],
      organizations: orgsFromAddresses(allAddresses),
      suggested_title: subject ?? undefined,
      suggested_occurred_at: date,
      suggested_precision: date ? 'minute' : 'unknown',
      email: {
        from: fromNames[0] ?? addressesFrom(mail.from)[0] ?? null,
        to: uniq([...toNames, ...addressesFrom(mail.to)]),
        cc: uniq([...ccNames, ...addressesFrom(mail.cc)]),
        subject,
        date,
        attachments,
        body,
      },
    };

    return { text, extracted, error: isMsg ? undefined : undefined };
  } catch (err) {
    if (isMsg) return msgFallback(filename);
    return {
      text: '',
      extracted: {},
      error: err instanceof Error ? err.message : 'Could not parse this email.',
    };
  }
}

/** Best-effort stub for an Outlook .msg we cannot fully decode. */
function msgFallback(filename: string): ParsedEmail {
  const guessSubject = filename.replace(/\.msg$/i, '').replace(/[_-]+/g, ' ').trim();
  return {
    text: guessSubject,
    extracted: {
      suggested_title: guessSubject || undefined,
      email: { subject: guessSubject || null },
    },
    error:
      'Outlook .msg files are read best-effort. For full sender, recipient, and date parsing, export the message as .eml and re-upload.',
  };
}
