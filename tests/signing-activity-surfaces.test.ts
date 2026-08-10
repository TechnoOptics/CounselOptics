import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSigningActivity } from '../lib/signing-activity';

/**
 * Two audiences read the same events, and they are not entitled to the same
 * things.
 *
 * The legal team may see everything, because they are the party who would
 * rely on the record: addresses, devices, the machine opens, the chain. The
 * colleague who filed the document may see the outcome and nothing about the
 * recipient as a person. That boundary is enforced structurally (the type the
 * portal receives has no field for an address) and the portal's own loader
 * applies the projection so no template has to remember to. This file holds
 * down the parts of that arrangement a type cannot state.
 *
 * It also pins the difference between "nothing happened" and "we could not
 * find out", which is the failure mode most likely to be quietly reintroduced:
 * an empty result rendered as an answer tells a firm a document was never
 * opened when the truth is that the question was never answered.
 *
 * Mutations this file is meant to catch, each verified red:
 *   - loadSigningActivity returns an empty map instead of null on a read error
 *   - the portal page reaches for the firm's copy or the machine-open count
 *   - the counsel page stops distinguishing the two kinds of quiet
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const COUNSEL_PAGE = 'app/counsel/signing/[id]/page.tsx';
const PORTAL_PAGE = 'app/portal/forms/submissions/[id]/page.tsx';
const PORTAL_LOADER = 'lib/submission-completion.ts';

// ---------------------------------------------------------------------
// Not known is not the same as nothing happened
// ---------------------------------------------------------------------

function adminReturning(result: { data: unknown; error: unknown }) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    order: async () => result,
  };
  return { from: () => query } as never;
}

describe('an unanswerable question is not answered', () => {
  it('returns null, not an empty map, when the events cannot be read', async () => {
    const activity = await loadSigningActivity(
      adminReturning({ data: null, error: { message: 'permission denied' } }),
      'req-1',
    );
    // An empty map renders as "not opened yet" on both surfaces. That is a
    // claim about a real person's behaviour, made on the strength of a failed
    // query, and it is exactly the sentence a firm would act on.
    expect(activity).toBeNull();
  });

  it('returns an empty map when the request genuinely has no events', async () => {
    const activity = await loadSigningActivity(
      adminReturning({ data: [], error: null }),
      'req-1',
    );
    expect(activity).not.toBeNull();
    expect(activity!.size).toBe(0);
  });
});

// ---------------------------------------------------------------------
// The two audiences
// ---------------------------------------------------------------------

describe('the employee surface says less than the firm surface', () => {
  const portal = read(PORTAL_PAGE);
  const counsel = read(COUNSEL_PAGE);

  it('gives the employee their own copy and never the firm copy', () => {
    expect(portal).toContain('submitterActivitySentence(');
    // firmActivitySentence names the next move (resend, call them), which is
    // the legal team's move and not the employee's. Handing it to the
    // employee would have them chasing a counterparty across their own
    // legal team.
    expect(portal).not.toContain('firmActivitySentence');
  });

  it('never shows the employee the machine-open count', () => {
    // A fact about the recipient's mail infrastructure, and nothing the
    // employee can act on.
    expect(portal).not.toContain('automatedOpensSentence');
    expect(portal).not.toContain('interactiveOpens');
  });

  it('narrows in the loader, not in the template', () => {
    // A template that has to remember to narrow is a template that will one
    // day forget.
    expect(read(PORTAL_LOADER)).toContain('projectActivityForSubmitter(');
    expect(portal).not.toContain('projectActivityForSubmitter');
  });

  it('gives the firm the whole picture, including what it does not prove', () => {
    expect(counsel).toContain('firmActivitySentence(');
    expect(counsel).toContain('automatedOpensSentence(');
    // And the sentence that stops a reader taking an open for a reading.
    expect(counsel).toContain('It does not establish that anyone read the');
    expect(counsel).toContain('/api/firm/sign/audit-trail/');
  });

  it('keeps the two kinds of quiet apart on the firm surface', () => {
    // verdictNeedsAttention is what raises the banner; firmActivitySentence
    // is what says WHICH silence it is. A banner with one sentence for both
    // would send a firm to resend a link that was already opened.
    expect(counsel).toContain('verdictNeedsAttention(');
    expect(counsel).toMatch(/attention\.map/);
  });
});
