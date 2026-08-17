import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  selectTicketAnalysisDocuments,
  type TicketDocumentRow,
} from '../lib/intake-analysis';

/**
 * The in-house counsel ticket may only analyse the documents that were
 * submitted WITH the ticket.
 *
 * The owner's instruction was two things, and the second is the sharp one:
 * show the control only when a document is attached, and run it only on the
 * attachments, never on something counsel supplies. Before this, the ticket
 * embedded AnalyzeStudio, whose textarea and file picker fed
 * /api/counsel/analyze a `text` field. That endpoint took the body's text and
 * nothing else: no intake id, no document id, so there was nothing to
 * authorize and no ownership check existed or could exist.
 *
 * Every 'use server' export and every route handler is a public HTTP
 * endpoint. A UI that only offers the ticket's own files is not a gate, so
 * the target is derived server side from the ticket row and the caller is
 * given no parameter that could name a document.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

/**
 * Source with comments gone.
 *
 * Guards in this repo have been found passing because the comment explaining
 * the fix contained the string the guard searched for. Every source assertion
 * below reads this, never the raw file.
 */
const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

const codeOf = (rel: string) => stripComments(read(rel));

const TICKET = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER_TICKET = 'bbbbbbbb-0000-4000-8000-000000000002';
const FIRM = 'ffffffff-0000-4000-8000-000000000003';
const OTHER_FIRM = 'eeeeeeee-0000-4000-8000-000000000004';

const doc = (over: Partial<TicketDocumentRow>): TicketDocumentRow => ({
  id: 'doc-1',
  firm_id: FIRM,
  intake_id: TICKET,
  name: 'contract.pdf',
  file_path: `intake-chat/${FIRM}/${TICKET}/contract.pdf`,
  mime_type: 'application/pdf',
  archived_at: null,
  ...over,
});

describe('the analysis target is the ticket\'s own attachments', () => {
  it('keeps a document attached to this ticket', () => {
    const kept = selectTicketAnalysisDocuments([doc({})], {
      intakeId: TICKET,
      firmId: FIRM,
    });
    expect(kept.map((d) => d.id)).toEqual(['doc-1']);
  });

  /**
   * Mutation: drop the intake_id comparison. This goes red.
   */
  it('refuses a document that belongs to another ticket', () => {
    const kept = selectTicketAnalysisDocuments(
      [doc({ id: 'other-ticket-doc', intake_id: OTHER_TICKET })],
      { intakeId: TICKET, firmId: FIRM },
    );
    expect(kept).toEqual([]);
  });

  /**
   * The cross-tenant case, and the reason the firm is compared at all: a row
   * that claims THIS intake id while belonging to another firm. The listing
   * query is scoped by intake_id alone in the conversation loader, which is
   * safe there only because the intake was authorized first. Here the firm is
   * compared explicitly so the check does not depend on that.
   *
   * Mutation: drop the firm_id comparison. This goes red.
   */
  it('refuses a document that belongs to another firm', () => {
    const kept = selectTicketAnalysisDocuments(
      [doc({ id: 'other-firm-doc', firm_id: OTHER_FIRM })],
      { intakeId: TICKET, firmId: FIRM },
    );
    expect(kept).toEqual([]);
  });

  it('refuses an archived attachment', () => {
    const kept = selectTicketAnalysisDocuments(
      [doc({ id: 'archived-doc', archived_at: '2026-08-01T00:00:00Z' })],
      { intakeId: TICKET, firmId: FIRM },
    );
    expect(kept).toEqual([]);
  });

  it('returns nothing when the ticket has no attachments, so the caller can refuse', () => {
    expect(
      selectTicketAnalysisDocuments([], { intakeId: TICKET, firmId: FIRM }),
    ).toEqual([]);
  });
});

describe('the ticket analysis route takes no content from the caller', () => {
  const ROUTE = 'app/api/counsel/intake/[id]/analyze/route.ts';

  /**
   * The whole point. /api/counsel/analyze reads `body.text`; this route must
   * not, or counsel can analyse anything they paste and the owner's
   * instruction is undone by one fetch call.
   *
   * Mutation: read a text field off the body. This goes red.
   */
  it.each(['body.text', 'documentId', 'document_id', 'docId', 'filePath', 'file_path:'])(
    'never reads %s from the request',
    (needle) => {
      expect(codeOf(ROUTE)).not.toContain(needle);
    },
  );

  /**
   * Scoped to the ATTACHMENT query specifically, not to the file.
   *
   * The first version of this asserted the file contained `eq('firm_id'`
   * anywhere. Deleting the firm scope from the document query left it green,
   * because the policy query further down carries a firm scope too and
   * satisfied the search. A guard that any other query can satisfy is not
   * guarding this one.
   *
   * Mutation: remove either eq() from the firm_documents chain. Goes red.
   */
  it('scopes the attachment query by both the ticket and the firm', () => {
    const code = codeOf(ROUTE);
    const start = code.indexOf("from('firm_documents')");
    expect(start).toBeGreaterThan(-1);
    // The chain ends at its await/assignment terminator.
    const chain = code.slice(start, code.indexOf(';', start));
    expect(chain).toContain("eq('intake_id'");
    expect(chain).toContain("eq('firm_id'");
  });

  it('derives the target through the shared selector rather than trusting the query', () => {
    expect(codeOf(ROUTE)).toContain('selectTicketAnalysisDocuments');
  });

  it('refuses when the ticket carries no document', () => {
    expect(codeOf(ROUTE)).toContain('NO_DOCUMENT');
  });

  /**
   * The analysis is measured against the firm's own written policies, read
   * from the SAME table and through the SAME corpus builder the employee
   * document checker uses. A second policy store is the failure this guards
   * against.
   *
   * Mutation: drop the firm_policies read. This goes red.
   */
  it('reads the firm\'s policies from the one policy table', () => {
    const code = codeOf(ROUTE);
    expect(code).toContain("from('firm_policies')");
    expect(code).toContain('buildPolicyCorpus');
  });

  /**
   * Mutation: delete the enqueue of the provenance line, or hand the job to
   * the model by putting "list your sources" in the prompt instead. Either
   * goes red.
   */
  it('states what the answer was measured against, from the server', () => {
    const code = codeOf(ROUTE);
    expect(code).toContain('policyProvenanceLine');
    /**
     * Compared INSIDE the stream body. The first version of this compared
     * positions across the whole file and so measured import order, where
     * `streamBella` is imported first and the assertion was meaningless.
     */
    const body = code.slice(code.indexOf('new ReadableStream'));
    const provenance = body.indexOf('policyProvenanceLine');
    const modelCall = body.indexOf('streamBella');
    expect(provenance).toBeGreaterThan(-1);
    expect(modelCall).toBeGreaterThan(-1);
    expect(provenance).toBeLessThan(modelCall);
  });
});

describe('the ticket only offers the AI controls once a document is attached', () => {
  const PAGE = 'app/counsel/intake/[id]/page.tsx';

  /**
   * The owner: show the conflict check and the analysis only if a document is
   * attached. On today's production data no firm_documents row carries an
   * intake_id, so both are hidden everywhere. That is the instruction, not a
   * bug.
   *
   * Mutation: render either section unconditionally. This goes red.
   */
  /**
   * Read as "the section each gate opens", not "anything after the gate".
   * Slicing to the end of the file was the first version of this and it passed
   * for a reason that had nothing to do with the gate: every later section is
   * also after the first gate.
   */
  function gatedSectionIds(code: string): string[] {
    const ids: string[] = [];
    const re = /hasAttachments &&/g;
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const after = code.slice(m.index, m.index + 400);
      const id = /id="([a-z]+)"/.exec(after);
      if (id) ids.push(id[1]);
    }
    return ids;
  }

  it('gates exactly the conflict check and the analysis on an attachment', () => {
    expect(gatedSectionIds(codeOf(PAGE)).sort()).toEqual(['analyze', 'conflict']);
  });

  /**
   * AnalyzeStudio is the free-text studio: a textarea plus a local file
   * reader, posting whatever it holds to /api/counsel/analyze. Its presence on
   * this route IS the thing the owner asked to be removed, so its absence is
   * pinned rather than left to reading.
   *
   * Mutation: import it again. This goes red.
   */
  it('does not embed the free-text analyze studio', () => {
    const code = codeOf(PAGE);
    expect(code).not.toContain('AnalyzeStudio');
    expect(code).not.toContain('analyze-studio');
  });

  /**
   * Declining, sending for signature and booking a meeting are things a team
   * does about a request whether or not a file came with it, so gating them
   * would empty the card. This also keeps the card's header from standing over
   * nothing.
   */
  /**
   * The owner asked for a place to refer to the firm's policies from a
   * ticket. It points at the EXISTING library, because a second policy store
   * is the thing worth not building.
   *
   * Mutation: drop the link. This goes red.
   */
  it('reaches the firm\'s policies from the ticket', () => {
    expect(codeOf('app/counsel/intake/[id]/analyze-attachments.tsx')).toContain(
      '/counsel/policies',
    );
  });

  it('leaves the sections that do not depend on a document ungated', () => {
    const gated = gatedSectionIds(codeOf(PAGE));
    for (const id of ['decide', 'signing', 'meeting']) {
      expect(gated).not.toContain(id);
    }
  });
});
