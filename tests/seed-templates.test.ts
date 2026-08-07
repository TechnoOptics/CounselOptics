import { describe, it, expect } from 'vitest';
import {
  SEED_TEMPLATES,
  ZINPRO_MUTUAL_NDA,
  findSeedTemplate,
  placeholdersIn,
} from '../lib/seed-templates';
import { cleanLegalText } from '../lib/legal-templates';
import {
  mergeTemplateDocument,
  findSignatureBlockLine,
} from '../lib/firm-template-placeholders';
import { counterpartyMarker } from '../lib/template-field-boxes';

/**
 * These are not shape tests. Every assertion below corresponds to a way a
 * standard template can produce a WRONG EXECUTED INSTRUMENT rather than a
 * failed render: a blank the other side never got to fill, a literal
 * `{{key}}` printed on a signed agreement, an operative clause quietly
 * rewritten by the text cleaner on its way to the page, or two places to sign
 * where only one is stamped.
 */
describe('standard templates: the placeholder contract', () => {
  for (const tpl of SEED_TEMPLATES) {
    describe(tpl.slug, () => {
      it('declares a field for every placeholder in the body', () => {
        const declared = new Set(tpl.fields.map((f) => f.key));
        const missing = placeholdersIn(tpl.body).filter((k) => !declared.has(k));
        // A placeholder with no field is never substituted, so the literal
        // {{key}} is printed on the document the other side signs.
        expect(missing).toEqual([]);
      });

      it('places every declared field somewhere in the body', () => {
        const used = new Set(placeholdersIn(tpl.body));
        const orphans = tpl.fields.map((f) => f.key).filter((k) => !used.has(k));
        // A field with no placeholder renders an input that changes nothing.
        expect(orphans).toEqual([]);
      });

      it('uses only keys sanitizeFields can produce', () => {
        for (const f of tpl.fields) {
          expect(f.key).toMatch(/^[a-z0-9_]{1,40}$/);
        }
      });

      it('declares no duplicate keys', () => {
        const keys = tpl.fields.map((f) => f.key);
        expect(new Set(keys).size).toBe(keys.length);
      });

      it('survives cleanLegalText byte for byte', () => {
        // The renderer runs this over the merged document. A clause the
        // cleaner eats is a clause the signed copy does not contain.
        //
        // Equality, not a tolerance. This started as `> length * 0.98`, which
        // on a body this size permitted 395 characters of silent loss, an
        // entire clause, while the real delta is zero. A tolerance on a legal
        // instrument is a licence to lose a term.
        const cleaned = cleanLegalText(tpl.body);
        expect(cleaned).toBe(tpl.body);
      });
    });
  }
});

describe('Zinpro mutual NDA', () => {
  const employeeValues = {
    zinpro_signatory_name: 'Dana Whitfield',
    zinpro_signatory_title: 'General Counsel',
    zinpro_signatory_email: 'dana@example.com',
  };

  const merge = (values: Record<string, string>, counterpartyName?: string | null) =>
    mergeTemplateDocument({
      body: ZINPRO_MUTUAL_NDA.body,
      fields: ZINPRO_MUTUAL_NDA.fields,
      values,
      firmName: 'Anderson Foundation',
      signatureName: 'Dana Whitfield',
      signerEmail: 'dana@example.com',
      signedOn: 'August 6, 2026',
      counterpartyName,
    });

  it('is sent for signature and reviewed before it goes out', () => {
    expect(ZINPRO_MUTUAL_NDA.deliveryMode).toBe('signature');
    expect(ZINPRO_MUTUAL_NDA.requiresApproval).toBe(true);
  });

  it('names Zinpro Corporation literally, never the installing workspace', () => {
    // {{firm_name}} resolves to the workspace the template is installed in.
    // This workspace is not named Zinpro, and a mutual NDA naming the wrong
    // entity as a party is the wrong agreement, not a typo.
    const merged = merge(employeeValues, 'Northwind Materials LLC');
    expect(ZINPRO_MUTUAL_NDA.body).not.toContain('{{firm_name}}');
    expect(ZINPRO_MUTUAL_NDA.body).not.toContain('{{company_name}}');
    expect(merged).toContain('Zinpro Corporation and its subsidiaries');
    expect(merged).not.toContain('Anderson Foundation');
  });

  it('leaves every company blank ruled, even when values for them are pushed in', () => {
    // The employee does not answer for the other side. Section 15 makes the
    // email in that block the contractual notice address, so a value that
    // reached this map for a counterparty key is either a stale draft or a
    // caller pushing one in, and must not print as if the company typed it.
    const merged = merge({
      ...employeeValues,
      company_legal_name: 'Guessed Entity Inc',
      company_email: 'guess@example.com',
    });
    expect(merged).not.toContain('Guessed Entity Inc');
    expect(merged).not.toContain('guess@example.com');
    expect(merged).toContain(counterpartyMarker('company_legal_name'));
    expect(merged).toContain(counterpartyMarker('company_email'));
  });

  it('merges the employee answers it is given', () => {
    const merged = merge(employeeValues, 'Northwind Materials LLC');
    expect(merged).toContain('Name: Dana Whitfield');
    expect(merged).toContain('Title: General Counsel');
    expect(merged).toContain('Email: dana@example.com');
  });

  it('leaves exactly one place for each party to sign', () => {
    const merged = merge(employeeValues, 'Northwind Materials LLC');
    // The source document's ruled "By: ____" lines are deliberately not
    // reproduced: mergeTemplateDocument appends one execution block per
    // party, and a second set of rules would give each signer a place to
    // sign that is neither stamped nor recorded.
    expect(merged).not.toMatch(/_{6,}/);
    expect(merged.match(/^Signed: /gm)?.length).toBe(1);
    expect(merged.match(/^For Northwind Materials LLC:$/gm)?.length).toBe(1);
    expect(merged.match(/^Signature:$/gm)?.length).toBe(1);
  });

  it('puts the stamp on the block the renderer will find', () => {
    const merged = merge(employeeValues, 'Northwind Materials LLC');
    const line = findSignatureBlockLine(merged);
    expect(line).not.toBeNull();
    expect(merged.split('\n')[line as number]).toContain('Signed: Dana Whitfield');
  });

  it('keeps the operative clauses byte-identical through the text cleaner', () => {
    // Each of these carries a real obligation, and each contains punctuation
    // the cleaner rewrites elsewhere in the file (quotes, parentheses,
    // hyphens). If one of them changes, the signed copy differs from the
    // document legal approved.
    const cleaned = cleanLegalText(ZINPRO_MUTUAL_NDA.body);
    const operative = [
      'in accordance with the laws of the State of Minnesota',
      'shall continue until the five (5) year anniversary of the date first written above',
      'for a period of two (2) years from the date of this Agreement',
      'with a courtesy copy to legal@zinpro.com for Zinpro',
      'monetary damages would be inadequate to compensate the Disclosing Party',
      'may retain any Confidential Information for compliance purposes',
    ];
    for (const clause of operative) {
      expect(ZINPRO_MUTUAL_NDA.body).toContain(clause);
      expect(cleaned).toContain(clause);
    }
  });

  it('carries all twenty numbered sections', () => {
    for (let n = 1; n <= 20; n += 1) {
      expect(ZINPRO_MUTUAL_NDA.body).toMatch(new RegExp(`(^|\\n)${n}\\. `));
    }
  });

  it('is findable by slug and refuses anything else', () => {
    expect(findSeedTemplate('zinpro-mutual-nda')).toBe(ZINPRO_MUTUAL_NDA);
    expect(findSeedTemplate('nope')).toBeNull();
    expect(findSeedTemplate(null)).toBeNull();
    expect(findSeedTemplate(42)).toBeNull();
  });
});
