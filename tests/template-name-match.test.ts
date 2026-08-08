import { describe, expect, it } from 'vitest';
import {
  findTemplateNameClash,
  templateNameKey,
} from '../lib/template-name-match';

/**
 * One hyphen let a firm end up with two NDAs.
 *
 * installSeedTemplateAction refused a duplicate by comparing trimmed lowercase
 * names exactly, so "Mutual Nondisclosure Agreement" and "Mutual
 * Non-Disclosure Agreement" were different templates as far as it was
 * concerned. A firm now has both, side by side, and an employee picking a form
 * gets whichever they happen to click, only one of which carries the legal
 * team's later edits.
 */

describe('templateNameKey', () => {
  it('gives one hyphen away from another name the same key', () => {
    expect(templateNameKey('Mutual Non-Disclosure Agreement')).toBe(
      templateNameKey('Mutual Nondisclosure Agreement'),
    );
  });

  it('ignores case, spacing and surrounding whitespace', () => {
    expect(templateNameKey('  MUTUAL   NDA  ')).toBe(templateNameKey('Mutual NDA'));
  });

  it('ignores the punctuation a legal team varies without meaning to', () => {
    const key = templateNameKey('Mutual Nondisclosure Agreement');
    expect(templateNameKey('Mutual Nondisclosure Agreement.')).toBe(key);
    expect(templateNameKey('Mutual "Nondisclosure" Agreement')).toBe(key);
    expect(templateNameKey('Mutual Non‑Disclosure Agreement')).toBe(key);
  });

  it('keeps two genuinely different names apart', () => {
    expect(templateNameKey('Mutual NDA')).not.toBe(templateNameKey('One-Way NDA'));
  });

  it('is empty for anything that is not a name', () => {
    expect(templateNameKey('')).toBe('');
    expect(templateNameKey('   ')).toBe('');
    expect(templateNameKey(null as unknown as string)).toBe('');
  });
});

describe('findTemplateNameClash', () => {
  const existing = ['Mutual Nondisclosure Agreement', 'Vendor Onboarding Form'];

  it('finds nothing for a name that is nothing like the others', () => {
    expect(findTemplateNameClash('Employee Handbook Acknowledgement', existing)).toBeNull();
  });

  it('calls a punctuation-only difference the same template', () => {
    const clash = findTemplateNameClash('Mutual Non-Disclosure Agreement', existing);
    expect(clash).toEqual({ kind: 'same', name: 'Mutual Nondisclosure Agreement' });
  });

  it('calls an exact repeat the same template', () => {
    expect(findTemplateNameClash('Mutual Nondisclosure Agreement', existing)?.kind).toBe('same');
  });

  it('warns about a name that merely contains an existing one', () => {
    // Not the same document: a short-form NDA is a real second template. But a
    // firm that ends up with both by accident should be told at the moment it
    // happens rather than find out from an employee.
    expect(findTemplateNameClash('Mutual Nondisclosure Agreement Short Form', existing)).toEqual({
      kind: 'near',
      name: 'Mutual Nondisclosure Agreement',
    });
  });

  it('warns about a typo of an existing name', () => {
    expect(findTemplateNameClash('Vendor Onbaording Form', existing)?.kind).toBe('near');
  });

  it('does not call two short unrelated names near-identical', () => {
    // A two-character edit distance is a typo in a long name and a different
    // document in a short one, so the tolerance scales with the name.
    expect(findTemplateNameClash('NDA', ['ND'])).toBeNull();
  });

  it('ignores an archived template, which is not in anybody’s way', () => {
    expect(findTemplateNameClash('Mutual Nondisclosure Agreement', [])).toBeNull();
  });

  it('reports the first clash rather than guessing between two', () => {
    const clash = findTemplateNameClash('Mutual Nondisclosure Agreement', [
      'Mutual Non-Disclosure Agreement',
      'Mutual Nondisclosure Agreement',
    ]);
    expect(clash).toEqual({ kind: 'same', name: 'Mutual Non-Disclosure Agreement' });
  });

  it('prefers the exact clash over a merely near one, whatever the order', () => {
    // Otherwise a firm gets a warning it can click past for a name that should
    // have been refused outright.
    const clash = findTemplateNameClash('Mutual Nondisclosure Agreement', [
      'Mutual Nondisclosure Agreement Short Form',
      'Mutual Non-Disclosure Agreement',
    ]);
    expect(clash?.kind).toBe('same');
  });

  it('survives a list with rubbish in it', () => {
    expect(
      findTemplateNameClash('Mutual NDA', [null, 7, '', 'Mutual NDA'] as unknown as string[])?.kind,
    ).toBe('same');
  });
});
