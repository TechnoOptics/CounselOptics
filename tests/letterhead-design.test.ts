import { describe, it, expect } from 'vitest';
import {
  LETTERHEAD_DESIGN_METADATA_KEY,
  LETTERHEAD_MAX_ADDRESS_LINES,
  letterheadDesignLines,
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
