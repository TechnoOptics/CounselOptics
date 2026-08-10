/**
 * What the counsel request detail says ABOUT a request, as opposed to what
 * the request says.
 *
 * Both readings here come out of `firm_matter_intakes.intake_answers`, a
 * schema-less JSON column, which is why they are functions rather than
 * expressions inlined in the page: in that column an absent key, an empty
 * string and a date nobody could parse all arrive looking similar, and the
 * page has three places that must agree about which of them means "there is
 * no deadline".
 */

/** Where a request came from. */
export type IntakeChannel = 'partner' | 'portal' | 'firm';

/**
 * The channel, read from the markers the three creation paths leave.
 *
 * `partner` is written by lib/partner-tickets.ts, `submitted_by` by the
 * employee portal. A request with neither was opened by the firm itself in
 * its own workspace, which is a fact rather than a fallback.
 */
export function intakeChannel(
  answers: Record<string, unknown> | null | undefined,
): IntakeChannel {
  const a = answers ?? {};
  const partner = a.partner;
  if (partner && typeof partner === 'object') return 'partner';
  if (String(a.submitted_by ?? '').trim()) return 'portal';
  return 'firm';
}

export type IntakeDeadline = {
  /** Which date this is, because the two are not the same promise. */
  kind: 'due' | 'reminder';
  /** Epoch milliseconds. */
  at: number;
  /** True once the date is behind us. */
  breached: boolean;
};

/**
 * The one date the action bar states.
 *
 * The due date wins over the reminder because it is what the requester was
 * told, and the reminder is only what the team set for itself. An
 * unparseable value returns null rather than a date at epoch zero: `due_by`
 * is free text an employee typed, so "end of the month" is a normal thing
 * to find in it and is not a deadline this screen can count down to.
 */
export function intakeDeadline(
  answers: Record<string, unknown> | null | undefined,
  now: number,
): IntakeDeadline | null {
  const a = answers ?? {};
  for (const [kind, key] of [
    ['due', 'due_by'],
    ['reminder', 'reminder_at'],
  ] as const) {
    const raw = String(a[key] ?? '').trim();
    if (!raw) continue;
    const at = Date.parse(raw);
    if (Number.isNaN(at)) continue;
    return { kind, at, breached: at < now };
  }
  return null;
}
