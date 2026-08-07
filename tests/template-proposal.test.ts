import { describe, it, expect } from 'vitest';
import { parseTemplateProposal } from '../lib/template-proposal';
import {
  NDA_MODEL_REPLY,
  NDA_SOURCE_EXCERPT,
  NDA_SOURCE_EXECUTION_PAGE,
} from './fixtures/zinpro-nda';

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

  it('caps the field list at forty, as the template writer does, and says so', () => {
    // Mutation: remove the cap. sanitizeFields would silently discard the tail
    // on save, so the reviewer would configure rows that never persist.
    // Second mutation: remove the note. Five fields vanish with nothing on the
    // page saying any did.
    const keys = Array.from({ length: 45 }, (_, i) => `field_${i}`);
    const res = parseTemplateProposal(
      reply({
        body: keys.map((k) => `{{${k}}}`).join(' '),
        fields: keys.map((k) => ({ key: k, label: k })),
      }),
    );
    expect(res?.fields).toHaveLength(40);
    expect(res?.notes.some((n) => /only the first 40/i.test(n))).toBe(true);
  });

  it('filters before it caps, so junk cannot crowd out real fields', () => {
    // Mutation: cap the RAW list before filtering, which is what this module
    // did. Forty entries with no placeholder behind them consume every slot,
    // the two real fields are never reached, and nothing is reported. The
    // editor then re-derives both keys from the body with default settings,
    // which silently turns a counterparty blank into one the employee is asked
    // to fill.
    const junk = Array.from({ length: 40 }, (_, i) => ({ key: `ghost_${i}`, label: 'Ghost' }));
    const res = parseTemplateProposal(
      reply({
        body: 'Real: {{their_address}} and {{our_contact}}',
        fields: [
          ...junk,
          { key: 'their_address', label: 'Their address', party: 'counterparty' },
          { key: 'our_contact', label: 'Our contact', party: 'employee' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.key)).toEqual(['their_address', 'our_contact']);
    expect(res?.fields[0].party).toBe('counterparty');
  });
});

/**
 * The only placeholder form mergeTemplateDocument can substitute. It runs
 * `text.split('{{' + key + '}}')`, which is exact, case sensitive and
 * whitespace intolerant, and sanitizeFields stores keys narrowed to
 * [a-z0-9_] and 40 characters. Anything else prints on the finished
 * instrument exactly as written.
 */
const MERGEABLE = /^\{\{[a-z0-9_]{1,40}\}\}$/;
const ANY_PLACEHOLDER = /\{\{[^}]*\}\}/g;

describe('parseTemplateProposal: placeholders the merger can actually honour', () => {
  it('normalizes a placeholder written with inner spaces', () => {
    // Mutation: match placeholders loosely and never rewrite the body. The
    // body keeps "{{ counterparty_name }}", which mergeTemplateDocument cannot
    // match, so the braces print verbatim on the merged instrument.
    const res = parseTemplateProposal(
      reply({
        body: 'This agreement is with {{ counterparty_name }}.',
        fields: [{ key: 'counterparty_name', label: 'Other side' }],
      }),
    );
    expect(res?.body).toContain('{{counterparty_name}}');
    expect(res?.body).not.toContain('{{ counterparty_name }}');
    expect(res?.fields.map((f) => f.key)).toEqual(['counterparty_name']);
  });

  it('normalizes a capitalised placeholder', () => {
    // Mutation: lowercase the field key but leave the body alone. The merge
    // misses, the placeholder prints verbatim, and the answer the employee
    // typed is discarded.
    const res = parseTemplateProposal(
      reply({
        body: 'Employee: {{Employee_Name}}',
        fields: [{ key: 'Employee_Name', label: 'Employee name' }],
      }),
    );
    expect(res?.body).toContain('{{employee_name}}');
    expect(res?.body).not.toContain('{{Employee_Name}}');
    expect(res?.fields.map((f) => f.key)).toEqual(['employee_name']);
  });

  it('truncates an over-long placeholder in the body as well as in the field', () => {
    // Mutation: narrow only the field key. The 44-character placeholder stays
    // in the body, extractKeys re-derives it, sanitizeFields stores the
    // 40-character truncation, and the merge misses. For a counterparty field
    // that means no marker, so no field box is recorded, so the other side is
    // never given a blank to type into on a document sent for signature.
    const long = 'counterparty_registered_office_address_line'; // 43
    const key = `${long}x`; // 44
    const res = parseTemplateProposal(
      reply({
        body: `Address: {{${key}}}`,
        fields: [{ key, label: 'Address', party: 'counterparty' }],
      }),
    );
    expect(res?.body).not.toContain(key);
    expect(res?.fields[0].key).toHaveLength(40);
    expect(res?.body).toContain(`{{${res!.fields[0].key}}}`);
  });

  it('leaves a brace pair with no usable key in it alone, and does not swallow text', () => {
    // The rewrite pattern is deliberately loose so it can repair "{{Company
    // Name}}". Mutation: let it span braces or newlines, or rewrite a pair
    // with nothing usable in it. Either way it eats the document's own text
    // between two placeholders, which is the one thing this module must never
    // do.
    const res = parseTemplateProposal(
      reply({
        body: 'Start {{a_key}} middle text {{b_key}} end {{***}} done.',
        fields: [
          { key: 'a_key', label: 'A' },
          { key: 'b_key', label: 'B' },
        ],
      }),
    );
    expect(res?.body).toBe('Start {{a_key}} middle text {{b_key}} end {{***}} done.');
    expect(res?.fields.map((f) => f.key)).toEqual(['a_key', 'b_key']);
  });

  it('leaves every placeholder in the body in a form the merger can substitute', () => {
    // Mutation: any loosening of the normalization. This is the invariant the
    // three tests above are instances of, and it is the direction the module
    // was missing: fields were checked against the body, and the body was
    // never checked against what the merger can read.
    const res = parseTemplateProposal(
      reply({
        body: 'A {{ spaced_key }} B {{MixedCase}} C {{good_key}} D {{Another Key}}',
        fields: [{ key: 'good_key', label: 'Good' }],
      }),
    );
    for (const found of res!.body.match(ANY_PLACEHOLDER) ?? []) {
      expect(found).toMatch(MERGEABLE);
    }
  });
});

describe('parseTemplateProposal: a reserved key aimed at the other side', () => {
  it('renames it in the body and keeps the field', () => {
    // Mutation: drop the field and leave the placeholder, which is what this
    // module did before. mergeTemplateDocument substitutes a reserved key that
    // no field declares with the firm's OWN name, so the instrument reads
    // "between Zinpro Corporation and Zinpro Corporation". That is the failure
    // the RESERVED_FIRM_KEYS comment records having already reached a client.
    const res = parseTemplateProposal(
      reply({
        body: 'Between the firm and {{company_name}} of {{company_address}}.',
        fields: [
          { key: 'company_name', label: 'Company legal name', party: 'counterparty' },
          { key: 'company_address', label: 'Company address', party: 'counterparty' },
        ],
      }),
    );
    expect(res?.body).not.toContain('{{company_name}}');
    expect(res?.body).toContain('{{counterparty_company_name}}');
    const renamed = res!.fields.find((f) => f.key === 'counterparty_company_name');
    expect(renamed).toBeDefined();
    expect(renamed!.party).toBe('counterparty');
    expect(renamed!.label).toBe('Company legal name');
    expect(res?.notes.some((n) => n.includes('{{counterparty_company_name}}'))).toBe(true);
  });

  it('does not collide the rename into a key the body already uses', () => {
    // Mutation: return the prefixed name without checking what the body
    // already contains. Two different blanks, the Company's legal name and its
    // trading name, become one placeholder, so one answer overwrites the other
    // everywhere on the instrument.
    const res = parseTemplateProposal(
      reply({
        body: 'Between {{company_name}} trading as {{counterparty_company_name}}.',
        fields: [
          { key: 'company_name', label: 'Legal name', party: 'counterparty' },
          { key: 'counterparty_company_name', label: 'Trading name', party: 'counterparty' },
        ],
      }),
    );
    const keys = res!.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(res!.body).toContain(`{{${key}}}`);
  });

  it('does not rename one the model did not aim at the other side', () => {
    // Mutation: rename every reserved key a field mentions. {{firm_name}} is
    // the firm's own name filling itself in, which is the whole reason the
    // reserved list exists, and renaming it turns a self-filling placeholder
    // into an empty required input.
    const res = parseTemplateProposal(
      reply({
        body: '{{firm_name}} agrees with {{other_key}}.',
        fields: [
          { key: 'firm_name', label: 'Firm name', party: 'employee' },
          { key: 'other_key', label: 'Other' },
        ],
      }),
    );
    expect(res?.body).toContain('{{firm_name}}');
    expect(res?.fields.map((f) => f.key)).toEqual(['other_key']);
    expect(res?.notes.some((n) => /rename/i.test(n))).toBe(true);
  });
});

describe('parseTemplateProposal: blanks that are not signature lines', () => {
  it('keeps an operative blank and says it kept it', () => {
    // Mutation: strip every run of underscores unconditionally. "The Term of
    // this Agreement is ______ months" silently loses its term, and the note
    // calls it a signature rule, so the reviewer never goes looking.
    const res = parseTemplateProposal(
      reply({
        body: 'The Term of this Agreement is __________ months and the fee is $__________ per month.',
      }),
    );
    expect(res?.body).toContain('The Term of this Agreement is __________ months');
    expect(res?.body).toContain('$__________ per month');
    expect(res?.notes.some((n) => /Left 2 blank/.test(n))).toBe(true);
  });

  it('still strips the blank a party signs on', () => {
    // Mutation: keep every blank. The source's own rule survives beside the
    // block mergeTemplateDocument appends and each signer gets two places to
    // sign, only one of which is stamped and recorded.
    const res = parseTemplateProposal(
      reply({ body: 'The parties have executed this deed. By: _______________________ Name: {{a_key}}' }),
    );
    expect(res?.body).not.toMatch(/_{6,}/);
    expect(res?.notes.some((n) => /Removed 1 ruled blank/.test(n))).toBe(true);
  });

  it('judges a blank by what comes immediately before it', () => {
    // The other two tests can both be decided by what FOLLOWS the blank
    // ("Name:"), so neither exercises the preceding window. Here nothing
    // follows the rule but ordinary prose, and only "By:" in front of it says
    // this is where somebody signs.
    //
    // Mutation: widen the window to the whole body. The anchored test then
    // reads the end of the document instead of the run's own surroundings, and
    // a signature rule survives into a document that already has one.
    const res = parseTemplateProposal(
      reply({ body: 'Executed by the parties. By: ______________ and dated accordingly. {{a_key}}' }),
    );
    expect(res?.body).not.toMatch(/_{6,}/);
    expect(res?.notes.some((n) => /Removed 1 ruled blank/.test(n))).toBe(true);
  });

  it('tells the two apart in one document', () => {
    // Mutation: decide by the whole body rather than by each blank's
    // surroundings. Either the term blank goes or the signature rule stays,
    // and both are defects this module is meant to prevent.
    const res = parseTemplateProposal(
      reply({ body: 'Term: __________ months. Signed, By: ____________ Name: {{a_key}}' }),
    );
    expect(res?.body).toContain('Term: __________ months');
    expect(res?.body).not.toContain('By: ____________');
    expect(res?.notes.some((n) => /Removed 1 ruled blank/.test(n))).toBe(true);
    expect(res?.notes.some((n) => /Left 1 blank/.test(n))).toBe(true);
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

  it('leaves an ordinary date and the signatory name alone', () => {
    // Mutation: widen the execution-furniture rule to any key containing
    // "sign" or ending "_date". The commencement date and the name of the
    // person signing both vanish from a document that genuinely asks for them.
    const res = parseTemplateProposal(
      reply({
        body: 'Dated {{effective_date}} by {{signatory_name}}, starting {{start_date}}.',
        fields: [
          { key: 'effective_date', label: 'Effective date', type: 'date' },
          { key: 'signatory_name', label: 'Signatory' },
          { key: 'start_date', label: 'Start date', type: 'date' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.key)).toEqual([
      'effective_date',
      'signatory_name',
      'start_date',
    ]);
    expect(res?.body).toContain('{{effective_date}}');
  });

  it('takes a per-party signature date out too, because the platform dates the block', () => {
    // Mutation: delete SIGNATURE_DATE_KEY. mergeTemplateDocument appends its
    // own Date: line per party, so the executed instrument then carries two
    // dates for each signer with no rule saying which one governs.
    const res = parseTemplateProposal(
      reply({
        body: 'Name: {{company_signatory_name}} Date: {{company_signature_date}}',
        fields: [
          { key: 'company_signatory_name', label: 'Signatory' },
          { key: 'company_signature_date', label: 'Date signed', type: 'date' },
        ],
      }),
    );
    expect(res?.fields.map((f) => f.key)).toEqual(['company_signatory_name']);
    expect(res?.body).not.toContain('company_signature_date');
    expect(res?.deliveryMode).toBe('signature');
  });

  it('reads a ruled blank as a signature line', () => {
    // Mutation: delete the ruled-blank branch of describeSignatureEvidence. A
    // "By: ____" execution block, which is what most agreements actually
    // carry, stops being recognised at all.
    const res = parseTemplateProposal(
      reply({ body: 'The parties have executed this deed. By: _______________________ Name: {{a_key}}' }),
    );
    expect(res?.deliveryMode).toBe('signature');
  });

  it('strips a ruled blank out of the proposed body', () => {
    // Mutation: stop replacing runs of six or more underscores. The source's
    // own rule survives next to the block mergeTemplateDocument appends, so
    // every signer gets a second place to sign that is neither stamped nor
    // recorded, which is the defect lib/signature-geometry.ts exists to stop.
    const res = parseTemplateProposal(
      reply({ body: 'By: _______________________________ Name: {{a_key}}' }),
    );
    expect(res?.body).not.toMatch(/_{6,}/);
    expect(res?.body).toContain('Name: {{a_key}}');
    expect(res?.notes.some((n) => /Removed \d+ ruled blank/.test(n))).toBe(true);
  });

  it('reads a signature line out of the SOURCE when the model returned none', () => {
    // Mutation: ignore the `source` argument. Detection falls back to what the
    // model chose to emit, which is the thing this module exists not to trust:
    // a model that quietly drops the execution page takes signature mode with
    // it, and the document goes out as a read-only link.
    const clean = reply({
      body: 'Acknowledgement by {{a_key}}.',
      fields: [{ key: 'a_key', label: 'A' }],
    });
    expect(parseTemplateProposal(clean)?.deliveryMode).toBe('share');
    expect(
      parseTemplateProposal(clean, 'The parties have executed this deed. By: __________________')
        ?.deliveryMode,
    ).toBe('signature');
  });

  it('reads a reference to a signature page as evidence', () => {
    // Mutation: delete the signature-page branch. "[Signature Page Follows]" is
    // left in the body as an extraction artifact on purpose, and dropping this
    // branch throws away the one useful thing it tells us.
    const res = parseTemplateProposal(
      reply({ body: 'This Agreement may be executed in counterparts. [Signature Page Follows] {{a_key}}' }),
    );
    expect(res?.deliveryMode).toBe('signature');
  });

  it('finds a signature line in text that has no line breaks at all', () => {
    // Mutation: keep only the line-anchored SIGNATURE_LINE scan. unpdf returns
    // a PDF as ONE line, so an anchored scan matches nothing on any real
    // uploaded agreement, which is exactly how a mutual NDA carrying two
    // signature blocks was classified as a read-only share.
    const oneLine =
      'MUTUAL NONDISCLOSURE AGREEMENT ... 20. Counterparts. ' +
      'The parties have executed this Agreement. Signature: Name: Title: Date: {{a_key}}';
    expect(parseTemplateProposal(reply({ body: oneLine }))?.deliveryMode).toBe('signature');
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

describe('parseTemplateProposal: the real Zinpro mutual NDA', () => {
  const proposal = parseTemplateProposal(NDA_MODEL_REPLY, NDA_SOURCE_EXCERPT);

  it('produces a proposal at all', () => {
    // Mutation: any change that makes the fenced reply unparseable. This is
    // the guard rail for the eight assertions below.
    expect(proposal).not.toBeNull();
  });

  it('sends a mutual NDA out for signature, not as a read-only share', () => {
    // Mutation: return a fixed 'share', or drop the ruled-blank branch. This
    // is the defect the live run found: a document whose whole purpose is that
    // the other company signs it was classified as a read-only link, and a
    // share-mode document renders the counterparty markers on the page the
    // recipient reads.
    expect(proposal!.deliveryMode).toBe('signature');
  });

  it('leaves no ruled blank in the body for a second, unrecorded signature', () => {
    // Mutation: stop stripping runs of six or more underscores. The source
    // carries "By: ___..." before BOTH name blocks and mergeTemplateDocument
    // appends one execution block per party, so each signer would get two
    // places to sign and only one of them is stamped and recorded.
    expect(NDA_SOURCE_EXECUTION_PAGE).toMatch(/_{6,}/);
    expect(proposal!.body).not.toMatch(/_{6,}/);
  });

  it('keeps the proposed fields minus the two per-party signature dates', () => {
    // Mutation: delete SIGNATURE_DATE_KEY. Both date blanks come back and the
    // executed instrument carries two dates per party.
    expect(proposal!.fields.map((f) => f.key)).toEqual([
      'counterparty_company_name',
      'company_address',
      'company_signatory_name',
      'company_signatory_title',
      'company_email',
      'zinpro_signatory_name',
      'zinpro_signatory_title',
    ]);
  });

  it('warns that the model used a reserved key for the OTHER party', () => {
    // The model proposed {{company_name}} for the counterparty, and
    // company_name is a RESERVED_FIRM_KEY: mergeTemplateDocument substitutes it
    // with the firm's OWN name wherever it appears. Left alone, this NDA would
    // name Zinpro as the Company, which is the exact failure the
    // RESERVED_FIRM_KEYS comment records having already shipped once.
    //
    // Mutation: soften the reserved note back to "it was left out of the field
    // list". The field is still dropped, so nothing looks wrong, and the
    // placeholder quietly stays in the body doing the wrong substitution.
    expect(proposal!.fields.map((f) => f.key)).not.toContain('company_name');
    const warning = proposal!.notes.find((n) => n.includes('{{company_name}}'));
    expect(warning).toBeDefined();
    expect(warning).toMatch(/rename/i);
    expect(warning).toMatch(/other side|other party/i);
  });

  it('keeps the field split the model got right', () => {
    // Mutation: coerce party, or drop it. The live run got every party correct
    // and that judgement is the substance of the feature; nothing added for
    // the defects above may quietly throw it away.
    const party = Object.fromEntries(proposal!.fields.map((f) => [f.key, f.party]));
    expect(party.company_address).toBe('counterparty');
    expect(party.company_signatory_name).toBe('counterparty');
    expect(party.zinpro_signatory_name).toBe('employee');
    expect(party.zinpro_signatory_title).toBe('employee');
  });

  it('keeps the wording of the instrument intact', () => {
    // Mutation: strip whole lines rather than only the ruled blanks. Removing
    // a signature line by the line would take the clause text with it.
    expect(proposal!.body).toContain('20. Counterparts.');
    expect(proposal!.body).toContain('The parties have executed this Mutual Nondisclosure Agreement');
    expect(proposal!.body).toContain('ZINPRO CORPORATION');
    expect(proposal!.body).toContain('7500 Flying Cloud Dr., Suite 800, Eden Prairie, MN 55344');
  });

  it('tells the reviewer what it removed and why', () => {
    // Mutation: delete the removal notes. The body quietly differs from the
    // document the reviewer uploaded, with nothing on the page saying so.
    expect(proposal!.notes.some((n) => /Removed 2 ruled blanks/.test(n))).toBe(true);
    expect(proposal!.notes.some((n) => n.includes('company_signature_date'))).toBe(true);
    expect(proposal!.notes.some((n) => /signature/i.test(n))).toBe(true);
  });

  it('leaves every placeholder in a form mergeTemplateDocument can substitute', () => {
    // Mutation: loosen the normalization. This is the real document, so it is
    // the one that matters: a placeholder the merger cannot match prints its
    // own braces on an executed instrument, and for a counterparty field it
    // also means no marker, no recorded box, and no blank for the other side
    // to type into.
    for (const found of proposal!.body.match(ANY_PLACEHOLDER) ?? []) {
      expect(found).toMatch(MERGEABLE);
    }
    for (const field of proposal!.fields) {
      expect(proposal!.body).toContain(`{{${field.key}}}`);
    }
  });

  it('renames the reserved key the model aimed at the Company', () => {
    // Mutation: go back to dropping the field and leaving the placeholder.
    // Verified merger output was "between Zinpro Corporation and Anderson
    // Foundation", the firm named as its own counterparty.
    expect(proposal!.body).not.toContain('{{company_name}}');
    expect(proposal!.body).toContain('{{counterparty_company_name}}');
    expect(proposal!.fields.map((f) => f.key)).toContain('counterparty_company_name');
  });

  it('leaves the PDF extraction artifacts in the body, deliberately', () => {
    // NOT a defect being fixed here, and this assertion is the record of that
    // decision. "[Signature Page Follows]", the truncated running header and
    // the inline page numbers are artifacts of reading a PDF, so they belong
    // to extraction (lib/doc-review.ts), which still knows where the page
    // boundaries were. By the time text reaches this module those boundaries
    // are gone and any rule here would be guessing which bracketed phrase is
    // furniture and which is the instrument's own wording. Guessing wrong
    // deletes a clause. The reviewer sees these and removes them.
    //
    // Mutation: start stripping bracketed phrases here. This test goes red and
    // whoever wrote it has to say why deleting text on a guess is now safe.
    expect(proposal!.body).toContain('[Signature Page Follows]');
    expect(proposal!.body).toContain('[Signature page to Mutual Nondisclosure');
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
