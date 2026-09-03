import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';

/**
 * Plain-limit copy: a plan limit is stated and the sentence stops there.
 *
 * WHAT WENT WRONG. Ten strings produced on the server as plain text ended with
 * a sentence naming where to buy: "Top up from /billing", "Upgrade from your
 * /billing page", "Open Billing to add a top-up or upgrade", "Consider
 * upgrading or buying a Boost pack". They reach every platform, including the
 * iOS app, where the CSS platform gate (globals.css, data-hide-on-ios) hides
 * elements and cannot reach inside a string. Advottic on iOS sells nothing and
 * names no place to buy, so each string now states the limit plainly and
 * stops. The reasoning is written once, at the first string in lib/ai.ts.
 *
 * WHY A SOURCE GUARD. Each string sits behind a database read (a token gate,
 * a subscription row, an item count) that vitest's node environment cannot
 * reach, so the reachable literal is READ, with comments stripped first. That
 * matters here more than usual: the explanatory comment in lib/ai.ts quotes
 * the very steering text this file forbids, so a guard that did not strip
 * comments would go red on the comment, and a guard that only looked for the
 * new words would go green on a string that had grown a new destination.
 *
 * WHAT IS ASSERTED. For each string, the line of source holding it is found
 * by a fragment of the new copy (so deleting or rewording the string is red,
 * not silently green), and that line is then checked for the ABSENCE of any
 * purchase destination or purchase verb. The ten original strings are kept
 * below as a positive control: the same matcher must flag every one of them,
 * which proves it can see the thing it is guarding against.
 */

const ROOT = join(__dirname, '..');

/** Anything that tells the reader where or how to buy. Case-sensitive on
 *  "Billing" so that "billing period" (a plain statement of time) passes. */
const PURCHASE_STEERING =
  /\/billing|billing page|Billing|[Tt]op[ -]?up|[Uu]pgrad|[Ss]ubscri|\b[Bb]uy(ing)?\b|Boost pack|\/pricing|[Cc]heckout|[Pp]urchase/;

type Pin = { file: string; anchor: string; original: string };

const PINS: Pin[] = [
  {
    file: 'lib/ai.ts',
    anchor: 'so a fresh review cannot run on this case right now',
    original:
      'Your Pro token balance is empty. Top up from /billing to run a fresh review on this case. Showing the example template below in the meantime.',
  },
  {
    file: 'lib/bella.ts',
    anchor: 'Chatting with Bella is not part of your current plan',
    original:
      'Bella is part of the Standard and Pro plans. Upgrade from your /billing page to chat with her.',
  },
  {
    file: 'lib/bella.ts',
    anchor: 'Your Bella tokens for this billing period are used up',
    original:
      "You've used up your Pro tokens for this billing period. Top up from your /billing page and I'll be right back.",
  },
  {
    file: 'lib/bella.ts',
    anchor: "Your firm's Bella tokens for this billing period are used up",
    original:
      "Your firm has used up its Bella tokens for this billing period. Top up from your firm's billing page and I'll be right back.",
  },
  {
    file: 'lib/actions.ts',
    anchor: 'Your free trial has ended, so a new case cannot be created right now',
    original: 'Your free trial has ended. Open /billing to subscribe, then create your case.',
  },
  {
    file: 'lib/actions.ts',
    anchor: 'Archive an existing case to make room',
    original:
      "You've reached your plan's limit of 3 cases. Upgrade from /billing, or archive an existing case to make room.",
  },
  {
    file: 'lib/actions.ts',
    anchor: 'Inviting collaborators is not part of your current plan',
    original: 'Inviting collaborators requires the Pro plan. Upgrade from /billing.',
  },
  {
    file: 'lib/item-limits.ts',
    anchor: 'Delete an existing item to make room for a new one',
    original:
      'Free includes 1 item. Upgrade to Personal Pro for 20 items, or delete an existing item to make room.',
  },
  {
    file: 'lib/item-limits.ts',
    anchor: 'tokens to your monthly debit.`',
    original:
      "You're 2 items over your 20-item plan. This adds about 1,000 tokens to your monthly debit. Consider upgrading or buying a Boost pack.",
  },
  {
    file: 'app/review-my-document/review-client.tsx',
    anchor: 'so a new review cannot start right now',
    original:
      'Your plan is out of review credits for this period. Open Billing to add a top-up or upgrade.',
  },
];

function strippedSource(file: string): string {
  return stripComments(readFileSync(join(ROOT, file), 'utf8'));
}

/** The single source line holding the anchor, or null when it is not there. */
function lineHolding(src: string, anchor: string): string | null {
  const at = src.indexOf(anchor);
  if (at < 0) return null;
  const start = src.lastIndexOf('\n', at) + 1;
  const end = src.indexOf('\n', at);
  return src.slice(start, end < 0 ? src.length : end);
}

describe('plain-limit copy: the limit is stated and the sentence stops there', () => {
  it('positive control: the matcher flags every one of the ten original strings', () => {
    for (const pin of PINS) {
      expect(pin.original, pin.file).toMatch(PURCHASE_STEERING);
    }
  });

  it('control: comments are stripped before matching (the lib/ai.ts note quotes the old copy)', () => {
    const raw = readFileSync(join(ROOT, 'lib/ai.ts'), 'utf8');
    expect(raw).toContain('Plain-limit copy');
    expect(strippedSource('lib/ai.ts')).not.toContain('Plain-limit copy');
  });

  for (const pin of PINS) {
    it(`${pin.file}: "${pin.anchor.slice(0, 48)}..." names no place to buy`, () => {
      const line = lineHolding(strippedSource(pin.file), pin.anchor);
      expect(line, `anchor not found in ${pin.file}: ${pin.anchor}`).not.toBeNull();
      expect(line as string).not.toMatch(PURCHASE_STEERING);
    });
  }

  it('the two item-limit strings still exist as reachable literals, not just as the anchor', () => {
    // Belt and braces for the template literal: the anchor above ends at the
    // closing backtick, so this proves the literal starts on the same line.
    const line = lineHolding(strippedSource('lib/item-limits.ts'), 'tokens to your monthly debit.`');
    expect(line).toMatch(/warn: `You're \$\{state\.overage\} item/);
  });
});
