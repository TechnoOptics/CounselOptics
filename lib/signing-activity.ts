import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * What happened to a document after it went out, for the people waiting on it.
 *
 * THE PROBLEM THIS SOLVES, AND THE ONE IT DOES NOT
 * ------------------------------------------------
 * A firm sends a document for signature and, until the signature lands, learns
 * nothing. The events were already being written: lib/esign-audit.ts has
 * carried a `link_viewed` type since the audit trail shipped, and
 * app/sign/[token]/page.tsx has been appending one on every render of the
 * signing page. Nothing in the product ever read them back. The only reader
 * was /api/firm/sign/audit-trail/[requestId], which no page calls. So this is
 * mostly a reporting module, not a tracking one, and it is deliberately built
 * on the events that already exist rather than beside them.
 *
 * WHAT AN OPEN IS AND IS NOT
 * --------------------------
 * An `link_viewed` row means an HTTP request for the signing page arrived
 * carrying that signer's token. It does not mean a person read the document.
 * A mail client that prefetches links, a corporate link scanner that detonates
 * every URL in an inbound message, and a bot all produce exactly the same row.
 * Reporting any of those to a firm as "the recipient read it" would be a false
 * statement about a real person's behaviour on a legal matter, so
 * classifyOpenAttribution below splits the ones we can positively identify as
 * machines out of the count, and the copy for everything left says "opened",
 * never "read".
 *
 * The split is one-directional and that is on purpose. 'automated' is a
 * positive identification, never a guess: a prefetch header the browser set,
 * or a user agent that names itself a machine. Everything else is
 * 'unverified', which means what it says. Only 'interactive' carries a
 * browser's own attestation that a person acted, via Sec-Fetch-User, and even
 * that only establishes a click, not a reader.
 *
 * SILENCE
 * -------
 * The two ways a document goes quiet are different facts and a firm acts
 * differently on each. Never opened means the message very likely did not
 * reach the person, and the answer is a resend or a phone call. Opened and
 * then nothing means it reached them and they have not signed, and the answer
 * is a conversation. resolveActivityVerdict tells them apart and never
 * collapses them into one "no response" state.
 *
 * WHAT IS ABSENT FROM EVERY TYPE HERE
 * -----------------------------------
 * IP address and user agent. Both are on the event rows and both are properly
 * the firm's to read, since the firm is the party that would rely on the
 * record. Neither belongs in front of the colleague who filed the document:
 * they are waiting on an outcome, not investigating a person. The boundary is
 * structural rather than a filter someone has to remember to apply, because
 * SignerOpenActivity has no field that could carry either one. See
 * tests/signing-activity.test.ts, which asserts it over rows that do.
 */

// ---------------------------------------------------------------------
// 1. Who opened it: a person, or a machine that opens everything
// ---------------------------------------------------------------------

/**
 * 'interactive' the browser attested that a user activation caused this
 *               navigation (Sec-Fetch-User: ?1). A person clicked. It still
 *               does not establish that they read anything.
 * 'automated'   positively identified as not a person: a prefetch or preview
 *               the browser announced, or a client naming itself a machine.
 * 'unverified'  looks like a browser opening a page, and nothing on the wire
 *               says whether a person was behind it.
 */
export type OpenAttribution = 'interactive' | 'unverified' | 'automated';

/** Header values that mean the client is fetching this ahead of any click. */
const PREFETCH_PURPOSES = new Set(['prefetch', 'preview', 'prerender', 'instant']);

/**
 * Substrings that appear in the user agent of clients that are not people.
 * Lowercased, matched as substrings. Deliberately short: a wrong entry here
 * hides a real open, which is worse than counting a machine as unverified.
 */
const MACHINE_AGENTS = [
  'bot',
  'crawler',
  'spider',
  'slurp',
  'curl/',
  'wget',
  'python-requests',
  'python-urllib',
  'go-http-client',
  'java/',
  'okhttp',
  'headlesschrome',
  'phantomjs',
  'apache-httpclient',
  'axios/',
  'node-fetch',
  'proofpoint',
  'mimecast',
  'barracuda',
  'safelinks',
  'urldefense',
  'symantec',
  'forcepoint',
  'linkcheck',
  'preview',
  'monitoring',
  'uptime',
];

export function classifyOpenAttribution(input: {
  /** Sec-Fetch-User: '?1' when a user activation caused the navigation. */
  secFetchUser?: string | null;
  /** Sec-Fetch-Mode. */
  secFetchMode?: string | null;
  /** Sec-Purpose (Chrome), Purpose, X-Purpose, X-moz: prefetch signals. */
  secPurpose?: string | null;
  purpose?: string | null;
  xPurpose?: string | null;
  xMoz?: string | null;
  userAgent?: string | null;
}): OpenAttribution {
  const purposeHeaders = [
    input.secPurpose,
    input.purpose,
    input.xPurpose,
    input.xMoz,
  ];
  for (const raw of purposeHeaders) {
    const value = (raw ?? '').trim().toLowerCase();
    if (!value) continue;
    // Sec-Purpose is a structured header and can carry parameters, so the
    // token is taken rather than the whole value compared.
    for (const token of value.split(/[;,]/)) {
      if (PREFETCH_PURPOSES.has(token.trim())) return 'automated';
    }
  }

  const agent = (input.userAgent ?? '').trim().toLowerCase();
  // Every real browser sends a user agent. Nothing does is a script.
  if (!agent) return 'automated';
  if (MACHINE_AGENTS.some((needle) => agent.includes(needle))) return 'automated';

  const mode = (input.secFetchMode ?? '').trim().toLowerCase();
  if ((input.secFetchUser ?? '').trim() === '?1' && mode === 'navigate') {
    return 'interactive';
  }
  return 'unverified';
}

/** The metadata key the attribution is written under on a link_viewed event. */
export const OPEN_ATTRIBUTION_KEY = 'open_attribution';

/**
 * Read the attribution back off an event, for rows written before this
 * existed and for rows whose metadata is unreadable.
 *
 * The fallback is 'unverified' and not 'interactive': an older row carries no
 * evidence that a person acted, and inventing one would be the exact
 * overclaim this module exists to avoid.
 */
export function attributionOfEvent(
  metadata: Record<string, unknown> | null | undefined,
): OpenAttribution {
  const raw = metadata?.[OPEN_ATTRIBUTION_KEY];
  if (raw === 'interactive' || raw === 'automated' || raw === 'unverified') {
    return raw;
  }
  return 'unverified';
}

// ---------------------------------------------------------------------
// 2. Rolling the events up per signer
// ---------------------------------------------------------------------

/**
 * What one recipient did with the link. No IP, no user agent, no hashes: see
 * the note at the top of this file for why that is a property of the type.
 */
export type SignerOpenActivity = {
  /** Opens NOT identified as a machine. The number a person is shown. */
  opens: number;
  /** Of those, the ones a browser attested were caused by a user activation. */
  interactiveOpens: number;
  /** Opens positively identified as a prefetch, scanner or bot. */
  automatedOpens: number;
  /** First and last non-automated open. Null when there were none. */
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  /** Times the recipient pulled the file itself, before signing. */
  downloads: number;
  lastDownloadedAt: string | null;
};

export const NO_ACTIVITY: SignerOpenActivity = {
  opens: 0,
  interactiveOpens: 0,
  automatedOpens: 0,
  firstOpenedAt: null,
  lastOpenedAt: null,
  downloads: 0,
  lastDownloadedAt: null,
};

/** The shape this module needs off firm_signature_events. */
export type ActivityEvent = {
  event_type: string;
  signer_email: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/**
 * Roll a request's events up per signer address.
 *
 * Keyed on the lowercased signer email because that is the only identifier
 * every one of these events carries and the only one both reading surfaces
 * already have in hand. An event with no address on it is skipped rather than
 * bucketed somewhere: attributing an open to the wrong recipient on a legal
 * matter is worse than not reporting it.
 */
export function summarizeSignerActivity(
  events: readonly ActivityEvent[],
): Map<string, SignerOpenActivity> {
  const out = new Map<string, SignerOpenActivity>();
  for (const event of events) {
    const email = (event.signer_email ?? '').trim().toLowerCase();
    if (!email) continue;
    const isOpen = event.event_type === 'link_viewed';
    const isDownload = event.event_type === 'document_downloaded';
    if (!isOpen && !isDownload) continue;

    const current = out.get(email) ?? { ...NO_ACTIVITY };
    if (isDownload) {
      current.downloads += 1;
      if (isLater(event.created_at, current.lastDownloadedAt)) {
        current.lastDownloadedAt = event.created_at;
      }
    } else {
      const attribution = attributionOfEvent(event.metadata);
      if (attribution === 'automated') {
        current.automatedOpens += 1;
      } else {
        current.opens += 1;
        if (attribution === 'interactive') current.interactiveOpens += 1;
        if (isEarlier(event.created_at, current.firstOpenedAt)) {
          current.firstOpenedAt = event.created_at;
        }
        if (isLater(event.created_at, current.lastOpenedAt)) {
          current.lastOpenedAt = event.created_at;
        }
      }
    }
    out.set(email, current);
  }
  return out;
}

function millis(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function isLater(candidate: string, held: string | null): boolean {
  const a = millis(candidate);
  if (a === null) return false;
  const b = millis(held);
  return b === null || a > b;
}

function isEarlier(candidate: string, held: string | null): boolean {
  const a = millis(candidate);
  if (a === null) return false;
  const b = millis(held);
  return b === null || a < b;
}

// ---------------------------------------------------------------------
// 3. What the employee may see
// ---------------------------------------------------------------------

/**
 * The colleague who filed the document is waiting on an outcome, not running
 * an investigation. They get the facts about their own document and nothing
 * about the recipient as a person.
 *
 * `interactiveOpens` and `automatedOpens` are dropped rather than kept and
 * hidden by the template. Both are forensic detail: the first invites a reader
 * to treat one open as more real than another, and the second is a fact about
 * the recipient's mail infrastructure. Neither changes what the employee
 * should do next, which is the test this projection applies.
 */
export type SubmitterOpenActivity = {
  opens: number;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  downloads: number;
  lastDownloadedAt: string | null;
};

export function projectActivityForSubmitter(
  activity: SignerOpenActivity,
): SubmitterOpenActivity {
  return {
    opens: activity.opens,
    firstOpenedAt: activity.firstOpenedAt,
    lastOpenedAt: activity.lastOpenedAt,
    downloads: activity.downloads,
    lastDownloadedAt: activity.lastDownloadedAt,
  };
}

// ---------------------------------------------------------------------
// 4. Silence, and which kind of silence it is
// ---------------------------------------------------------------------

/**
 * How long a document sits with no signature before the quiet is worth
 * stating rather than waiting out.
 *
 * One window rather than two, because the interesting difference is WHICH
 * fact is true, not when each becomes true. Five working-ish days is long
 * enough that an ordinary week of someone else's calendar does not trip it and
 * short enough that a document lost in a spam folder is caught in the same
 * month it was sent. It is a product default and a firm will eventually want
 * it per-request; that is a decision for a person, not a thing to guess at
 * here, so it is one exported constant and not a scattering of literals.
 */
export const SIGNING_QUIET_AFTER_DAYS = 5;

export type ActivityVerdict =
  /** Done. */
  | { kind: 'signed'; at: string }
  /** They answered, and the answer was not a signature. */
  | { kind: 'responded' }
  /** Nothing has gone out yet, so there is nothing to be quiet about. */
  | { kind: 'not_sent' }
  /** Out, unopened, and still inside the window. */
  | { kind: 'waiting'; daysSinceSent: number }
  /** Out, and never opened by anything we would call a person. */
  | { kind: 'never_opened'; daysSinceSent: number }
  /** Opened, and nothing since, inside the window. */
  | { kind: 'opened_recently'; daysSinceOpened: number }
  /** Opened, and nothing since, past the window. */
  | { kind: 'opened_quiet'; daysSinceOpened: number };

export function resolveActivityVerdict(input: {
  signedAt: string | null;
  /** firm_signatures.response: 'rejected' or 'changes_requested'. */
  response: string | null;
  /** firm_signing_requests.sent_at. */
  sentAt: string | null;
  activity: SignerOpenActivity | SubmitterOpenActivity;
  now: Date;
  quietAfterDays?: number;
}): ActivityVerdict {
  if (input.signedAt) return { kind: 'signed', at: input.signedAt };
  if (input.response) return { kind: 'responded' };
  if (!input.sentAt) return { kind: 'not_sent' };
  const quiet = input.quietAfterDays ?? SIGNING_QUIET_AFTER_DAYS;

  const last = input.activity.lastOpenedAt;
  if (input.activity.opens === 0 || !last) {
    const days = daysBetween(input.sentAt, input.now);
    // An unparseable sent_at is not evidence of anything. Treat it as inside
    // the window rather than declaring a document unopened for -1 days.
    if (days === null) return { kind: 'waiting', daysSinceSent: 0 };
    return days >= quiet
      ? { kind: 'never_opened', daysSinceSent: days }
      : { kind: 'waiting', daysSinceSent: days };
  }

  const days = daysBetween(last, input.now);
  if (days === null) return { kind: 'opened_recently', daysSinceOpened: 0 };
  return days >= quiet
    ? { kind: 'opened_quiet', daysSinceOpened: days }
    : { kind: 'opened_recently', daysSinceOpened: days };
}

/** Whole days from an ISO instant to now, or null if it will not parse. */
export function daysBetween(iso: string, now: Date): number | null {
  const then = new Date(iso).getTime();
  const at = now.getTime();
  if (!Number.isFinite(then) || !Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((at - then) / 86_400_000));
}

/** True when the verdict is one a firm should act on rather than wait out. */
export function verdictNeedsAttention(verdict: ActivityVerdict): boolean {
  return verdict.kind === 'never_opened' || verdict.kind === 'opened_quiet';
}

/**
 * What each verdict says, to each audience.
 *
 * Two dictionaries because the two readers need different sentences, not the
 * same sentence in different sizes. The firm's version names the next move,
 * because they are the party who can make it. The employee's version reports
 * and stops, because chasing a counterparty is not their job and telling them
 * to do it would cut across their own legal team.
 *
 * Nothing in either dictionary says "read", "reviewed" or "seen". An open is
 * an HTTP request; see the header of this file.
 */
export function firmActivitySentence(verdict: ActivityVerdict): string {
  switch (verdict.kind) {
    case 'signed':
      return 'Signed.';
    case 'responded':
      return 'They answered without signing. Their note is on this request.';
    case 'not_sent':
      return 'Not sent yet.';
    case 'waiting':
      return verdict.daysSinceSent <= 0
        ? 'Sent today. Not opened yet.'
        : `Sent ${plural(verdict.daysSinceSent, 'day')} ago. Not opened yet.`;
    case 'never_opened':
      return `Sent ${plural(verdict.daysSinceSent, 'day')} ago and the link has not been opened. Worth checking the address, or calling them.`;
    case 'opened_recently':
      return verdict.daysSinceOpened <= 0
        ? 'Opened today, not signed yet.'
        : `Opened ${plural(verdict.daysSinceOpened, 'day')} ago, not signed yet.`;
    case 'opened_quiet':
      return `Opened ${plural(verdict.daysSinceOpened, 'day')} ago and nothing since. The link reached them, so a reminder is a conversation rather than a resend.`;
  }
}

export function submitterActivitySentence(verdict: ActivityVerdict): string {
  switch (verdict.kind) {
    case 'signed':
      return 'Signed.';
    case 'responded':
      return 'They answered without signing. Your legal team has their note.';
    case 'not_sent':
      return 'This has not gone out yet.';
    case 'waiting':
      return verdict.daysSinceSent <= 0
        ? 'Sent today. Not opened yet.'
        : `Sent ${plural(verdict.daysSinceSent, 'day')} ago. Not opened yet.`;
    case 'never_opened':
      return `Sent ${plural(verdict.daysSinceSent, 'day')} ago and the link has not been opened. Your legal team can send it again.`;
    case 'opened_recently':
      return verdict.daysSinceOpened <= 0
        ? 'Opened today. Not signed yet.'
        : `Opened ${plural(verdict.daysSinceOpened, 'day')} ago. Not signed yet.`;
    case 'opened_quiet':
      return `Opened ${plural(verdict.daysSinceOpened, 'day')} ago and nothing since. Your legal team can follow up.`;
  }
}

/**
 * The count sentence, which is where an overclaim would be easiest to make.
 * It says the link was opened. It does not say anybody read anything, and it
 * never reports an automated open as one of the opens.
 */
export function opensSentence(activity: {
  opens: number;
  downloads: number;
}): string | null {
  const parts: string[] = [];
  if (activity.opens > 0) {
    parts.push(`opened ${plural(activity.opens, 'time')}`);
  }
  if (activity.downloads > 0) {
    parts.push(`downloaded ${plural(activity.downloads, 'time')}`);
  }
  if (parts.length === 0) return null;
  return `Link ${parts.join(', ')}.`;
}

/** What an automated open is, in one sentence, for the firm only. */
export function automatedOpensSentence(activity: SignerOpenActivity): string | null {
  if (activity.automatedOpens <= 0) return null;
  return `${plural(activity.automatedOpens, 'open')} came from a link scanner or a mail client fetching the link, and ${
    activity.automatedOpens === 1 ? 'is' : 'are'
  } not counted above.`;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------
// 5. Reading the events back
// ---------------------------------------------------------------------

/**
 * Load one request's open and download activity, per signer address.
 *
 * Reads through the service-role client because firm_signature_events is
 * RLS-gated to firm members and one of the two callers is the portal, where
 * the reader is an employee and not a member of anything. The containment is
 * therefore the caller's: both establish who is asking and which request they
 * are entitled to before they get here, and the employee's caller passes the
 * result through projectActivityForSubmitter.
 *
 * An unreadable table returns NULL, not an empty map, and never a throw.
 * Neither surface may fail to render because the activity could not be read,
 * and neither may report "not opened" when what actually happened is that the
 * question could not be asked. Those are different facts, and this whole
 * module exists because a product that conflates them tells people things
 * that are not true.
 */
export async function loadSigningActivity(
  admin: SupabaseClient,
  signingRequestId: string,
): Promise<Map<string, SignerOpenActivity> | null> {
  const { data, error } = await admin
    .from('firm_signature_events')
    .select('event_type, signer_email, metadata, created_at')
    .eq('signing_request_id', signingRequestId)
    .in('event_type', ['link_viewed', 'document_downloaded'])
    .order('created_at', { ascending: true });
  if (error || !data) return null;
  return summarizeSignerActivity(data as unknown as ActivityEvent[]);
}
