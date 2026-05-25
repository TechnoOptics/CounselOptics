/**
 * Distress phrase detector.
 *
 * Pure function. Watches free-text input (Bella chat box, Decoder
 * paste area, voice-note transcripts, case notes) for high-
 * confidence phrases that signal the user is in immediate physical
 * danger or in a mental-health crisis. Returns a match object the
 * caller dispatches as a `distress:detected` window event, which the
 * <DistressOverlay /> in the root layout consumes.
 *
 * False positives are the enemy. Every phrase here has been chosen
 * so that the most plausible interpretation is genuine distress; we
 * also explicitly EXCLUDE phrases that read as distress in isolation
 * but are common in case-prep / legal-tech contexts (e.g. "this is
 * hurting my case", "in danger of losing", "they harmed our brand").
 *
 * Two severity tiers:
 *   - 'acute'  - self-harm / suicide / mental-health crisis. Overlay
 *                prominently surfaces 988 + Crisis Text Line.
 *   - 'danger' - imminent physical danger from another person.
 *                Overlay prominently surfaces 911 + Safe Witness.
 *
 * Tier is what changes which support resource is the loudest
 * button, NOT whether the overlay fires. The user always sees BOTH
 * (911 and 988) so they pick the appropriate one for their actual
 * situation.
 */

export type DistressTier = 'acute' | 'danger';

export type DistressMatch = {
  tier: DistressTier;
  /** Lowercased phrase that triggered the match. */
  phrase: string;
  /** Window of source text around the match (up to 80 chars), for
   *  logging / debugging. NOT shown in the overlay UI to the user. */
  excerpt: string;
};

/**
 * Acute tier - mental-health crisis. Surfaces 988 first.
 *
 * Every phrase is one a person would only realistically say about
 * themselves in distress. We do NOT match generic "kill" / "die" /
 * "hurt" alone because of obvious legal-prep false positives
 * ("the bill killed my budget", "this argument died at trial").
 */
const ACUTE_PHRASES: ReadonlyArray<string> = [
  'i want to kill myself',
  "i'm going to kill myself",
  'i am going to kill myself',
  'i want to end it all',
  "i'm going to end it all",
  'i want to die',
  "i don't want to live",
  'i do not want to live',
  "i can't go on",
  'i cannot go on',
  'i want to hurt myself',
  "i'm going to hurt myself",
  'i am going to hurt myself',
  "i'm going to cut myself",
  'i want to cut myself',
  "i'm suicidal",
  'i am suicidal',
  "i'm thinking about suicide",
  'thinking about ending my life',
  "i've taken pills",
  'i have taken pills',
  'overdosed',
  "i'm overdosing",
  'i am overdosing',
];

/**
 * Danger tier - imminent physical danger from another person, or
 * acute requests for help. Surfaces 911 + Safe Witness first.
 *
 * Many of these phrases include "me" / "us" / "my" to anchor the
 * meaning to the speaker's first-person situation - keeps "they're
 * hurting our case" / "in danger of getting sanctioned" from
 * firing.
 */
const DANGER_PHRASES: ReadonlyArray<string> = [
  'help me',
  'someone help',
  'call 911',
  'call the police',
  'call the cops',
  "i'm being hurt",
  'i am being hurt',
  "he's hurting me",
  'he is hurting me',
  "she's hurting me",
  'she is hurting me',
  "they're hurting me",
  'they are hurting me',
  "he's beating me",
  'he is beating me',
  "she's beating me",
  'she is beating me',
  "i'm in danger",
  'i am in danger',
  "i'm being attacked",
  'i am being attacked',
  'i was attacked',
  "i'm being followed",
  'i am being followed',
  "i'm being stalked",
  'i am being stalked',
  "i'm being assaulted",
  'i am being assaulted',
  'i was assaulted',
  "i'm being raped",
  'i am being raped',
  'i was raped',
  "i'm afraid for my life",
  'i fear for my life',
  "i'm being abused",
  'i am being abused',
  'save me',
  "i've been kidnapped",
  'i have been kidnapped',
  'someone is in my house',
  "there's someone in my house",
  "he's going to kill me",
  'he is going to kill me',
  "she's going to kill me",
  'she is going to kill me',
  "they're going to kill me",
  'they are going to kill me',
];

/**
 * Negation / disclaimer windows. If any of these substrings appear
 * within 30 characters BEFORE the matched phrase we treat the match
 * as non-firing - it's a hypothetical, a denial, a quotation.
 *
 * E.g.:
 *   "she is hurting me"             - fires
 *   "i'm not saying she is hurting me" - does NOT fire (negation)
 *   "the witness said she is hurting me" - does NOT fire (quoted)
 *   "what if she is hurting me"     - does NOT fire (hypothetical)
 *
 * This is intentionally conservative - we'd rather fail to fire on
 * a real signal that's wrapped in quotation than fire spuriously
 * on a hypothetical. The user can always press the Safe Witness
 * button directly if the overlay didn't auto-detect.
 */
const NEGATION_WINDOWS: ReadonlyArray<string> = [
  'not ',
  "n't ",
  'never ',
  'said ',
  'wrote ',
  'asked ',
  'told ',
  'claimed ',
  'allege',
  'hypothetic',
  'imagine',
  'what if',
  'pretend',
  '"',
  "'",
  'quote',
  'witness',
  'transcript',
  'testif',
];

/**
 * Words that, when found anywhere in the input, suggest a legal-
 * prep / case-document context strong enough to suppress the
 * detector. Same logic: case files often contain testimony with
 * distress-adjacent language; we don't want to spam the overlay
 * during pure document analysis.
 *
 * Note: this is a deliberate trade-off. A user reading a transcript
 * of their own past assault for a deposition WILL be hidden from
 * the overlay. They can always tap Safe Witness directly. The
 * alternative - firing the overlay every time a user opens a
 * contract that mentions "harm" - is much worse.
 */
const CASE_CONTEXT_HINTS: ReadonlyArray<string> = [
  'plaintiff',
  'defendant',
  'witness statement',
  'deposition',
  'affidavit',
  'pleading',
  'subpoena',
  'docket',
  'transcript of',
  'exhibit ',
  'case file',
  'court order',
];

/**
 * Main entry point. Returns the first matching phrase (lowest-
 * severity match wins ties; tier 'acute' beats 'danger' if both
 * match the same text).
 *
 * Pass null / undefined / short strings to short-circuit.
 */
export function detectDistress(input: string | null | undefined): DistressMatch | null {
  if (!input) return null;
  // Strip down to a normalized lowercase form for matching. We
  // collapse runs of whitespace + punctuation to single spaces so
  // "I... am being   hurt!!" matches "i am being hurt".
  const trimmed = input.trim();
  if (trimmed.length < 4) return null;
  const normalized = trimmed
    .toLowerCase()
    .replace(/[.,;:!?(){}\[\]"'`]/g, ' ')
    .replace(/\s+/g, ' ');
  // If the text reads as a legal case context, suppress.
  for (const hint of CASE_CONTEXT_HINTS) {
    if (normalized.includes(hint)) return null;
  }

  function findMatch(phrases: ReadonlyArray<string>): string | null {
    for (const phrase of phrases) {
      const idx = normalized.indexOf(phrase);
      if (idx < 0) continue;
      // Check the 30-char window before the match for negators.
      const windowStart = Math.max(0, idx - 30);
      const before = normalized.slice(windowStart, idx);
      const negated = NEGATION_WINDOWS.some((n) => before.includes(n));
      if (negated) continue;
      return phrase;
    }
    return null;
  }

  // Acute tier wins over danger tier when both could match - 988 is
  // the more time-sensitive intervention.
  const acute = findMatch(ACUTE_PHRASES);
  if (acute) {
    return {
      tier: 'acute',
      phrase: acute,
      excerpt: makeExcerpt(normalized, acute),
    };
  }
  const danger = findMatch(DANGER_PHRASES);
  if (danger) {
    return {
      tier: 'danger',
      phrase: danger,
      excerpt: makeExcerpt(normalized, danger),
    };
  }
  return null;
}

function makeExcerpt(normalized: string, phrase: string): string {
  const idx = normalized.indexOf(phrase);
  if (idx < 0) return phrase;
  const start = Math.max(0, idx - 30);
  const end = Math.min(normalized.length, idx + phrase.length + 30);
  return normalized.slice(start, end);
}

/**
 * Browser-side helper: dispatches the detected match as a window
 * event the <DistressOverlay /> component listens for. Centralised
 * so every call site (Bella, Decoder, voice transcript, etc.) uses
 * a consistent event name + payload shape.
 */
export function emitDistress(match: DistressMatch): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('distress:detected', { detail: match }),
  );
}
