import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DocumentWithMark } from '../components/DocumentWithMark';
import {
  counterpartyMarker,
  hasCounterpartyMarkers,
  splitAtCounterpartyMarkers,
} from '../lib/template-field-boxes';

/**
 * The preview shows what the recipient will see.
 *
 * DocumentWithMark's own header says a preview that disagrees with the
 * delivered PDF is the exact defect the arrangement exists to prevent, and
 * once the renderer stopped drawing the marker literal that sentence stopped
 * being true: the employee filling the form and the attorney approving it read
 * `_____<<entity_name>>_____` while the recipient received a clean ruled
 * blank. Both surfaces pass through this one component, so the fix is here and
 * they cannot drift apart again.
 *
 * The dangerous half is the attorney's. They may rewrite the wording in
 * ReviewActions, and a literal with no counterpart in anything they can see
 * reads as leftover junk. Deleting it is silent and irreversible in effect:
 * the next render records no field_boxes for that key, loadCounterpartyIntake
 * returns null, the counterparty is never asked for the value, and the
 * instrument goes out with it absent and no blank where it belonged.
 *
 * The component is a plain function returning an element tree, so it is CALLED
 * here rather than grepped. The textarea is the one place the literal must
 * still be visible, because it is what the reviewer must not delete, so that
 * surface is held to saying so instead.
 */

/** Every string in a returned element tree, in order. */
function textOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
  } else if (Array.isArray(node)) {
    for (const child of node) textOf(child, out);
  } else if (node && typeof node === 'object') {
    const el = node as { props?: { children?: unknown } };
    if (el.props && typeof el.props === 'object') textOf(el.props.children, out);
  }
  return out;
}

/** Every element in the tree, so a blank can be found by what it is. */
function elements(node: unknown, out: Array<Record<string, unknown>> = []) {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
  } else if (node && typeof node === 'object') {
    const el = node as { props?: Record<string, unknown> };
    if (el.props) {
      out.push(el.props);
      elements(el.props.children, out);
    }
  }
  return out;
}

const DOC = [
  'This agreement is made with',
  `Entity: ${counterpartyMarker('entity_name')}`,
  'Signed: Jane Doe',
].join('\n');

describe('splitAtCounterpartyMarkers', () => {
  it('splits a line into the words around each blank', () => {
    expect(splitAtCounterpartyMarkers(`A ${counterpartyMarker('x')} B`)).toEqual([
      { kind: 'text', text: 'A ' },
      { kind: 'blank', key: 'x' },
      { kind: 'text', text: ' B' },
    ]);
  });

  it('finds every blank, including a key used twice', () => {
    const text = `${counterpartyMarker('x')} and ${counterpartyMarker('x')}`;
    expect(splitAtCounterpartyMarkers(text).filter((s) => s.kind === 'blank')).toHaveLength(2);
  });

  it('returns a document with no blanks as one piece', () => {
    // Every document this product has produced so far. Their preview must not
    // move by a character.
    expect(splitAtCounterpartyMarkers('Plain words.')).toEqual([
      { kind: 'text', text: 'Plain words.' },
    ]);
    expect(splitAtCounterpartyMarkers('')).toEqual([]);
  });
});

describe('hasCounterpartyMarkers', () => {
  it('is true only for text carrying a real blank', () => {
    expect(hasCounterpartyMarkers(DOC)).toBe(true);
    expect(hasCounterpartyMarkers('Signed: Jane Doe')).toBe(false);
    // Angle brackets and underscores are not a blank. The sentinel is.
    expect(hasCounterpartyMarkers('a <<b>> c ___ d')).toBe(false);
  });
});

describe('DocumentWithMark', () => {
  for (const [name, markSrc] of [
    ['without a mark', null],
    ['with a mark', 'data:image/png;base64,aGk='],
  ] as Array<[string, string | null]>) {
    it(`never shows the sentinel ${name}`, () => {
      const tree = DocumentWithMark({ text: DOC, markSrc });
      const shown = textOf(tree).join('');
      expect(shown).not.toContain('<<');
      expect(shown).not.toContain('entity_name');
      expect(shown).not.toContain('_____');
      // The words around it are untouched.
      expect(shown).toContain('Entity: ');
      expect(shown).toContain('Signed: Jane Doe');
    });

    it(`draws the blank as a rule ${name}`, () => {
      const tree = DocumentWithMark({ text: DOC, markSrc });
      const blanks = elements(tree).filter((p) =>
        String(p.className ?? '').includes('border-b'),
      );
      expect(blanks).toHaveLength(1);
      // Named for the reviewer without putting the key in the document body,
      // so two blanks on one page can be told apart on hover.
      expect(blanks[0].title).toContain('entity_name');
    });
  }

  it('leaves a document with no blanks exactly as it was', () => {
    const plain = 'Signed: Jane Doe\nDate: August 6, 2026';
    expect(textOf(DocumentWithMark({ text: plain, markSrc: null })).join('')).toBe(plain);
  });

  it('still puts the mark above the signature block', () => {
    // The property this component already had. Splitting the text into
    // segments must not lose it.
    const tree = DocumentWithMark({ text: DOC, markSrc: 'data:image/png;base64,aGk=' });
    expect(elements(tree).some((p) => p.alt === 'Signature')).toBe(true);
  });
});

describe('the reviewer editing the wording', () => {
  const src = readFileSync(
    join(__dirname, '..', 'app/counsel/forms/approvals/[id]/review-actions.tsx'),
    'utf8',
  );
  const flat = src.replace(/\s+/g, ' ');

  it('keeps the literal in the textarea, because it is what must not be lost', () => {
    // Converting it here would be the opposite failure: the reviewer would
    // save the converted text and the blank would be gone for real.
    expect(src).toContain('value={draft}');
    expect(src).not.toContain('splitAtCounterpartyMarkers');
  });

  it('says what the literal is and what deleting it does', () => {
    expect(src).toContain('hasCounterpartyMarkers(draft)');
    expect(flat).toContain('the recipient will not be asked for it');
  });
});
