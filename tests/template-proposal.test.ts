import { describe, it, expect } from 'vitest';
import { parseTemplateProposal } from '../lib/template-proposal';

/**
 * lib/template-proposal.ts is the trust boundary over what the model says
 * about an uploaded document. Everything it returns is shown to the legal
 * team as a starting point for a template that will later be signed, so every
 * claim it forwards has to be checked against the body it also forwards.
 *
 * Each test below names, in a comment, the production change that turns it
 * red. A test that still passes with its guard deleted is not a test.
 */

/** Convenience: a reply exactly as the model is asked to produce it. */
function reply(value: unknown): string {
  return JSON.stringify(value);
}

describe('parseTemplateProposal: reading the model reply', () => {
  it('reads JSON out of a fenced code block', () => {
    // Mutation: drop the code-fence branch of extractJsonObject. The prose on
    // either side of the fence carries braces of its own, so neither the whole
    // reply nor the first-brace/last-brace slice parses, and this returns null.
    const raw =
      'Here is the proposal. I kept the {{placeholders}} you already use.\n\n```json\n' +
      reply({
        body: 'This agreement is made on {{effective_date}}.',
        fields: [{ key: 'effective_date', label: 'Effective date', type: 'date', required: true }],
      }) +
      '\n```\n\nTell me if {{effective_date}} should be optional.';
    const res = parseTemplateProposal(raw);
    expect(res).not.toBeNull();
    expect(res!.body).toBe('This agreement is made on {{effective_date}}.');
    expect(res!.fields).toEqual([
      { key: 'effective_date', label: 'Effective date', type: 'date', required: true, party: undefined },
    ]);
  });

  it('reads JSON out of a reply wrapped in prose', () => {
    // Mutation: remove the first-brace/last-brace fallback candidate. The
    // leading sentence makes JSON.parse fail and this returns null.
    const raw =
      'I found four blanks. ' +
      reply({ body: 'Signed for {{party_name}}.', fields: [{ key: 'party_name', label: 'Party' }] }) +
      ' Let me know if you want changes.';
    const res = parseTemplateProposal(raw);
    expect(res?.fields.map((f) => f.key)).toEqual(['party_name']);
  });

  it('returns null rather than throwing on text with no JSON in it', () => {
    // Mutation: let extractJsonObject call JSON.parse without the try/catch.
    // This throws instead of returning null and the test errors.
    expect(parseTemplateProposal('I could not read that document.')).toBeNull();
    expect(parseTemplateProposal('{ this is not json at all')).toBeNull();
    expect(parseTemplateProposal('')).toBeNull();
    expect(parseTemplateProposal('[1, 2, 3]')).toBeNull();
  });

  it('recovers the object when the model wraps the proposal in an array', () => {
    // Mutation: drop the `!Array.isArray` half of the shape check. The array
    // is then accepted as the proposal, `body` is undefined, and a usable
    // reply is thrown away as unreadable.
    const res = parseTemplateProposal('[' + reply({ body: 'Dated {{a_key}}.' }) + ']');
    expect(res?.body).toBe('Dated {{a_key}}.');
  });

  it('returns null when the body is empty', () => {
    // Mutation: delete the final `if (!body) return null`. This returns a
    // proposal with an empty body, which the editor would happily load over
    // whatever the author had already typed.
    expect(parseTemplateProposal(reply({ body: '   \n  ', fields: [] }))).toBeNull();
    expect(parseTemplateProposal(reply({ fields: [] }))).toBeNull();
  });
});

describe('parseTemplateProposal: which fields survive', () => {
  it('drops a field whose placeholder is not in the body', () => {
    // Mutation: stop intersecting the field list with the placeholders found
    // in the body. `witness_name` then survives and the editor shows an input
    // that changes nothing on the page.
    const res = parseTemplateProposal(
      reply({
        body: 'Made between {{company}} and the recipient.',
        fields: [
          { key: 'company', label: 'Company' },
          { key: 'witness_name', label: 'Witness name' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.key)).toEqual(['company']);
  });

  it('keeps the first of two fields that narrow to the same key', () => {
    // Mutation: remove the `seen` set. Both entries survive and the editor
    // renders two rows for one placeholder, whose settings disagree.
    const res = parseTemplateProposal(
      reply({
        body: 'Start date: {{start_date}}',
        fields: [
          { key: 'start_date', label: 'Start date', type: 'date' },
          { key: 'Start Date', label: 'When it begins', type: 'text' },
        ],
      }),
    );
    expect(res?.fields).toHaveLength(1);
    expect(res?.fields[0].label).toBe('Start date');
    expect(res?.fields[0].type).toBe('date');
  });

  it('narrows a key the way sanitizeFields does rather than rejecting it', () => {
    // Mutation: compare the raw key against the body instead of the narrowed
    // one. "Employee Name" never matches {{employee_name}} and the field is
    // dropped, so the template loses a blank the document actually has.
    const res = parseTemplateProposal(
      reply({
        body: 'Employee: {{employee_name}}',
        fields: [{ key: 'Employee Name', label: 'Employee name' }],
      }),
    );
    expect(res?.fields.map((f) => f.key)).toEqual(['employee_name']);
  });

  it('drops a key with nothing legal left in it, and says so by its original name', () => {
    // Mutation: remove the empty-key branch. The field is still dropped, by
    // the body check further down, but it is then reported to the reviewer as
    // an empty string, so the note names nothing they can act on.
    const res = parseTemplateProposal(
      reply({
        body: 'Recipient: {{recipient}}',
        fields: [
          { key: '***', label: 'Mystery' },
          { key: 'recipient', label: 'Recipient' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.key)).toEqual(['recipient']);
    expect(res?.notes.some((n) => n.includes('***'))).toBe(true);
  });

  it('drops a reserved firm key even when its placeholder is in the body', () => {
    // Mutation: delete the isReservedFirmKey guard. {{firm_name}} becomes an
    // empty required input on the employee's form and the firm-record
    // substitution that placeholder exists for stops happening.
    const res = parseTemplateProposal(
      reply({
        body: '{{firm_name}} and {{recipient_name}} agree as follows.',
        fields: [
          { key: 'firm_name', label: 'Firm name' },
          { key: 'recipient_name', label: 'Recipient name' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.key)).toEqual(['recipient_name']);
    expect(res?.body).toContain('{{firm_name}}');
  });

  it('caps the field list at forty, as the template writer does', () => {
    // Mutation: remove the slice. sanitizeFields would silently discard the
    // tail on save, so the reviewer would configure rows that never persist.
    const keys = Array.from({ length: 45 }, (_, i) => `field_${i}`);
    const res = parseTemplateProposal(
      reply({
        body: keys.map((k) => `{{${k}}}`).join(' '),
        fields: keys.map((k) => ({ key: k, label: k })),
      }),
    );
    expect(res?.fields).toHaveLength(40);
  });
});

describe('parseTemplateProposal: field settings the renderer acts on', () => {
  it('coerces an unrecognised type to text', () => {
    // Mutation: pass `o.type` straight through. 'currency' reaches the editor
    // select, which has no such option, and the control renders with no value.
    const res = parseTemplateProposal(
      reply({
        body: 'Fee: {{fee_amount}}',
        fields: [{ key: 'fee_amount', label: 'Fee', type: 'currency' }],
      }),
    );
    expect(res?.fields[0].type).toBe('text');
  });

  it('keeps date and textarea, which the editor does offer', () => {
    // Mutation: coerce every type to 'text'. The proposal stops carrying the
    // one judgement about a blank that the model is actually being asked for.
    const res = parseTemplateProposal(
      reply({
        body: '{{signed_on}} {{scope_of_work}}',
        fields: [
          { key: 'signed_on', label: 'Signed on', type: 'date' },
          { key: 'scope_of_work', label: 'Scope of work', type: 'textarea' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.type)).toEqual(['date', 'textarea']);
  });

  it('drops an unrecognised party instead of guessing counterparty', () => {
    // Mutation: coerce anything that is not 'employee' to 'counterparty'.
    // A blank meant for the colleague is then never asked of anyone: it is
    // drawn as a ruled blank on a document that has already been approved.
    const res = parseTemplateProposal(
      reply({
        body: '{{a_key}} {{b_key}}',
        fields: [
          { key: 'a_key', label: 'A', party: 'other side' },
          { key: 'b_key', label: 'B', party: 'vendor' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.party)).toEqual([undefined, undefined]);
  });

  it('keeps a party the editor understands', () => {
    // Mutation: always return undefined for party. Bella's read of which side
    // fills each blank is thrown away and every field becomes the employee's.
    const res = parseTemplateProposal(
      reply({
        body: '{{their_address}} {{our_contact}}',
        fields: [
          { key: 'their_address', label: 'Their address', party: 'counterparty' },
          { key: 'our_contact', label: 'Our contact', party: 'employee' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.party)).toEqual(['counterparty', 'employee']);
  });

  it('falls back to the key when the model gives no label', () => {
    // Mutation: allow an absent label through as undefined. The editor's label
    // input becomes uncontrolled and React warns on first keystroke.
    const res = parseTemplateProposal(
      reply({ body: '{{po_number}}', fields: [{ key: 'po_number' }] }),
    );
    expect(res?.fields[0].label).toBe('po_number');
  });
});

describe('parseTemplateProposal: signatures', () => {
  it('flips delivery mode to signature when the body carries a signature line', () => {
    // Mutation: return a fixed 'share'. A document the firm uploaded because
    // it has to be signed would go out as a read-only link.
    const res = parseTemplateProposal(
      reply({
        body: 'The parties agree.\n\nSignature: ______________\nDate: {{signed_on}}',
        fields: [{ key: 'signed_on', label: 'Date signed', type: 'date' }],
      }),
    );
    expect(res?.deliveryMode).toBe('signature');
    expect(res?.notes.some((n) => /signature/i.test(n))).toBe(true);
  });

  it('reads IN WITNESS WHEREOF as a signature line', () => {
    // Mutation: delete the witness-clause matcher. The commonest execution
    // clause in a firm's own precedents stops being recognised.
    const res = parseTemplateProposal(
      reply({ body: 'IN WITNESS WHEREOF the parties have executed this deed.\n\n{{a_key}}' }),
    );
    expect(res?.deliveryMode).toBe('signature');
  });

  it('stays on share when the model claims signature but the body has none', () => {
    // Mutation: read deliveryMode from the parsed reply instead of deriving it
    // from the body. The model's unchecked claim then decides how a document
    // leaves the building, which is the whole thing this module exists to stop.
    const res = parseTemplateProposal(
      reply({
        body: 'Please acknowledge receipt of the handbook on {{ack_date}}.',
        fields: [{ key: 'ack_date', label: 'Date', type: 'date' }],
        deliveryMode: 'signature',
      }),
    );
    expect(res?.deliveryMode).toBe('share');
  });

  it('takes a signature placeholder out of the body and never offers it as a field', () => {
    // Mutation: leave {{employee_signature}} in the body. The editor derives
    // its fields FROM the body, so it reappears as a text input in which a
    // signature is typed, a second place deciding where a signature goes.
    const res = parseTemplateProposal(
      reply({
        body: 'Employee: {{employee_name}}\nSigned: {{employee_signature}}',
        fields: [
          { key: 'employee_name', label: 'Employee name' },
          { key: 'employee_signature', label: 'Signature' },
        ],
      }),
    );
    expect(res?.body).not.toContain('employee_signature');
    expect(res?.fields.map((f) => f.key)).toEqual(['employee_name']);
    expect(res?.deliveryMode).toBe('signature');
    expect(res?.notes.some((n) => n.includes('employee_signature'))).toBe(true);
  });

  it('does not also report a removed signature field as a missing placeholder', () => {
    // Mutation: let a signature key fall through into `unusable`. The reviewer
    // is then told the same field both was removed on purpose and had no
    // placeholder, and goes looking for a blank that was never missing.
    const res = parseTemplateProposal(
      reply({
        body: 'Employee: {{employee_name}}\nSigned: {{employee_signature}}',
        fields: [
          { key: 'employee_name', label: 'Employee name' },
          { key: 'employee_signature', label: 'Signature' },
          { key: 'governing_law', label: 'Governing law' },
        ],
      }),
    );
    const missing = res!.notes.filter((n) => n.includes('no matching placeholder'));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('governing_law');
    expect(missing[0]).not.toContain('employee_signature');
  });

  it('leaves a date field whose name merely mentions signing alone', () => {
    // Mutation: widen the signature-placeholder rule to any key containing
    // "sign". {{signature_date}} disappears from the body and the document
    // loses the date it is signed on.
    const res = parseTemplateProposal(
      reply({
        body: 'Dated {{signature_date}} by {{signatory_name}}.',
        fields: [
          { key: 'signature_date', label: 'Date signed', type: 'date' },
          { key: 'signatory_name', label: 'Signatory' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.key)).toEqual(['signature_date', 'signatory_name']);
    expect(res?.body).toContain('{{signature_date}}');
  });

  it('stays on share for a document with no signature anywhere', () => {
    // Mutation: default deliveryMode to 'signature'. Every uploaded handout
    // would be proposed as something to send out for signature.
    const res = parseTemplateProposal(
      reply({
        body: 'Expense claim for {{claimant_name}}, total {{amount}}.',
        fields: [
          { key: 'claimant_name', label: 'Claimant' },
          { key: 'amount', label: 'Amount' },
        ],
      }),
    );
    expect(res?.deliveryMode).toBe('share');
  });
});

describe('parseTemplateProposal: notes', () => {
  it('forwards the model notes as plain strings, capped', () => {
    // Mutation: forward `parsed.notes` unchanged. A non-string entry reaches
    // the editor and React throws when it tries to render an object.
    const res = parseTemplateProposal(
      reply({
        body: '{{a_key}}',
        fields: [{ key: 'a_key', label: 'A' }],
        notes: ['Two blanks were ambiguous.', { text: 'nope' }, 42, '   '],
      }),
    );
    expect(res?.notes.every((n) => typeof n === 'string' && n.length > 0)).toBe(true);
    expect(res?.notes).toContain('Two blanks were ambiguous.');
  });

  it('says which suggested fields were dropped', () => {
    // Mutation: drop the reporting note. The reviewer is shown a shorter field
    // list than the model proposed with nothing saying why.
    const res = parseTemplateProposal(
      reply({
        body: 'Recipient: {{recipient}}',
        fields: [
          { key: 'recipient', label: 'Recipient' },
          { key: 'ghost_field', label: 'Ghost' },
        ],
      }),
    );
    expect(res?.notes.some((n) => n.includes('ghost_field'))).toBe(true);
  });
});
