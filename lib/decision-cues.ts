/**
 * Detects "this is the moment to call a lawyer" cues in free-form
 * user text (case description, hearing notes, witness statement,
 * Bella user messages).
 *
 * Distinct from lib/safety.ts - that one is for *physical danger*.
 * This one is for *legal-decision moments*: settlement language,
 * plea offers, statute-of-limitations risk, the other side
 * lawyering up. The advice is always the same: take a beat, talk
 * to a licensed attorney before signing or speaking on the record.
 *
 * Like safety detection, patterns lean toward false positives -
 * the callout is dismissible and explicitly tells the user they
 * can ignore if it doesn't apply.
 */

export type DecisionCueCategory =
  | 'settlement'
  | 'plea'
  | 'sol_risk'
  | 'opposing_counsel'
  | 'sign_release'
  | 'criminal_jail';

export type DecisionCueHit = {
  category: DecisionCueCategory;
  matched: string;
};

const PATTERNS: Record<DecisionCueCategory, RegExp[]> = {
  settlement: [
    /\b(settle(?:ment|d|ing)?\s*(?:offer|amount|agreement|talks)?|offer(?:ed|ing)?\s*(?:me\s*)?\$?\d|release\s*of\s*claims|sign(?:ing)?\s*(?:a\s*)?(?:waiver|release|nda)|consent\s*decree)\b/i,
    /\b(walk\s*away\s*money|drop\s*the\s*case\s*for|in\s*exchange\s*for)\b/i,
  ],
  plea: [
    /\b(plea(?:\s*deal|\s*offer|\s*bargain|d|s)?|deferred\s*(?:adjudication|prosecution)|nolo\s*contendere|no\s*contest|pretrial\s*diversion)\b/i,
    /\b(prosecutor\s*(?:is\s*)?offer(?:ed|ing)|district\s*attorney\s*offered|d\.?a\.?\s*offered)\b/i,
  ],
  sol_risk: [
    /\b(statute\s*of\s*limitations|time[-\s]barred|deadline\s*to\s*file|limitations\s*period|years?\s*ago)\b/i,
    /\b(it\s*happened\s*\d+\s*years?\s*ago|been\s*\d+\s*years?\s*since)\b/i,
  ],
  opposing_counsel: [
    /\b(their\s*(?:lawyer|attorney|counsel)\s*(?:is|sent|filed|wrote|called|emailed|contacted)|opposing\s*counsel|lawyer(?:s|'s)?\s*letter|cease\s*and\s*desist|demand\s*letter)\b/i,
    /\b(retained\s*(?:a|an)\s*(?:lawyer|attorney)|hired\s*(?:a|an)\s*(?:lawyer|attorney))\b/i,
  ],
  sign_release: [
    /\b(arbitration\s*(?:clause|agreement)|jury\s*(?:trial\s*)?waiver|class\s*action\s*waiver|forum\s*selection|non[-\s]disclosure|non[-\s]compete|nda\b)\b/i,
    /\b(separation\s*agreement|severance\s*(?:offer|agreement)|hold\s*harmless)\b/i,
  ],
  criminal_jail: [
    /\b(arrest(?:ed)?|booked|charged\s*with|arraignment|bail|bond\s*hearing|jail|prison|incarcerat(?:ed|ion)|felony|misdemeanor|warrant|probation\s*violation|parole)\b/i,
  ],
};

export function detectDecisionCues(text: string | null | undefined): DecisionCueHit[] {
  if (!text) return [];
  const hits: DecisionCueHit[] = [];
  (Object.keys(PATTERNS) as DecisionCueCategory[]).forEach((cat) => {
    for (const re of PATTERNS[cat]) {
      const m = text.match(re);
      if (m) {
        hits.push({ category: cat, matched: m[0] });
        break;
      }
    }
  });
  return hits;
}

export function hasDecisionCue(text: string | null | undefined): boolean {
  return detectDecisionCues(text).length > 0;
}

/**
 * Human-readable label and one-line context for each category.
 * Surfaced inside CallALawyerCallout so the user understands which
 * trigger fired without us having to be vague about it.
 */
export const DECISION_LABELS: Record<DecisionCueCategory, { title: string; body: string }> = {
  settlement: {
    title: 'Settlement language detected',
    body: 'Signing a settlement or release usually ends the matter forever. Have a lawyer review the exact terms before you sign or verbally agree.',
  },
  plea: {
    title: 'Plea offer language detected',
    body: 'A plea bargain is a permanent decision with consequences for housing, employment, immigration, and more. Talk to a public defender or licensed attorney first.',
  },
  sol_risk: {
    title: 'Statute-of-limitations clock may be running',
    body: 'Civil claims can be barred after as little as a few months in some jurisdictions. A short consult can confirm whether you still have time to file.',
  },
  opposing_counsel: {
    title: 'The other side has a lawyer',
    body: 'Once opposing counsel is involved, an unrepresented party is at a structural disadvantage. Even a one-hour consult evens the playing field.',
  },
  sign_release: {
    title: "You're being asked to sign",
    body: 'Releases, NDAs, arbitration clauses, and severance agreements waive rights you may not get back. Have a lawyer skim it before you sign.',
  },
  criminal_jail: {
    title: 'Criminal matter where jail is possible',
    body: 'You have a constitutional right to a public defender at no cost. Request one at your first court appearance.',
  },
};
