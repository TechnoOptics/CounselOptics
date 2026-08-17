import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';
import { groupByCategory, UNFILED_CATEGORY } from '../lib/document-category';
import { REQUEST_TYPES } from '../lib/portal-request-families';
import {
  TEMPLATE_ID_KEY,
  TEMPLATE_NAME_KEY,
  TEMPLATE_STEP_EMPTY,
  TEMPLATE_STEP_HELP,
  TEMPLATE_STEP_QUESTION,
  deliveryModeLabel,
  filterTemplates,
  matchesTemplateQuery,
  requestTypeInvolvesDocument,
  type PickableTemplate,
} from '../lib/intake-template-picker';

const tpl = (over: Partial<PickableTemplate> & { id: string }): PickableTemplate => ({
  name: 'Mutual NDA',
  description: 'For two-way disclosures with a vendor.',
  category: 'NDA',
  deliveryMode: 'share',
  ...over,
});

describe('matchesTemplateQuery', () => {
  /**
   * Three fields, and a needle that appears in EXACTLY ONE of them each time.
   *
   * The first draft of this used the default fixture, whose name is "Mutual
   * NDA" and whose category is "NDA", and asserted the category with the
   * needle "nda". Deleting the category from the search left that assertion
   * passing, because the name matched it: the guard on a whole field was
   * inert. It was caught by mutating the field away and watching for a red
   * that never came.
   */
  const row = tpl({
    id: 'a',
    name: 'Mutual NDA',
    description: 'For two-way disclosures with a vendor.',
    category: 'Confidentiality',
  });

  it('matches on the name, and the name alone', () => {
    expect(matchesTemplateQuery(row, 'mutual')).toBe(true);
  });

  it('matches on the description, and the description alone', () => {
    expect(matchesTemplateQuery(row, 'disclosures')).toBe(true);
  });

  it('matches on the category, and the category alone', () => {
    expect(matchesTemplateQuery(row, 'confidentiality')).toBe(true);
  });

  it('is case-insensitive and ignores surrounding space', () => {
    expect(matchesTemplateQuery(row, '  MUTUAL  ')).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesTemplateQuery(row, '')).toBe(true);
    expect(matchesTemplateQuery(row, '   ')).toBe(true);
  });

  it('says no when nothing printed on the row contains it', () => {
    expect(matchesTemplateQuery(row, 'indemnity')).toBe(false);
  });

  it('survives a template with no description and no category', () => {
    const bare = tpl({ id: 'b', description: null, category: null });
    expect(matchesTemplateQuery(bare, 'mutual')).toBe(true);
    expect(matchesTemplateQuery(bare, 'vendor')).toBe(false);
  });
});

describe('filterTemplates', () => {
  const rows = [
    tpl({ id: 'a', name: 'Mutual NDA', category: 'NDA' }),
    tpl({ id: 'b', name: 'Vendor MSA', category: 'Vendor', description: null }),
    tpl({ id: 'c', name: 'One-way NDA', category: 'NDA', description: null }),
  ];

  it('keeps the results in the order they arrived', () => {
    expect(filterTemplates(rows, 'nda').map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('returns nothing when nothing matches, which is a real branch', () => {
    expect(filterTemplates(rows, 'indemnity')).toEqual([]);
  });

  /**
   * The picker groups its results with the same helper the legal team's own
   * queues use, so the two sides of the product never disagree about what
   * counts as one category. Asserted end to end here because the grouping of
   * SEARCH RESULTS is what a person actually reads.
   */
  it('groups its results by category with the shared helper', () => {
    const groups = groupByCategory(filterTemplates(rows, ''), (r) => r.category);
    expect(groups.map((g) => g.category)).toEqual(['NDA', 'Vendor']);
    expect(groups[0].rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('puts a template with no category under Unfiled, last', () => {
    const withBare = [...rows, tpl({ id: 'd', category: null })];
    const groups = groupByCategory(withBare, (r) => r.category);
    expect(groups[groups.length - 1].category).toBe(UNFILED_CATEGORY);
  });
});

describe('requestTypeInvolvesDocument', () => {
  it('says no where a standard document is not the question', () => {
    expect(requestTypeInvolvesDocument('New case / matter')).toBe(false);
    expect(requestTypeInvolvesDocument('Compliance question')).toBe(false);
  });

  it('says yes for the paperwork types', () => {
    expect(requestTypeInvolvesDocument('NDA review')).toBe(true);
    expect(requestTypeInvolvesDocument('Vendor / MSA review')).toBe(true);
    expect(requestTypeInvolvesDocument('New contract / agreement')).toBe(true);
    expect(requestTypeInvolvesDocument('Document for safekeeping')).toBe(true);
  });

  it('says no for an absent type', () => {
    expect(requestTypeInvolvesDocument(null)).toBe(false);
    expect(requestTypeInvolvesDocument(undefined)).toBe(false);
    expect(requestTypeInvolvesDocument('')).toBe(false);
    expect(requestTypeInvolvesDocument('   ')).toBe(false);
    expect(requestTypeInvolvesDocument(7)).toBe(false);
  });

  /**
   * The rule is spelled as its exclusions, so a request type added to
   * REQUEST_TYPES later gets the step rather than silently losing it. This
   * holds that: every type the form offers but the two named ones qualifies.
   */
  it('offers the step for every request type except the two named ones', () => {
    const qualifying = REQUEST_TYPES.filter((r) =>
      requestTypeInvolvesDocument(r.value),
    ).map((r) => r.value);
    const excluded = REQUEST_TYPES.map((r) => r.value).filter(
      (v) => !qualifying.includes(v),
    );
    expect(excluded).toEqual(['New case / matter', 'Compliance question']);
  });
});

describe('deliveryModeLabel', () => {
  it('says which of the two deliveries a result takes', () => {
    expect(deliveryModeLabel('signature')).toBe('Sent for signature');
    expect(deliveryModeLabel('share')).toBe('Sent as a share');
  });
});

describe('the step copy', () => {
  it('is the copy the owner wrote, verbatim', () => {
    expect(TEMPLATE_STEP_QUESTION).toBe('Is there a standard document for this?');
    expect(TEMPLATE_STEP_HELP).toBe(
      'Search what your legal team has prepared. If nothing fits, attach what you have and legal will work from that.',
    );
    expect(TEMPLATE_STEP_EMPTY).toBe(
      'Nothing matched that. Attach the document you have below and your legal team will take it from there.',
    );
  });
});

/**
 * The wiring, read from source with COMMENTS STRIPPED FIRST.
 *
 * The form's comments name every action and every gate discussed here, so a
 * guard over raw source would be satisfied by the prose rather than by the
 * code. Each positive assertion is on a CALL, not a name.
 */
const FORM = 'app/counsel/intake/create-intake-form.tsx';
const read = (rel: string) =>
  stripComments(readFileSync(join(__dirname, '..', rel), 'utf8'));

describe('the form offers the standard documents a firm has prepared', () => {
  it('asks for the published list for an employee', () => {
    expect(read(FORM)).toContain('listPortalTemplatesAction(firmId)');
  });

  it('asks for every status for the legal team', () => {
    // A lawyer filing on a colleague's behalf has to be able to reach a draft.
    expect(read(FORM)).toContain('listFirmTemplatesAction(firmId)');
  });

  it('gates the step on the request type through the shared rule', () => {
    expect(read(FORM)).toContain('requestTypeInvolvesDocument(requestType)');
  });

  it('searches and groups through the shared helpers', () => {
    const src = read(FORM);
    expect(src).toContain('filterTemplates(rows ?? [], q)');
    expect(src).toContain('groupByCategory(matched,');
  });

  it('records the chosen template in intake_answers', () => {
    const src = read(FORM);
    expect(src).toContain('intakeAnswers[TEMPLATE_ID_KEY]');
    expect(src).toContain('intakeAnswers[TEMPLATE_NAME_KEY]');
    expect(TEMPLATE_ID_KEY).toBe('template_id');
    expect(TEMPLATE_NAME_KEY).toBe('template_name');
  });
});

/**
 * THE LINE THIS FEATURE MUST NOT CROSS.
 *
 * importTemplateDocumentAction is gated to FIRM_TEMPLATE_AUTHOR_ROLES and
 * feeds the uploaded file to proposeTemplateFromText, whose system prompt
 * instructs the model to rewrite the document's blanks into placeholders and
 * to strip the source's own ruled signature lines. Putting a counterparty's
 * contract through that would rewrite their instrument. A person filing a
 * request attaches their document to the request, which already works.
 *
 * This is the one assertion in these two files deliberately made on the NAME
 * rather than on a call: an import of that action from this form would be a
 * defect even before anything called it.
 */
describe('the intake form is not a route into the template library', () => {
  it('never names the template import action', () => {
    expect(read(FORM)).not.toContain('importTemplateDocumentAction');
  });

  it('never reaches the model that rewrites a document', () => {
    const src = read(FORM);
    expect(src).not.toContain('proposeTemplateFromText');
    expect(src).not.toContain('template-intake');
  });
});
