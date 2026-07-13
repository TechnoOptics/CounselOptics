/**
 * Per-matter text normalization. A matter can carry a small list of
 * abbreviation / naming rules (cases.text_normalizations) that are applied to
 * every AI-generated surface (approach arguments, legal review, timeline
 * narrative) right before it is persisted. This keeps the shared AI engines
 * generic while letting a specific matter enforce, e.g., "always write STH, not
 * SH" for its subject, so a re-run can never reintroduce the wrong form.
 *
 * Rules are whole-token, case-sensitive replacements (word-boundary matched),
 * so a rule { from: "SH", to: "STH" } rewrites the standalone abbreviation but
 * never touches "Shakopee", "cash", or the already-correct "STH".
 */

export type NormRule = { from: string; to: string };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Coerce arbitrary jsonb into a clean rule list. */
export function toNormRules(raw: unknown): NormRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = r as Record<string, unknown>;
      const from = typeof o?.from === 'string' ? o.from.trim() : '';
      const to = typeof o?.to === 'string' ? o.to : '';
      return from && to ? { from, to } : null;
    })
    .filter((r): r is NormRule => r != null);
}

/** Apply the rules to a plain string. */
export function normalizeString(text: string, rules: NormRule[]): string {
  if (typeof text !== 'string' || !rules.length) return text;
  let out = text;
  for (const { from, to } of rules) {
    // Match the token on a word boundary, and also its dotted form (S.H.).
    const dotted = from.split('').map(escapeRegExp).join('\\.') + '\\.';
    out = out
      .replace(new RegExp(`\\b${dotted}(?=[\\s,.).:;'"\\]]|$)`, 'g'), to)
      .replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g'), to);
  }
  return out;
}

/**
 * Apply the rules to every string inside a JSON-serializable value (objects,
 * arrays, nested). Returns a new value; the input is not mutated.
 */
export function normalizeDeep<T>(value: T, rules: NormRule[]): T {
  if (!rules.length || value == null) return value;
  return JSON.parse(normalizeString(JSON.stringify(value), rules)) as T;
}
