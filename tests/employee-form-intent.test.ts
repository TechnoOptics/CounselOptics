import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  SIGNING_INTENT_PREFIX,
  signingIntentSentence,
  signingIntentSuffix,
} from '../lib/signing-intent';

/**
 * The employee filling a firm template and the outside party receiving one
 * affirm the same thing, so they must affirm it in the same words.
 *
 * This file guards the pair on this branch. The employee form carried its own
 * copy of the sentence until lib/signing-intent.ts existed, and the two copies
 * had already diverged in their typography (ASCII quotes on one surface, the
 * typographic pair on the other) while both claimed to be identical. That is
 * the drift a shared constant prevents, and a comment does not.
 *
 * Anchored to the imports and to the rendered expressions, never to the
 * sentence text: asserting the words inside each surface's test would be the
 * same duplication in a different file.
 */
describe('both intent checkboxes read lib/signing-intent', () => {
  const root = join(__dirname, '..');
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  const OUTSIDE_SIGNER = 'app/sign/[token]/signature-capture.tsx';
  const EMPLOYEE_FORM = 'app/portal/forms/[id]/form-fill-client.tsx';

  // Each surface, the expression it puts in the protected name element, and
  // the document name it passes to the suffix. They differ because the outside
  // signer is handed a document name and the employee is filling a named
  // template.
  const surfaces: [string, string, string][] = [
    [OUTSIDE_SIGNER, '{signerName || signerEmail}', 'documentName'],
    [
      EMPLOYEE_FORM,
      '{signature || employeeName || employeeEmail}',
      'template.name',
    ],
  ];

  for (const [rel, nameElement, documentName] of surfaces) {
    it(`has ${rel} import the pieces rather than keep the words`, () => {
      const src = read(rel);
      expect(src).toMatch(/from '@\/lib\/signing-intent'/);
      expect(src).toContain('{SIGNING_INTENT_PREFIX}');
      expect(src).toContain(`{signingIntentSuffix(${documentName})}`);
      // No local copy of any part of the sentence. A file that both imports
      // the module and spells the words out would pass every assertion above
      // while still being free to drift.
      expect(src).not.toMatch(/legal effect as a handwritten/);
      expect(src).not.toMatch(/intend that the mark above/);
      expect(src).not.toMatch(/on my own behalf or as authorized/);
    });

    it(`has ${rel} keep the signer's name out of machine translation`, () => {
      // The name sits between the two pieces, in its own element, on both
      // surfaces. Losing the marker on one of them would have the translation
      // layer rewrite a person's name inside the operative clause on that
      // surface only.
      expect(read(rel)).toContain(
        `<strong data-no-translate>${nameElement}</strong>`,
      );
    });
  }

  it('renders the same sentence the joined form produces', () => {
    // The surfaces render three pieces; anything that reads the record back
    // reads one string. They have to be the same string.
    expect(SIGNING_INTENT_PREFIX + 'Ada Lovelace' + signingIntentSuffix('Deed'))
      .toBe(signingIntentSentence('Ada Lovelace', 'Deed'));
  });
});
