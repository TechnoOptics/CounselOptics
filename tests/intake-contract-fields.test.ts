import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './support/strip-comments';
import {
  CONTRACT_ANSWER_KEY,
  CONTRACT_DOCUMENT_TYPES,
  CONTRACT_VERSIONS,
  contractIntakeAnswers,
  isContractRequestType,
  readContractDetails,
} from '../lib/intake-contract-fields';
import { PORTAL_REQUEST_FAMILIES, REQUEST_TYPES } from '../lib/portal-request-families';

/**
 * The contract family's SHARED fields: what the employee tells the legal
 * team when they send an agreement in.
 *
 * Shared means they ride in intake_answers and render on both ticket pages.
 * That is the deliberate opposite of lib/intake-legal-fields.ts, and the two
 * files together are the audience rule: the employee's own words may live in
 * the jsonb their page selects whole; the legal team's may not.
 *
 * Every source anchor strips comments first and asserts a CALL rather than a
 * name.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const codeOf = (rel: string) => stripComments(read(rel));

const FORM = 'app/counsel/intake/create-intake-form.tsx';
const COUNSEL_PAGE = 'app/counsel/intake/[id]/page.tsx';
const PORTAL_PAGE = 'app/portal/[id]/page.tsx';
const MODULE = 'lib/intake-contract-fields.ts';
const GUARD = 'tests/employee-payload-scope.test.ts';

/** Just enough of FormData. */
const form = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

const contractTypes = PORTAL_REQUEST_FAMILIES.find((f) => f.key === 'contract')!.types;

describe('which request types carry the block', () => {
  /** Mutation: hard-code 'NDA review' instead of asking familyOfType. */
  it('is every type in the contract family and no other', () => {
    for (const r of REQUEST_TYPES) {
      expect(isContractRequestType(r.value), r.value).toBe(contractTypes.includes(r.value));
    }
    expect(isContractRequestType(null)).toBe(false);
  });
});

describe('contractIntakeAnswers', () => {
  const filled = {
    contractEntity: ' Acme Ltd ',
    contractContactName: 'Dana Ruiz',
    contractContactEmail: 'dana@acme.example',
    contractDepartment: 'Sales',
    contractLocation: 'Denver',
    contractDocumentType: 'Renewal',
    contractVersion: 'Our standard template',
    contractSignerName: 'Sam Lee',
    contractSignerTitle: 'VP Sales',
  };

  /** Mutation: write the block on every in-house request. */
  it('writes nothing at all on a request that is not a contract', () => {
    expect(contractIntakeAnswers(form(filled), 'Internal review request')).toEqual({});
    expect(contractIntakeAnswers(form(filled), 'Document for safekeeping')).toEqual({});
  });

  it('writes the block under one key, trimmed', () => {
    expect(contractIntakeAnswers(form(filled), 'NDA review')).toEqual({
      [CONTRACT_ANSWER_KEY]: {
        entity: 'Acme Ltd',
        contact_name: 'Dana Ruiz',
        contact_email: 'dana@acme.example',
        department: 'Sales',
        location: 'Denver',
        document_type: 'Renewal',
        version_requested: 'Our standard template',
        signer_name: 'Sam Lee',
        signer_title: 'VP Sales',
      },
    });
  });

  /** Mutation: store whatever string the select sent. */
  it('drops a document type or version that is not one of the offered words', () => {
    const res = contractIntakeAnswers(
      form({ ...filled, contractDocumentType: 'Sneaky', contractVersion: '<script>' }),
      'NDA review',
    ) as { contract: Record<string, unknown> };
    expect(res.contract.document_type).toBeNull();
    expect(res.contract.version_requested).toBeNull();
  });

  it('stores no block when every field was left blank', () => {
    expect(contractIntakeAnswers(form({}), 'NDA review')).toEqual({});
    expect(contractIntakeAnswers(form({ contractEntity: '   ' }), 'NDA review')).toEqual({});
  });

  it('offers real choices', () => {
    expect(CONTRACT_DOCUMENT_TYPES.length).toBeGreaterThanOrEqual(4);
    expect(CONTRACT_VERSIONS.length).toBeGreaterThanOrEqual(3);
  });
});

describe('readContractDetails', () => {
  it('prints only the filled fields, in the order the form asks', () => {
    const rows = readContractDetails({
      entity: 'Acme Ltd',
      department: '',
      document_type: 'Renewal',
      signer_name: null,
    });
    expect(rows).toEqual([
      { label: 'Customer or entity', value: 'Acme Ltd' },
      { label: 'Document type', value: 'Renewal' },
    ]);
  });

  /** The jsonb is untrusted. Anything that is not an object is no details. */
  it('reads nothing off a missing or malformed value', () => {
    expect(readContractDetails(undefined)).toEqual([]);
    expect(readContractDetails('Acme')).toEqual([]);
    expect(readContractDetails(42)).toEqual([]);
  });

  it('round-trips what the form wrote', () => {
    const written = contractIntakeAnswers(
      form({ contractEntity: 'Acme Ltd', contractDepartment: 'Sales' }),
      'Vendor / MSA review',
    ) as { contract: unknown };
    expect(readContractDetails(written.contract).map((r) => r.value)).toEqual([
      'Acme Ltd',
      'Sales',
    ]);
  });
});

describe('the form asks the fields the reader reads', () => {
  /**
   * Mutation: rename an input in the form without renaming it in the
   * reader. Either side alone would be a field that is asked and never
   * stored, which is how `subject` was lost once before.
   */
  it('uses the same field names on both sides', () => {
    const asked = new Set(
      [...codeOf(FORM).matchAll(/name="(contract[A-Za-z]+)"/g)].map((m) => m[1]),
    );
    const readNames = new Set(
      [...codeOf(MODULE).matchAll(/formField\(fd, '(contract[A-Za-z]+)'\)/g)].map((m) => m[1]),
    );
    expect(asked.size).toBeGreaterThanOrEqual(9);
    expect([...asked].sort()).toEqual([...readNames].sort());
  });

  /** Mutation: render the block on every in-house request, or forget to store it. */
  it('renders the block only for a contract type and stores it on submit', () => {
    const src = codeOf(FORM);
    expect(src).toMatch(/inhouse && isContractRequestType\(requestType\) && \(/);
    expect(src).toContain('contractIntakeAnswers(formData, requestType)');
  });

  /** The desired completion date, context and attachments are the existing fields. */
  it('does not ask the date, the details or the file a second time', () => {
    const src = codeOf(FORM);
    expect([...src.matchAll(/name="dueBy"/g)]).toHaveLength(1);
    expect([...src.matchAll(/name="matterSummary"/g)]).toHaveLength(1);
    expect([...src.matchAll(/name="attachments"/g)]).toHaveLength(1);
  });
});

describe('both pages print the block from one reader', () => {
  /**
   * Mutation: on the counsel page, move the contract section into the rail.
   * It is what the employee wrote, and tests/ticket-workspace.test.ts says
   * the employee's words stay in the main column.
   */
  it('the counsel page draws it in the main column off ans.contract', () => {
    const src = codeOf(COUNSEL_PAGE);
    const aside = src.indexOf('<aside');
    const at = src.indexOf('id="contract"');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(aside);
    expect(src).toContain('readContractDetails(ans.contract)');
  });

  it('the employee page draws it off the same key through the same reader', () => {
    const src = codeOf(PORTAL_PAGE);
    expect(src).toContain('id="portal-contract"');
    expect(src).toContain('readContractDetails(ans.contract)');
  });

  /** The key is reviewed where the employee payload guard lists keys. */
  it('the employee payload guard names the key deliberately', () => {
    const guard = codeOf(GUARD);
    const at = guard.indexOf('const ALLOWED = new Set([');
    expect(at).toBeGreaterThan(-1);
    expect(guard.slice(at, guard.indexOf('])', at))).toContain("'contract'");
  });

  /** Mutation: hand-write the labels on a page. Two lists drift. */
  it('neither page spells a label of its own', () => {
    for (const page of [COUNSEL_PAGE, PORTAL_PAGE]) {
      expect(codeOf(page), page).not.toContain('Customer or entity');
      expect(codeOf(page), page).not.toContain('Version requested');
    }
  });
});
