import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_TYPEFACE_METADATA_KEY,
  MAX_FONT_BYTES,
  firmDocumentTypeface,
  normalizeDocumentTypeface,
  sniffFontFormat,
  fontRejectionReason,
  typefaceUploadRejection,
} from '../lib/document-typeface';

/** The first bytes of each format, which is all the sniffer looks at. */
function head(bytes: number[]): Uint8Array {
  return new Uint8Array([...bytes, 0x00, 0x00, 0x00, 0x00]);
}
const TRUETYPE = head([0x00, 0x01, 0x00, 0x00]);
const OPENTYPE_CFF = head([0x4f, 0x54, 0x54, 0x4f]); // OTTO
const TRUETYPE_APPLE = head([0x74, 0x72, 0x75, 0x65]); // true
const COLLECTION = head([0x74, 0x74, 0x63, 0x66]); // ttcf
const WOFF = head([0x77, 0x4f, 0x46, 0x46]); // wOFF
const WOFF2 = head([0x77, 0x4f, 0x46, 0x32]); // wOF2
const PNG = head([0x89, 0x50, 0x4e, 0x47]);

describe('sniffFontFormat: the bytes decide, not the Content-Type', () => {
  it('reads a TrueType file as embeddable', () => {
    expect(sniffFontFormat(TRUETYPE)).toBe('truetype');
  });

  it('reads an OpenType CFF file as embeddable', () => {
    expect(sniffFontFormat(OPENTYPE_CFF)).toBe('opentype');
  });

  it("reads Apple's 'true' variant as embeddable", () => {
    expect(sniffFontFormat(TRUETYPE_APPLE)).toBe('truetype');
  });

  it('reads a TrueType collection as embeddable', () => {
    expect(sniffFontFormat(COLLECTION)).toBe('collection');
  });

  it('names WOFF rather than lumping it in with the unknown', () => {
    expect(sniffFontFormat(WOFF)).toBe('woff');
  });

  it('names WOFF2 rather than lumping it in with the unknown', () => {
    expect(sniffFontFormat(WOFF2)).toBe('woff2');
  });

  it('reads a PNG as not a font at all', () => {
    expect(sniffFontFormat(PNG)).toBe(null);
  });

  it('reads a truncated file as not a font, rather than guessing', () => {
    expect(sniffFontFormat(new Uint8Array([0x00, 0x01]))).toBe(null);
  });
});

describe('fontRejectionReason: a refused font says why, loudly', () => {
  it('accepts the two formats fontkit can embed', () => {
    expect(fontRejectionReason(TRUETYPE)).toBe(null);
    expect(fontRejectionReason(OPENTYPE_CFF)).toBe(null);
  });

  it('tells a firm that uploaded a WOFF what a WOFF is and what to do', () => {
    const reason = fontRejectionReason(WOFF);
    expect(reason).toMatch(/WOFF/);
    expect(reason).toMatch(/TTF|OTF/);
  });

  it('names WOFF2 specifically, not just "WOFF"', () => {
    expect(fontRejectionReason(WOFF2)).toMatch(/WOFF2/);
  });

  it('refuses a file that is not a font at all', () => {
    expect(fontRejectionReason(PNG)).toMatch(/not a font|TTF|OTF/i);
  });

  it('refuses a TrueType collection, which fontkit cannot embed as one face', () => {
    expect(fontRejectionReason(COLLECTION)).toMatch(/collection/i);
  });
});

describe('normalizeDocumentTypeface: the trust boundary over shared metadata', () => {
  const VALID = {
    regularUrl: 'https://example.test/firm/regular.ttf',
    boldUrl: 'https://example.test/firm/bold.ttf',
    familyName: 'Gotham',
    licence: {
      acknowledgedAt: '2026-08-17T10:00:00.000Z',
      acknowledgedBy: '00000000-0000-0000-0000-000000000001',
      holder: 'Zinpro Corporation',
    },
  };

  it('returns null for a firm that has set no typeface', () => {
    expect(normalizeDocumentTypeface(undefined)).toBe(null);
    expect(normalizeDocumentTypeface(null)).toBe(null);
  });

  it('returns null for a foreign value parked under the key', () => {
    expect(normalizeDocumentTypeface('Gotham')).toBe(null);
    expect(normalizeDocumentTypeface(42)).toBe(null);
    expect(normalizeDocumentTypeface([])).toBe(null);
  });

  it('accepts a complete record', () => {
    const t = normalizeDocumentTypeface(VALID);
    expect(t?.regularUrl).toBe(VALID.regularUrl);
    expect(t?.boldUrl).toBe(VALID.boldUrl);
    expect(t?.familyName).toBe('Gotham');
    expect(t?.licence.holder).toBe('Zinpro Corporation');
  });

  it('refuses a record with no regular weight, because the body is most of the document', () => {
    expect(normalizeDocumentTypeface({ ...VALID, regularUrl: '' })).toBe(null);
    const { regularUrl: _drop, ...noRegular } = VALID;
    expect(normalizeDocumentTypeface(noRegular)).toBe(null);
  });

  it('treats a missing bold weight as absent rather than invalid', () => {
    const { boldUrl: _drop, ...noBold } = VALID;
    expect(normalizeDocumentTypeface(noBold)?.boldUrl).toBe(null);
  });

  it('refuses a record with no licence acknowledgement', () => {
    const { licence: _drop, ...noLicence } = VALID;
    expect(normalizeDocumentTypeface(noLicence)).toBe(null);
  });

  it('refuses a licence acknowledgement that names no holder', () => {
    expect(
      normalizeDocumentTypeface({ ...VALID, licence: { ...VALID.licence, holder: '   ' } }),
    ).toBe(null);
  });

  it('refuses a non-https url, so a font cannot be fetched off some other scheme', () => {
    expect(
      normalizeDocumentTypeface({ ...VALID, regularUrl: 'file:///etc/passwd' }),
    ).toBe(null);
  });

  it('drops a bold weight whose url is unusable without losing the regular one', () => {
    const t = normalizeDocumentTypeface({ ...VALID, boldUrl: 'javascript:alert(1)' });
    expect(t?.regularUrl).toBe(VALID.regularUrl);
    expect(t?.boldUrl).toBe(null);
  });
});

describe('firmDocumentTypeface: reading it out of the firm metadata bag', () => {
  const VALID = {
    regularUrl: 'https://example.test/firm/regular.ttf',
    boldUrl: null,
    familyName: 'Gotham',
    licence: {
      acknowledgedAt: '2026-08-17T10:00:00.000Z',
      acknowledgedBy: '00000000-0000-0000-0000-000000000001',
      holder: 'Zinpro Corporation',
    },
  };

  it('finds the typeface under its own key', () => {
    const metadata = { [DOCUMENT_TYPEFACE_METADATA_KEY]: VALID, hideAdvotticLogo: true };
    expect(firmDocumentTypeface(metadata)?.familyName).toBe('Gotham');
  });

  it('returns null for a firm whose metadata holds other features only', () => {
    expect(firmDocumentTypeface({ hideAdvotticLogo: true })).toBe(null);
  });

  it('returns null rather than throwing for a metadata column that is not an object', () => {
    expect(firmDocumentTypeface(null)).toBe(null);
    expect(firmDocumentTypeface('nonsense')).toBe(null);
  });
});

describe('typefaceUploadRejection: what the firm is refused, and why', () => {
  const OK = {
    bytes: TRUETYPE,
    licenceAcknowledged: true,
    licenceHolder: 'Zinpro Corporation',
  };

  it('accepts a licensed TrueType file', () => {
    expect(typefaceUploadRejection(OK)).toBe(null);
  });

  it('refuses a font the firm has not confirmed a licence for', () => {
    const reason = typefaceUploadRejection({ ...OK, licenceAcknowledged: false });
    expect(reason).toMatch(/licen/i);
  });

  it('refuses a licence confirmation that names nobody', () => {
    expect(typefaceUploadRejection({ ...OK, licenceHolder: '  ' })).toMatch(/licen/i);
  });

  it('refuses a WOFF even when the licence is confirmed', () => {
    // The licence answer must never buy a pass on the format, or a firm ends up
    // attesting to a file that was then silently dropped.
    expect(typefaceUploadRejection({ ...OK, bytes: WOFF })).toMatch(/WOFF/);
  });

  it('refuses a file over the size cap', () => {
    const huge = new Uint8Array(MAX_FONT_BYTES + 1);
    huge.set([0x00, 0x01, 0x00, 0x00]);
    expect(typefaceUploadRejection({ ...OK, bytes: huge })).toMatch(/MB|large/i);
  });

  it('refuses an empty file rather than storing zero bytes', () => {
    expect(typefaceUploadRejection({ ...OK, bytes: new Uint8Array() })).toBeTruthy();
  });

  it('states the format problem rather than the size when both are wrong', () => {
    // A firm that uploaded a 30 MB WOFF needs to hear about the WOFF: shrinking
    // it would not have helped.
    const huge = new Uint8Array(MAX_FONT_BYTES + 1);
    huge.set([0x77, 0x4f, 0x46, 0x46]);
    expect(typefaceUploadRejection({ ...OK, bytes: huge })).toMatch(/WOFF/);
  });
});
