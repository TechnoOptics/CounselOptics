import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  SIGNING_INTENT_PREFIX,
  signingIntentSentence,
  signingIntentSuffix,
} from '../lib/signing-intent';

/**
 * The laptop and the phone must assert intent in one form of words.
 * These tests are the guard on that: the first pins the sentence
 * literally, so a reword on either surface has to come through this
 * file, and the second pins the seam the phone renders around the
 * signer's name to the same string the joined form uses.
 */
describe('signingIntentSentence', () => {
  it('is the UETA sentence, word for word', () => {
    expect(signingIntentSentence('Ada Lovelace', 'Consulting Agreement')).toBe(
      'I, Ada Lovelace, intend that the mark above be my signature on ' +
        '“Consulting Agreement”, with the same legal effect as a ' +
        'handwritten signature. I am acting on my own behalf or as ' +
        'authorized for the entity I represent.',
    );
  });

  it('names the signer and the document, not a placeholder', () => {
    const s = signingIntentSentence('Grace Hopper', 'Mutual NDA');
    expect(s).toContain('Grace Hopper');
    expect(s).toContain('Mutual NDA');
  });

  it('composes from the pieces the phone renders, so they cannot drift', () => {
    // The phone cannot use the joined string: it has to put the
    // signer's name in its own element so the translation layer leaves
    // a person's name alone inside the operative clause. That means two
    // renderings of one sentence, which is exactly the drift this
    // module exists to prevent, so they are asserted equal here.
    const rendered =
      SIGNING_INTENT_PREFIX + 'Ada Lovelace' + signingIntentSuffix('Deed');
    expect(rendered).toBe(signingIntentSentence('Ada Lovelace', 'Deed'));
  });

  it('opens with the first person, since the signer is the speaker', () => {
    expect(SIGNING_INTENT_PREFIX).toBe('I, ');
  });
});

/**
 * The tests above pin what the module says. These pin who says it.
 *
 * A shared constant that only one of two surfaces imports is not a
 * shared constant, it is a copy with a comment on it. Both intent
 * checkboxes are asserted here, in one place, because the property is
 * about the pair: neither may hold the words, and both must render the
 * same two pieces around the same protected name element.
 *
 * Anchored to the import and to the rendered expressions, never to the
 * sentence text, since asserting the text in each file is the very
 * duplication this is meant to forbid.
 */
describe('both intent checkboxes read this module', () => {
  const root = join(__dirname, '..');
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  const LAPTOP = 'app/sign/[token]/signature-capture.tsx';
  const PHONE = 'app/sign/m/[handoff]/mobile-pad.tsx';

  // Each surface, and the expression it puts in the protected name
  // element. The two differ because the laptop already holds the
  // signer's email as a fallback and the phone is handed one label.
  const surfaces: [string, string][] = [
    [LAPTOP, '{signerName || signerEmail}'],
    [PHONE, '{signerLabel}'],
  ];

  for (const [rel, nameElement] of surfaces) {
    it(`has ${rel} import the pieces rather than keep the words`, () => {
      const src = read(rel);
      expect(src).toMatch(/from '@\/lib\/signing-intent'/);
      expect(src).toMatch(/\{SIGNING_INTENT_PREFIX\}/);
      expect(src).toMatch(/\{signingIntentSuffix\(documentName\)\}/);
      // No local copy of any part of the sentence. A file that both
      // imports the module and spells the words out would pass every
      // assertion above while still being free to drift.
      expect(src).not.toMatch(/legal effect as a handwritten/);
      expect(src).not.toMatch(/intend that the mark above/);
      expect(src).not.toMatch(/on my own behalf or as authorized/);
    });

    it(`has ${rel} keep the signer's name out of machine translation`, () => {
      // The name sits between the two pieces, in its own element, on
      // both devices. Losing the marker on one of them would have the
      // translation layer rewrite a person's name inside the operative
      // clause on that device only.
      expect(read(rel)).toContain(
        `<strong data-no-translate>${nameElement}</strong>`,
      );
    });
  }
});
