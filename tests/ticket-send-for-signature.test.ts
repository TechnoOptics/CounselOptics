import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  FILED_ATTACHMENT_SEND_NOTE,
  SEND_FOR_SIGNATURE_LABEL,
  ticketDocumentSendState,
} from '../lib/intake-signature-send';

/**
 * SENDING A TICKET'S DOCUMENT FOR SIGNATURE WITHOUT LEAVING THE TICKET.
 *
 * Two halves, for two different failure modes.
 *
 * The first is the rule about WHICH document may be sent. It is a pure
 * function on purpose: vitest here runs in environment 'node' with no DOM, so
 * a decision left inside JSX is a decision nothing can execute. Getting it
 * wrong is not cosmetic - a file attached when the request was filed has no
 * `firm_documents` row, so a control offered on one would fail at the first
 * lookup, in front of a lawyer, after they had typed a signer's address.
 *
 * The second is that the UI actually asks that function, and that the
 * employee's copy of the same panel never gets the control. Those can only be
 * pinned by reading the source, so every read below strips comments AND import
 * statements first. Both have defeated guards in this repo: a comment
 * explaining a fix contains the string the guard greps for, and an import line
 * contains the name of a function nothing calls.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const stripComments = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\/[^\n]*/g, '');

/** Comments gone, and import statements gone with them. */
const codeOf = (rel: string) =>
  stripComments(read(rel)).replace(/^\s*import\s[\s\S]*?from\s+'[^']+';/gm, '');

const PANEL = 'components/intake/IntakeWorkPanel.tsx';
const DIALOG = 'components/intake/SendForSignatureDialog.tsx';
const COUNSEL_PAGE = 'app/counsel/intake/[id]/page.tsx';
const PORTAL_PAGE = 'app/portal/[id]/page.tsx';

describe('which document on a ticket may be sent for signature', () => {
  /**
   * Mutation: change the gate in lib/intake-signature-send.ts to anything
   * that also admits 'filed' (for instance `doc.origin !== 'requested'`) and
   * the filed cases below go red, which is the whole point of the module.
   */
  it('clears a document shared in the conversation, and hands back its id', () => {
    const state = ticketDocumentSendState({
      id: '2b1c9b1e-0000-4000-8000-000000000000',
      origin: 'chat',
    });
    expect(state.canSend).toBe(true);
    expect(state.canSend && state.documentId).toBe(
      '2b1c9b1e-0000-4000-8000-000000000000',
    );
  });

  /**
   * The one that matters. A creation-time attachment lives on
   * `intake_answers.attachments`, and the id the panel holds for it is the
   * synthetic `filed:<path>` string lib/intake-conversation.ts invents so
   * React has a key. Nothing can look that up.
   */
  it('refuses a file that came in with the request, and says why', () => {
    const state = ticketDocumentSendState({
      id: 'filed:intake/abc/contract.pdf',
      origin: 'filed',
    });
    expect(state.canSend).toBe(false);
    expect(state.canSend === false && state.note).toBe(FILED_ATTACHMENT_SEND_NOTE);
  });

  /** Declared on the type, produced by nothing. Not sendable is the safe read. */
  it('refuses the unused requested origin rather than guessing', () => {
    expect(
      ticketDocumentSendState({ id: 'x', origin: 'requested' }).canSend,
    ).toBe(false);
  });

  /**
   * The note is read by somebody mid-task who wanted a different answer, so it
   * has to be short, plain, and tell them what to do instead. It is asserted
   * rather than described because "calm and short" is the requirement.
   */
  it('states the way round it, calmly and in one breath', () => {
    expect(FILED_ATTACHMENT_SEND_NOTE.length).toBeLessThan(160);
    expect(FILED_ATTACHMENT_SEND_NOTE).toContain('Share it in the conversation');
    // No em dash anywhere in this product's copy, and nothing alarming. The
    // forbidden character is written as an escape so that this file, which
    // exists to forbid it, does not itself contain one.
    expect(FILED_ATTACHMENT_SEND_NOTE).not.toContain('\u2014');
    for (const word of ['error', 'cannot', 'failed', 'invalid', 'not allowed']) {
      expect(FILED_ATTACHMENT_SEND_NOTE.toLowerCase()).not.toContain(word);
    }
  });
});

describe('the documents list asks that function rather than deciding for itself', () => {
  /**
   * Mutation: replace the call with an inline `d.origin === 'chat'` and this
   * goes red. A NAME is not enough - the import line carries the name, which
   * is how a guard in this repo passed while nothing called anything.
   */
  it('calls ticketDocumentSendState in the panel', () => {
    expect(codeOf(PANEL)).toMatch(/ticketDocumentSendState\s*\(/);
  });

  /**
   * The rule may not be written out twice. A second copy in JSX is a copy no
   * test above can reach, and this repo has already shipped one geometry in
   * three hand-written copies that drifted apart.
   */
  it('does not re-derive the origin rule in JSX', () => {
    const code = codeOf(PANEL);
    // The existing caption ("Filed with the request" / "Shared in
    // conversation") tests for 'filed', which is presentation, not the send
    // rule. What must not appear is a second test for the sendable case.
    expect(code).not.toMatch(/origin\s*===\s*'chat'/);
  });

  /** Both branches exist: the control, and an honest line where it cannot go. */
  it('renders the control on a sendable document and the note otherwise', () => {
    const code = codeOf(PANEL);
    expect(code).toMatch(/send\.canSend\s*\?/);
    expect(code).toContain('{send.note}');
    expect(code).toContain('SEND_FOR_SIGNATURE_LABEL');
  });

  /**
   * Mutation: drop the `signing &&` in front of the control and the control
   * appears for the employee on /portal/[id], which is the surface boundary
   * this slice must not cross.
   *
   * THE GATE IS TIED TO THE CONTROL, not merely present in the file. The first
   * version of this asserted `/\{signing\s*&&/` anywhere in the panel and
   * survived exactly that mutation: the panel has a SECOND `{signing &&`, on
   * the dialog at the bottom, and the loose match found that one and reported
   * green while the control rendered unconditionally. So the assertion spans
   * from the gate to `send.canSend`, which is the branch it must guard.
   */
  it('draws nothing at all unless the caller asked for the control', () => {
    const code = codeOf(PANEL);
    expect(code).toMatch(/\{signing\s*&&\s*\([\s\S]{0,240}?send\.canSend/);
    // Two gates, both deliberate: the control, and the dialog it opens.
    expect([...code.matchAll(/\{signing\s*&&/g)]).toHaveLength(2);
  });

  /** The composer is opened, not re-implemented. */
  it('opens the dialog with the chosen document', () => {
    const code = codeOf(PANEL);
    expect(code).toMatch(/<SendForSignatureDialog/);
    expect(code).toMatch(/documentId=\{sendingDoc\.id\}/);
    expect(code).toMatch(/firmId=\{signing\.firmId\}/);
  });
});

describe('the composer is reused, not rewritten', () => {
  /**
   * Mutation: hand-roll a signer list in the dialog instead of mounting
   * CreateSigningRequestForm, and this goes red. There is exactly one signing
   * composer in the product and this slice does not add a second.
   */
  it('mounts the existing CreateSigningRequestForm', () => {
    const code = codeOf(DIALOG);
    expect(code).toMatch(/<CreateSigningRequestForm[\s\S]*?firmId=\{firmId\}/);
    expect(code).toMatch(/documentId=\{documentId\}/);
    // No second form, no second call into the signing action.
    expect(code).not.toContain('createSigningRequestAction');
    expect(code).not.toContain('<input');
  });

  /** The file name is somebody's words, so it stays out of the translator. */
  it('marks the document name as data it must not translate', () => {
    expect(codeOf(DIALOG)).toContain('data-no-translate');
  });
});

describe('this is the legal team surface only', () => {
  /** The counsel ticket turns it on, once, on the documents panel. */
  it('is enabled on the counsel ticket page', () => {
    const code = codeOf(COUNSEL_PAGE);
    expect([...code.matchAll(/signing=\{\{\s*firmId:\s*ctx\.firm\.id\s*\}\}/g)]).toHaveLength(1);
  });

  /**
   * Mutation: add `signing={{ firmId: ... }}` to either IntakeWorkPanel on the
   * employee page and this goes red. The employee page reads through the ADMIN
   * client behind a hand-written gate, so nothing else would stop it.
   */
  it('is absent from the employee portal ticket page', () => {
    const code = codeOf(PORTAL_PAGE);
    expect(code).not.toContain('signing=');
    expect(code).not.toContain('SendForSignature');
    expect(code).not.toContain('ticketDocumentSendState');
  });

  /** And the label the reader sees is the one the module names. */
  it('names the control once, in the module both sides read', () => {
    expect(SEND_FOR_SIGNATURE_LABEL).toBe('Send for signature');
  });
});
