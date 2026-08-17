/**
 * Fitting a firm's written policies into one prompt, and saying what fitted.
 *
 * THE DEFECT THIS REPLACES. checkAgainstPoliciesAction walked the policies in
 * name order and called `break` on the first one that would overflow the cap.
 * `break`, not `continue`: one long policy early in the alphabet silently
 * excluded every policy after it, and the checker still returned a confidence
 * score as though it had read the lot. A check that measured against two of
 * three policies while reading as complete is worse than one that measured
 * against none.
 *
 * Two changes fix that. The cap is shared FAIRLY rather than first-come, so no
 * policy is dropped merely for sorting late behind a long one. And whatever
 * had to be cut or left out is NAMED, so a caller can tell the reader what the
 * answer was actually measured against instead of implying it was everything.
 *
 * This is a plain module and not part of lib/firm-policies.ts because that file
 * is `'use server'`, where every export must be an async server action.
 */

export type PolicySource = { name: string; content: string };

export type PolicyCorpus = {
  /** The prompt fragment. Empty when there are no policies. */
  corpus: string;
  /** Policies present in full, in the firm's own order. */
  included: string[];
  /** Policies present but cut to fit. */
  truncated: string[];
  /** Policies with no room at all. */
  omitted: string[];
};

const header = (name: string) => `\n\n### POLICY: ${name}\n`;

/**
 * Share `maxChars` across the policies so every one of them gets a turn.
 *
 * The allocation is max-min fair: taking the shortest policies first, each is
 * offered an equal share of what is left, and anything it does not need is
 * released to the ones still waiting. A firm whose policies all fit therefore
 * sees them all in full, and a firm with one enormous policy sees that one cut
 * rather than seeing its other policies disappear.
 */
export function buildPolicyCorpus(
  policies: readonly PolicySource[],
  maxChars: number,
): PolicyCorpus {
  if (policies.length === 0 || maxChars <= 0) {
    return { corpus: '', included: [], truncated: [], omitted: [] };
  }

  // Shortest first, so the slack they release funds the longer ones.
  const order = policies
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.content.length - b.p.content.length);

  const kept = new Map<number, { text: string; cut: boolean }>();
  let remaining = maxChars;
  let waiting = order.length;

  for (const { p, i } of order) {
    const share = Math.floor(remaining / waiting);
    waiting -= 1;
    const head = header(p.name);
    const whole = head.length + p.content.length;

    if (whole <= share) {
      kept.set(i, { text: head + p.content, cut: false });
      remaining -= whole;
      continue;
    }

    const room = share - head.length;
    if (room <= 0) {
      // No room even to name it. Recorded as omitted by its absence here.
      continue;
    }
    kept.set(i, { text: head + p.content.slice(0, room), cut: true });
    remaining -= head.length + room;
  }

  const included: string[] = [];
  const truncated: string[] = [];
  const omitted: string[] = [];
  let corpus = '';

  // Rebuilt in the firm's own order, so the reported list reads in the same
  // order as the prompt the model saw.
  policies.forEach((p, i) => {
    const entry = kept.get(i);
    if (!entry) {
      omitted.push(p.name);
      return;
    }
    corpus += entry.text;
    (entry.cut ? truncated : included).push(p.name);
  });

  return { corpus, included, truncated, omitted };
}

/**
 * One line naming what an answer was measured against.
 *
 * Server-authored on purpose. Asking the model to report its own sources
 * invites it to report the ones it wishes it had.
 */
export function policyProvenanceLine(c: PolicyCorpus): string {
  if (c.included.length === 0 && c.truncated.length === 0) {
    return 'No company policies were available, so nothing was measured against them.';
  }
  const parts = [...c.included, ...c.truncated.map((n) => `${n} (shortened to fit)`)];
  const tail =
    c.omitted.length > 0
      ? ` Not included: ${c.omitted.join(', ')}.`
      : '';
  return `Measured against: ${parts.join(', ')}.${tail}`;
}
