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
        '"Consulting Agreement", with the same legal effect as a handwritten ' +
        'signature. I am acting on my own behalf or as authorized for the ' +
        'entity I represent.',
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
