/**
 * Letter composition (#13). Shared, dependency-free logic for turning
 * a generated letter body plus the firm's include-toggles into a
 * normalized closing block. Both the PDF export (which renders text
 * lines) and the Word export (which renders structured paragraphs)
 * consume the SAME closing lines, so the two formats never drift.
 *
 * The toggles mirror the feature request exactly: name, date,
 * signature, witness, signing line, title.
 */

export type LetterOptions = {
  includeName: boolean;
  includeTitle: boolean;
  includeDate: boolean;
  includeSignature: boolean;
  includeSigningLine: boolean;
  includeWitness: boolean;
};

export const DEFAULT_LETTER_OPTIONS: LetterOptions = {
  includeName: true,
  includeTitle: true,
  includeDate: true,
  includeSignature: true,
  includeSigningLine: true,
  includeWitness: false,
};

export function sanitizeLetterOptions(input: unknown): LetterOptions {
  const o = (input ?? {}) as Record<string, unknown>;
  const bool = (k: keyof LetterOptions, dflt: boolean) =>
    typeof o[k] === 'boolean' ? (o[k] as boolean) : dflt;
  return {
    includeName: bool('includeName', DEFAULT_LETTER_OPTIONS.includeName),
    includeTitle: bool('includeTitle', DEFAULT_LETTER_OPTIONS.includeTitle),
    includeDate: bool('includeDate', DEFAULT_LETTER_OPTIONS.includeDate),
    includeSignature: bool(
      'includeSignature',
      DEFAULT_LETTER_OPTIONS.includeSignature,
    ),
    includeSigningLine: bool(
      'includeSigningLine',
      DEFAULT_LETTER_OPTIONS.includeSigningLine,
    ),
    includeWitness: bool('includeWitness', DEFAULT_LETTER_OPTIONS.includeWitness),
  };
}

export type LetterCloser = {
  signerName?: string | null;
  signerTitle?: string | null;
  /** Human date string already formatted for display, e.g. "July 3, 2026". */
  dateText?: string | null;
};

/** A single line of the closing block, tagged so renderers can style it. */
export type ClosingLine =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'rule' } // a signing line (underscored rule)
  | { kind: 'blank' };

const SIGNING_RULE = '_________________________________';

/**
 * Build the closing block from the toggles. Order is deliberate:
 * "Sincerely," -> signature space / signing line -> name -> title ->
 * date -> witness line. Only the enabled pieces appear.
 */
export function buildClosingLines(
  options: LetterOptions,
  closer: LetterCloser,
): ClosingLine[] {
  const lines: ClosingLine[] = [];
  lines.push({ kind: 'text', text: 'Sincerely,' });
  lines.push({ kind: 'blank' });

  if (options.includeSignature) {
    // Space for a handwritten / e-signature above the signing line.
    lines.push({ kind: 'blank' });
    lines.push({ kind: 'blank' });
  }
  if (options.includeSigningLine) {
    lines.push({ kind: 'rule' });
  }
  if (options.includeName) {
    lines.push({
      kind: 'strong',
      text: (closer.signerName || '').trim() || 'Name: ______________________',
    });
  }
  if (options.includeTitle) {
    lines.push({
      kind: 'text',
      text: (closer.signerTitle || '').trim() || 'Title: ______________________',
    });
  }
  if (options.includeDate) {
    lines.push({
      kind: 'text',
      text: `Date: ${(closer.dateText || '').trim() || '______________________'}`,
    });
  }
  if (options.includeWitness) {
    lines.push({ kind: 'blank' });
    lines.push({ kind: 'text', text: 'Witness:' });
    lines.push({ kind: 'rule' });
    lines.push({ kind: 'text', text: 'Witness name: ______________________' });
    lines.push({ kind: 'text', text: 'Date: ______________________' });
  }
  return lines;
}

/** Flatten closing lines to plain text (for the text-based PDF route). */
export function closingLinesToText(lines: ClosingLine[]): string {
  return lines
    .map((l) => {
      if (l.kind === 'blank') return '';
      if (l.kind === 'rule') return SIGNING_RULE;
      return l.text;
    })
    .join('\n');
}

/**
 * Compose the full letter text (body + closing) as a single string,
 * suitable for the existing text-based PDF renderer. The Word export
 * consumes the structured pieces instead.
 */
export function composeLetterText(
  body: string,
  options: LetterOptions,
  closer: LetterCloser,
): string {
  const closing = closingLinesToText(buildClosingLines(options, closer));
  return `${body.trim()}\n\n\n${closing}\n\n\n${LETTER_DRAFT_NOTICE}`;
}

/**
 * A short, travels-with-the-file caveat appended to every exported
 * letter (PDF + Word). The on-screen studio already warns "an attorney
 * should review", but once the file leaves the app that context is
 * gone - the artifact needs to carry its own notice. (Audit Content M3.)
 */
export const LETTER_DRAFT_NOTICE =
  'Draft prepared with Advottic. Review by a licensed attorney is recommended before this letter is sent or filed.';

export { SIGNING_RULE };
