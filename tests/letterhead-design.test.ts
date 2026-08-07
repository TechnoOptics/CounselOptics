import { describe, it, expect } from 'vitest';
import {
  LETTERHEAD_DESIGN_METADATA_KEY,
  LETTERHEAD_MAX_ADDRESS_LINES,
  LETTERHEAD_LINE_GAP_PT,
  letterheadDesignLines,
  letterheadDesignWordLines,
  firmLetterheadDesign,
  normalizeLetterheadDesign,
  parseLetterheadDesignReply,
  type LetterheadDesign,
} from '../lib/letterhead-design';

/**
 * The letterhead a firm designs in the app, rather than uploads as an image.
 *
 * Two things are being pinned here, and they are different in kind.
 *
 * normalizeLetterheadDesign is the TRUST BOUNDARY. The design lives in
 * firms.metadata, a jsonb column several other code paths already write keys
 * into, so what comes back out is untyped by construction: a wrong type, an
 * absent key or an extra key is a normal Tuesday, not a corrupted database.
 * Every read goes through this function, so the tests below feed it the shapes
 * a jsonb blob actually arrives in and not just the shape the designer writes.
 *
 * letterheadDesignLines is the LAYOUT, and the reason it exists is that the
 * on-screen preview and the PDF must not each decide the order for themselves.
 * The assertions therefore pin the ORDER and WHICH LINE IS BOLD, because a
 * count of lines would still pass if the firm name drifted to the bottom of
 * the block or stopped being the emphasized one.
 */

function design(over: Partial<LetterheadDesign> = {}): LetterheadDesign {
  return {
    firmName: 'Hartley and Vance LLP',
    addressLines: ['400 Market Street', 'Suite 1200', 'Philadelphia, PA 19106'],
    phone: '(215) 555 0148',
    email: 'filings@hartleyvance.com',
    website: 'hartleyvance.com',
    admissionsLine: 'Admitted in Pennsylvania and New Jersey',
    alignment: 'left',
    showRule: true,
    ...over,
  };
}

describe('normalizeLetterheadDesign: what is not a usable design', () => {
  it('rejects a design whose firm name is blank after trimming', () => {
    expect(normalizeLetterheadDesign({ firmName: '   ', phone: '555 0148' })).toBeNull();
  });

  it('rejects a design with no firm name key at all', () => {
    expect(normalizeLetterheadDesign({ addressLines: ['400 Market Street'] })).toBeNull();
  });

  it('rejects values that are not objects', () => {
    expect(normalizeLetterheadDesign(null)).toBeNull();
    expect(normalizeLetterheadDesign(undefined)).toBeNull();
    expect(normalizeLetterheadDesign('Hartley and Vance LLP')).toBeNull();
    expect(normalizeLetterheadDesign(42)).toBeNull();
    expect(normalizeLetterheadDesign(['Hartley and Vance LLP'])).toBeNull();
  });
});

describe('normalizeLetterheadDesign: a jsonb blob with the wrong types in it', () => {
  const raw = {
    firmName: '  Hartley and Vance LLP  ',
    addressLines: ['  400 Market Street  ', '', 42, null, 'Suite 1200', {}, 'Philadelphia, PA 19106', 'Attn: Filings', 'One line too many'],
    phone: 12155550148,
    email: '  filings@hartleyvance.com ',
    website: null,
    admissionsLine: { note: 'not a string' },
    alignment: 'diagonal',
    showRule: 'yes please',
    // Keys the designer never wrote. metadata is shared, so these are normal.
    hideAdvotticLogo: true,
    ticketPrefix: 'HV',
  };

  it('keeps the trimmed firm name and drops the foreign keys', () => {
    const out = normalizeLetterheadDesign(raw);
    expect(out).not.toBeNull();
    expect(out!.firmName).toBe('Hartley and Vance LLP');
    expect(Object.keys(out!).sort()).toEqual(
      [
        'addressLines',
        'admissionsLine',
        'alignment',
        'email',
        'firmName',
        'phone',
        'showRule',
        'website',
      ],
    );
  });

  it('keeps only the string address lines, trimmed, capped at four', () => {
    const out = normalizeLetterheadDesign(raw)!;
    expect(out.addressLines).toEqual([
      '400 Market Street',
      'Suite 1200',
      'Philadelphia, PA 19106',
      'Attn: Filings',
    ]);
    expect(out.addressLines.length).toBeLessThanOrEqual(LETTERHEAD_MAX_ADDRESS_LINES);
  });

  it('turns every non-string scalar field into an empty string rather than "42" or "null"', () => {
    const out = normalizeLetterheadDesign(raw)!;
    expect(out.phone).toBe('');
    expect(out.website).toBe('');
    expect(out.admissionsLine).toBe('');
    expect(out.email).toBe('filings@hartleyvance.com');
  });

  it('falls back to left for an alignment outside the union', () => {
    expect(normalizeLetterheadDesign(raw)!.alignment).toBe('left');
    expect(normalizeLetterheadDesign({ firmName: 'A', alignment: 'center' })!.alignment).toBe(
      'center',
    );
  });
});

describe('normalizeLetterheadDesign: the hairline rule', () => {
  it('defaults the rule to ON when the key is absent', () => {
    expect(normalizeLetterheadDesign({ firmName: 'Hartley and Vance LLP' })!.showRule).toBe(
      true,
    );
  });

  it('defaults the rule to ON when the stored value is not a boolean', () => {
    expect(
      normalizeLetterheadDesign({ firmName: 'Hartley and Vance LLP', showRule: 'no' })!
        .showRule,
    ).toBe(true);
  });

  it('honours an explicit false, so a firm that turned the rule off keeps it off', () => {
    expect(
      normalizeLetterheadDesign({ firmName: 'Hartley and Vance LLP', showRule: false })!
        .showRule,
    ).toBe(false);
  });
});

describe('normalizeLetterheadDesign: length caps', () => {
  it('caps the firm name rather than storing an unbounded string', () => {
    const out = normalizeLetterheadDesign({ firmName: 'H'.repeat(500) })!;
    expect(out.firmName.length).toBeLessThanOrEqual(120);
    expect(out.firmName.length).toBeGreaterThan(0);
  });

  it('caps each address line', () => {
    const out = normalizeLetterheadDesign({
      firmName: 'Hartley and Vance LLP',
      addressLines: ['x'.repeat(500)],
    })!;
    expect(out.addressLines[0].length).toBeLessThanOrEqual(120);
  });
});

describe('letterheadDesignLines: the order, and which line carries the emphasis', () => {
  it('puts the firm name first and makes it the only bold line', () => {
    const lines = letterheadDesignLines(design());
    expect(lines[0].text).toBe('Hartley and Vance LLP');
    expect(lines[0].bold).toBe(true);
    expect(lines.filter((l) => l.bold)).toHaveLength(1);
  });

  it('draws firm name, then the address in order, then contact, then admissions', () => {
    const lines = letterheadDesignLines(design());
    expect(lines.map((l) => l.text)).toEqual([
      'Hartley and Vance LLP',
      '400 Market Street',
      'Suite 1200',
      'Philadelphia, PA 19106',
      '(215) 555 0148  -  filings@hartleyvance.com  -  hartleyvance.com',
      'Admitted in Pennsylvania and New Jersey',
    ]);
  });

  it('sets the firm name larger than everything under it', () => {
    const lines = letterheadDesignLines(design());
    for (const line of lines.slice(1)) {
      expect(line.size).toBeLessThan(lines[0].size);
    }
  });

  it('emits no blank lines when only the firm name is filled in', () => {
    const lines = letterheadDesignLines(
      design({
        addressLines: [],
        phone: '',
        email: '',
        website: '',
        admissionsLine: '',
      }),
    );
    expect(lines.map((l) => l.text)).toEqual(['Hartley and Vance LLP']);
  });

  it('joins only the contact pieces that are present', () => {
    const lines = letterheadDesignLines(
      design({ addressLines: [], phone: '', admissionsLine: '' }),
    );
    expect(lines.map((l) => l.text)).toEqual([
      'Hartley and Vance LLP',
      'filings@hartleyvance.com  -  hartleyvance.com',
    ]);
  });
});

describe('parseLetterheadDesignReply: the model reply is untrusted text', () => {
  it('reads a bare JSON object', () => {
    const out = parseLetterheadDesignReply(
      '{"firmName":"Hartley and Vance LLP","phone":"(215) 555 0148"}',
    );
    expect(out?.firmName).toBe('Hartley and Vance LLP');
    expect(out?.phone).toBe('(215) 555 0148');
  });

  it('reads a JSON object the model wrapped in a fenced block and prose', () => {
    const out = parseLetterheadDesignReply(
      'Here is what I found:\n```json\n{"firmName":"Hartley and Vance LLP","addressLines":["400 Market Street"]}\n```\nLet me know.',
    );
    expect(out?.firmName).toBe('Hartley and Vance LLP');
    expect(out?.addressLines).toEqual(['400 Market Street']);
  });

  it('returns null for a reply with no JSON in it, rather than leaking the prose', () => {
    expect(
      parseLetterheadDesignReply('I could not find a letterhead in that document.'),
    ).toBeNull();
  });

  it('returns null for malformed JSON and for a JSON value that is not a design', () => {
    expect(parseLetterheadDesignReply('{"firmName": "Hartley and Vance LLP"')).toBeNull();
    expect(parseLetterheadDesignReply('{"firmName": ""}')).toBeNull();
    expect(parseLetterheadDesignReply('["Hartley and Vance LLP"]')).toBeNull();
  });

  it('returns null for anything that is not a string', () => {
    expect(parseLetterheadDesignReply(null)).toBeNull();
    expect(parseLetterheadDesignReply({ firmName: 'Hartley and Vance LLP' })).toBeNull();
  });
});

describe('the metadata key', () => {
  it('is the one both the actions and the renderer read', () => {
    expect(LETTERHEAD_DESIGN_METADATA_KEY).toBe('letterhead_design');
  });
});

describe('firmLetterheadDesign: reading the design out of the metadata bag', () => {
  it('finds a design stored under the metadata key', () => {
    const out = firmLetterheadDesign({
      hideAdvotticLogo: true,
      [LETTERHEAD_DESIGN_METADATA_KEY]: { firmName: 'Hartley and Vance LLP' },
    });
    expect(out?.firmName).toBe('Hartley and Vance LLP');
  });

  it('returns null for a firm that has no design, an absent bag, or junk in the key', () => {
    expect(firmLetterheadDesign({ hideAdvotticLogo: true })).toBeNull();
    expect(firmLetterheadDesign(null)).toBeNull();
    expect(firmLetterheadDesign(undefined)).toBeNull();
    expect(firmLetterheadDesign({ [LETTERHEAD_DESIGN_METADATA_KEY]: 'yes' })).toBeNull();
  });
});

describe('letterheadDesignWordLines: the same block, in the units Word measures in', () => {
  it('is the PDF list, in the same order and with the same emphasis', () => {
    const pdf = letterheadDesignLines(design());
    const word = letterheadDesignWordLines(design());
    expect(word.map((l) => l.text)).toEqual(pdf.map((l) => l.text));
    expect(word.map((l) => l.bold)).toEqual(pdf.map((l) => l.bold));
  });

  it('converts points to half-points, which is how Word sizes type', () => {
    const pdf = letterheadDesignLines(design());
    const word = letterheadDesignWordLines(design());
    for (let i = 0; i < pdf.length; i += 1) {
      expect(word[i].sizeHalfPoints).toBe(pdf[i].size * 2);
    }
  });

  it('spaces lines by the one gap the PDF and the preview also use', () => {
    for (const line of letterheadDesignWordLines(design())) {
      expect(line.spacingAfterTwips).toBe(LETTERHEAD_LINE_GAP_PT * 20);
    }
  });

  it('hangs the rule on the last line only, and only when the firm asked for one', () => {
    const withRule = letterheadDesignWordLines(design({ showRule: true }));
    expect(withRule.map((l) => l.rule)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    const withoutRule = letterheadDesignWordLines(design({ showRule: false }));
    expect(withoutRule.some((l) => l.rule)).toBe(false);
  });

  it('hangs the rule on the firm name when that is the only line', () => {
    const only = letterheadDesignWordLines(
      design({
        addressLines: [],
        phone: '',
        email: '',
        website: '',
        admissionsLine: '',
      }),
    );
    expect(only).toHaveLength(1);
    expect(only[0].rule).toBe(true);
  });
});

describe('normalizeLetterheadDesign: interior control and bidi characters', () => {
  /**
   * saveFirmLetterheadDesignAction is a `'use server'` export and therefore a
   * public HTTP endpoint, so what reaches the column is whatever a direct
   * caller sent, not whatever the designer's inputs allow. Trimming the ends
   * left the interior alone, and the interior is where the four surfaces stop
   * agreeing: the PDF draws each line with one drawText and a newline simply
   * vanishes, so "Hartley\nand Vance LLP" printed as "Hartleyand Vance LLP"
   * while both HTML previews showed "Hartley and Vance LLP".
   */
  it('collapses an interior newline to a space, so the PDF cannot fuse the words', () => {
    const out = normalizeLetterheadDesign({ firmName: 'Hartley\nand Vance LLP' })!;
    expect(out.firmName).toBe('Hartley and Vance LLP');
  });

  it('collapses tabs, carriage returns and runs of whitespace to one space', () => {
    const out = normalizeLetterheadDesign({
      firmName: 'Hartley\tand\r\nVance     LLP',
    })!;
    expect(out.firmName).toBe('Hartley and Vance LLP');
  });

  it('removes zero-width characters rather than turning them into spaces', () => {
    // A zero-width joiner between two letters is not a word break, so
    // replacing it with a space would invent one.
    const out = normalizeLetterheadDesign({
      firmName: 'Hart​ley and Vance﻿ LLP',
    })!;
    expect(out.firmName).toBe('Hartley and Vance LLP');
  });

  it('removes bidi overrides, which can reorder what a reader sees', () => {
    // U+202E flips the visual order of everything after it, so a stored name
    // can be made to read as something other than the characters it contains.
    const out = normalizeLetterheadDesign({
      firmName: 'Hartley ‮and Vance LLP‬',
    })!;
    expect(out.firmName).toBe('Hartley and Vance LLP');
    expect(out.firmName).not.toMatch(/[‪-‮⁦-⁩‎‏]/);
  });

  it('cleans every field, not only the firm name', () => {
    const out = normalizeLetterheadDesign({
      firmName: 'Hartley and Vance LLP',
      addressLines: ['400\nMarket Street'],
      phone: '(215)​555​0148',
      email: 'filings@‮hartleyvance.com',
      website: 'hartley\tvance.com',
      admissionsLine: 'Admitted in\nPennsylvania',
    })!;
    expect(out.addressLines).toEqual(['400 Market Street']);
    expect(out.phone).toBe('(215)5550148');
    expect(out.email).toBe('filings@hartleyvance.com');
    expect(out.website).toBe('hartley vance.com');
    expect(out.admissionsLine).toBe('Admitted in Pennsylvania');
  });

  it('rejects a firm name that was nothing but control characters', () => {
    expect(normalizeLetterheadDesign({ firmName: '\n\t​‮' })).toBeNull();
  });

  it('caps length after cleaning, so padding cannot push real text out', () => {
    const out = normalizeLetterheadDesign({
      firmName: `${' \n'.repeat(200)}Hartley and Vance LLP`,
    })!;
    expect(out.firmName).toBe('Hartley and Vance LLP');
  });
});
