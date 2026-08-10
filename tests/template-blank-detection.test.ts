import { describe, it, expect } from 'vitest';
import {
  applyBlankSuggestion,
  detectSignatureEvidence,
  detectTemplateBlanks,
  removeRuledBlank,
} from '../lib/template-blank-detection';
import { counterpartyMarker } from '../lib/template-field-boxes';

/**
 * The detector behind the counsel template editor's suggestion panel.
 *
 * Every assertion below is written against a body an author could plausibly
 * paste in, and each test names the mutation it is defending against, because a
 * test that passes with the rule deleted is not a test.
 *
 * The thing being protected is asymmetric and worth stating once. A blank this
 * misses costs an author one hand-typed `{{placeholder}}`, which is exactly what
 * they do today. A blank it names WRONGLY is a field on a legal instrument that
 * describes a different part of the agreement, so the rules err toward "found a
 * blank, cannot name it" rather than toward a plausible guess.
 */

describe('detectTemplateBlanks', () => {
  it('names a labelled blank and proposes the key a field would carry', () => {
    // Mutation: drop LABEL_BEFORE and return a null key for everything. The
    // panel then finds every blank in the document and can offer to fix none of
    // them, which is the state the editor is already in without this module.
    const blanks = detectTemplateBlanks('Recipient Name: ______________ of the second part.');
    expect(blanks).toHaveLength(1);
    expect(blanks[0].kind).toBe('fill');
    expect(blanks[0].label).toBe('Recipient Name');
    expect(blanks[0].key).toBe('recipient_name');
    expect(blanks[0].type).toBe('text');
  });

  it('reads a blank labelled "By:" as a place to sign and refuses to key it', () => {
    // Mutation: delete the SIGNATURE_LABEL branch so every labelled blank is a
    // fill. "By: ______" then comes back as an addable field keyed `by`, and an
    // author who accepts it puts a text input on the instrument that somebody
    // types a signature into, next to the block mergeTemplateDocument appends.
    // That is the exact defect lib/template-proposal.ts strips out of an
    // imported body.
    const blanks = detectTemplateBlanks('IN WITNESS WHEREOF.\n\nBy: __________________________');
    expect(blanks).toHaveLength(1);
    expect(blanks[0].kind).toBe('signature');
    expect(blanks[0].key).toBeNull();
  });

  it.each([
    ['Signature: ____________', 'signature'],
    ['Signed by: ____________', 'signed by'],
    ['/s/ ____________', '/s/'],
    ['Authorized Signatory: ____________', 'authorized signatory'],
    ['Witnessed by: ____________', 'witnessed by'],
    ['Date Signed: ____________', 'date signed'],
  ])('reads %j as a signature place', (body) => {
    // Mutation: narrow SIGNATURE_LABEL to the single word "signature". Every
    // other real-world spelling of an execution line becomes an addable field.
    // Date Signed is in this list because mergeTemplateDocument appends its own
    // Date: line per party, and a second one puts two dates on an executed
    // instrument with no rule saying which governs.
    const blanks = detectTemplateBlanks(body);
    expect(blanks).toHaveLength(1);
    expect(blanks[0].kind).toBe('signature');
  });

  it('keeps an ordinary date blank as a fill and types it as a date', () => {
    // Mutation: widen SIGNING_DATE_LABEL to anything containing "date". The
    // commencement date of the agreement is then classified as execution
    // furniture, offered as nothing, and silently lost from the field list.
    const blanks = detectTemplateBlanks('Effective Date: __________');
    expect(blanks[0].kind).toBe('fill');
    expect(blanks[0].key).toBe('effective_date');
    expect(blanks[0].type).toBe('date');
  });

  it('refuses to read a whole clause as a label', () => {
    // Mutation: go back to a single leftmost-first regex for the label. Regex
    // alternation matches at the earliest position that can match, so
    // /([A-Za-z][\w ]{0,48})\s*:\s*$/ captures the entire clause here and
    // proposes a forty-character key made of a sentence. That key is what the
    // signing page and the audit record would then carry as the name of the
    // blank, so the honest answer is that this one cannot be named.
    const blanks = detectTemplateBlanks(
      'This Agreement is effective on Effective Date: __________',
    );
    expect(blanks).toHaveLength(1);
    expect(blanks[0].key).toBeNull();
  });

  it('leaves an operative money blank alone rather than reading it as furniture', () => {
    // Mutation: classify every ruled blank as a signature. "the fee is $______
    // per month" is a term of the agreement, and losing it loses money from the
    // contract while the panel reports it as a signature rule, so nobody looks.
    const blanks = detectTemplateBlanks('The fee is $__________ per month for the Term.');
    expect(blanks).toHaveLength(1);
    expect(blanks[0].kind).toBe('fill');
    expect(blanks[0].inExecutionBlock).toBe(false);
  });

  it('marks a fill blank that sits inside an execution block', () => {
    // Mutation: hard-code inExecutionBlock to false. The printed-name blank
    // under a signature reads as an ordinary field, the author adds it, and the
    // executed copy carries the name twice: once where they typed it and once
    // on the line mergeTemplateDocument appends.
    const blanks = detectTemplateBlanks('By: ______________\nName: ______________');
    const name = blanks.find((b) => b.key === 'name');
    expect(name).toBeDefined();
    expect(name?.kind).toBe('fill');
    expect(name?.inExecutionBlock).toBe(true);
  });

  it('does not call a preamble field part of an execution block', () => {
    // Mutation: drop the proximity test and mark inExecutionBlock from the
    // label rules alone. EXECUTION_BEFORE matches anything ending "Name:", so
    // "Counterparty Name:" in the opening paragraph of a real NDA gets a
    // warning about signature blocks attached to the single most obviously
    // wanted field in the document. This was found by reading the output on a
    // real mutual NDA, not by a test, and a warning that fires on the preamble
    // is one an author learns to scroll past.
    const body =
      'Counterparty Name: ______________________\n\n' +
      '1. CONFIDENTIAL INFORMATION. Each party may disclose confidential '.repeat(6) +
      '\n\nIN WITNESS WHEREOF.\n\nBy: ______________';
    const blanks = detectTemplateBlanks(body);
    expect(blanks[0].key).toBe('counterparty_name');
    expect(blanks[0].inExecutionBlock).toBe(false);
    expect(blanks[1].kind).toBe('signature');
  });

  it('marks the signing date under a signature, which no label rule catches', () => {
    // Mutation: reuse EXECUTION_BEFORE as the whole label half. It has no
    // `date` in it, deliberately, because a date is usually a term of the
    // agreement, so the "Date:" line inside an execution block came back as an
    // ordinary addable field with nothing said. mergeTemplateDocument appends
    // its own Date: line per party, so accepting it puts two dates on an
    // executed instrument with no rule saying which governs. Found by reading
    // the output on a real mutual NDA.
    const blanks = detectTemplateBlanks(
      'By: ______________\nName: ______________\nTitle: ______________\nDate: ______________',
    );
    const date = blanks.find((b) => b.key === 'date');
    expect(date?.kind).toBe('fill');
    expect(date?.inExecutionBlock).toBe(true);
  });

  it('quotes two execution blocks so a reader can tell them apart', () => {
    // Mutation: quote a blind slice of the preceding characters. Both "By:"
    // rules of a mutual agreement then come back as the same fragment, each
    // carrying the tail of the previous blank's rule and running on into the
    // next blank's label, and the panel offers two identical looking rows with
    // a Remove button on each. Found by rendering the panel and reading it.
    const body =
      'ZINPRO CORPORATION\n\nBy: ______________\n\nCOUNTERPARTY\n\nBy: ______________';
    const [first, second] = detectTemplateBlanks(body);
    expect(first.context).not.toBe(second.context);
    expect(first.context).toContain('ZINPRO');
    expect(second.context).toContain('COUNTERPARTY');
  });

  it('quotes the surrounding words on one line', () => {
    // Mutation: keep the raw slice. The context exists so a person can find the
    // blank in their own document, and a fragment carrying two line breaks and
    // a party heading is harder to match against the page than the words either
    // side of the rule.
    const [blank] = detectTemplateBlanks('ZINPRO CORPORATION\n\nBy: ______________\n');
    expect(blank.context).not.toMatch(/\s\s|\n/);
    expect(blank.context).toContain('By:');
  });

  it('gives two blanks with the same label two different keys', () => {
    // Mutation: return the narrowed label as the key with no uniqueness check.
    // A mutual NDA names both parties with "Name:", and one shared key means one
    // field filling both sides of the agreement in with the same words.
    const blanks = detectTemplateBlanks('Name: __________\nName: __________');
    expect(blanks.map((b) => b.key)).toEqual(['name', 'name_2']);
  });

  it('does not propose a key the body already declares', () => {
    // Mutation: seed the taken set empty instead of from the body's existing
    // placeholders. Accepting the suggestion would write a second {{name}}, and
    // mergeTemplateDocument substitutes with split/join, so one typed value
    // would silently fill a blank on the other side of the document.
    const blanks = detectTemplateBlanks('Agreed by {{name}}.\n\nName: __________');
    expect(blanks[0].key).toBe('name_2');
  });

  it('reports an unlabelled blank but refuses to invent a name for it', () => {
    // Mutation: fall back to a positional key such as `blank_1`. The author
    // accepts a field whose key describes nothing, and the key is what the
    // signing page and the audit record carry.
    const blanks = detectTemplateBlanks('The parties agree that __________ shall apply.');
    expect(blanks).toHaveLength(1);
    expect(blanks[0].label).toBeNull();
    expect(blanks[0].key).toBeNull();
    expect(blanks[0].context).toContain('_');
  });

  it('reads a parenthetical label that follows the rule', () => {
    // Mutation: delete LABEL_AFTER. "__________ (Print Name)" is the commonest
    // unlabelled-looking execution line there is, and without this it comes back
    // un-nameable.
    const blanks = detectTemplateBlanks('__________________ (Print Name)');
    expect(blanks[0].key).toBe('print_name');
  });

  it('does not read a counterparty marker as a blank', () => {
    // Mutation: lower the threshold to five underscores. The marker
    // lib/template-field-boxes.ts writes for a recipient blank is
    // _____<<key>>_____, so the editor would report the product's own sentinel
    // as a document blank and offer to replace it, destroying the one thing the
    // renderer measures a field box from.
    //
    // Bound to counterpartyMarker itself rather than to a literal, so widening
    // MARKER_UNDERSCORE_RUN fails here instead of in production.
    expect(detectTemplateBlanks(`Signed for ${counterpartyMarker('entity_name')} today.`)).toEqual([]);
  });

  it('finds blanks in text with no line breaks at all', () => {
    // Mutation: switch the context windows from characters to lines.
    // extractFileText reads a PDF through unpdf with mergePages: true, which
    // returns the whole instrument as ONE line, so a line-based rule sees the
    // entire document as the context of every blank and classifies nothing.
    const oneLine =
      'MUTUAL NONDISCLOSURE AGREEMENT ... 20. Counterparts. ' +
      'By: ______________ Name: ______________ Title: ______________';
    const blanks = detectTemplateBlanks(oneLine);
    expect(blanks.map((b) => b.kind)).toEqual(['signature', 'fill', 'fill']);
    expect(blanks.map((b) => b.key)).toEqual([null, 'name', 'title']);
  });

  it('returns nothing for a body with no blanks in it', () => {
    // Mutation: return a placeholder entry when the scan finds none. The editor
    // would show a suggestion panel listing a blank that is not in the document.
    expect(detectTemplateBlanks('A plain acknowledgement with no blanks.')).toEqual([]);
    expect(detectTemplateBlanks('')).toEqual([]);
    expect(detectTemplateBlanks(null)).toEqual([]);
  });
});

describe('applyBlankSuggestion', () => {
  it('replaces only the rule and keeps the label the document wrote', () => {
    // Mutation: replace the whole matched line rather than the underscore run.
    // "Recipient Name: ______" becomes "{{recipient_name}}" and the words the
    // author drafted are gone from the instrument.
    const body = 'Recipient Name: ______________ of the second part.';
    const [blank] = detectTemplateBlanks(body);
    expect(applyBlankSuggestion(body, blank)).toBe(
      'Recipient Name: {{recipient_name}} of the second part.',
    );
  });

  it('refuses when the body has moved under the suggestion', () => {
    // Mutation: write at the recorded offset without checking what is there.
    // The offsets came from a scan of some earlier body, and an author who typed
    // in the meantime gets a placeholder inserted into the middle of a sentence
    // of a legal instrument.
    const body = 'Name: ______________';
    const [blank] = detectTemplateBlanks(body);
    expect(applyBlankSuggestion('A completely different body entirely.', blank)).toBeNull();
  });

  it('refuses a suggestion that has no key', () => {
    // Mutation: fall through and write `{{null}}` or `{{}}`. Neither is a
    // placeholder the merge can substitute, so it would print its own braces on
    // the finished document in front of the recipient.
    const body = 'The parties agree that __________ shall apply.';
    const [blank] = detectTemplateBlanks(body);
    expect(blank.key).toBeNull();
    expect(applyBlankSuggestion(body, blank)).toBeNull();
  });

  it('puts the second of two identical blanks in the right place', () => {
    // Mutation: locate the run with indexOf on the raw text instead of using the
    // recorded index. Both "Name:" blanks are the same string, so accepting the
    // second one would edit the first and the author would watch the wrong half
    // of a mutual agreement change.
    const body = 'Name: __________\nName: __________';
    const blanks = detectTemplateBlanks(body);
    expect(applyBlankSuggestion(body, blanks[1])).toBe('Name: __________\nName: {{name_2}}');
  });
});

describe('removeRuledBlank', () => {
  it('takes the rule out and leaves the line', () => {
    // Mutation: remove the whole line. "By: ______" is meant to become "By:",
    // which the author can still see and delete; taking the line takes the
    // execution block's own text with it.
    const body = 'By: __________________________';
    const [blank] = detectTemplateBlanks(body);
    expect(removeRuledBlank(body, blank)).toBe('By: ');
  });

  it('refuses when the body has moved under it', () => {
    // Mutation: skip the slice check. Same hazard as applyBlankSuggestion, with
    // the same consequence in the other direction: characters deleted from the
    // middle of a clause.
    const body = 'By: __________________________';
    const [blank] = detectTemplateBlanks(body);
    expect(removeRuledBlank('Something else now.', blank)).toBeNull();
  });
});

describe('detectSignatureEvidence', () => {
  it('reads an execution clause that carries no rule at all', () => {
    // Mutation: report evidence only when a ruled blank is present. A document
    // whose execution page says "IN WITNESS WHEREOF the parties have executed
    // this Agreement" and carries no underscores is still a document that gets
    // signed, and the editor would say nothing about it.
    expect(
      detectSignatureEvidence('IN WITNESS WHEREOF the parties have executed this Agreement.'),
    ).toBe('the words "in witness whereof"');
  });

  it('says nothing about a document with nothing to sign', () => {
    // Mutation: return a constant string. Every handout would prompt the author
    // to switch a read-only template over to signature.
    expect(detectSignatureEvidence('An expense policy with no execution page.')).toBeNull();
    expect(detectSignatureEvidence(null)).toBeNull();
  });
});
