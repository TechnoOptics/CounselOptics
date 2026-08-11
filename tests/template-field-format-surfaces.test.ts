import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FieldsTab } from '../app/counsel/forms/fields-tab';
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FIELD_TYPE_LABELS,
} from '../lib/template-field-formats';
import type { TemplateField } from '../lib/firm-templates';

/**
 * A format that can be configured but not filled in is decoration.
 *
 * Three surfaces carry one field: the counsel editor where the legal team
 * chooses the format, the Hub form where a colleague answers it, and the
 * signing page where the other side answers theirs. This file holds each of
 * them to the one rule module, so a format cannot exist on one and not the
 * others.
 *
 * The editor is RENDERED, because it can be: the section is markup over props.
 * The other two are read as source, the same way tests/employee-form-intent.ts
 * reads them, because both pull in server actions, next/navigation and the
 * signature pad, and a harness large enough to mount them would be testing the
 * harness.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const FILL_FORM = 'app/portal/forms/[id]/form-fill-client.tsx';
const SIGNING_PAGE = 'app/sign/[token]/counterparty-fields.tsx';

describe('the counsel editor offers every format', () => {
  const fields: TemplateField[] = [
    { key: 'client', label: 'Client', type: 'text', required: true },
  ];

  const markup = () =>
    renderToStaticMarkup(
      createElement(FieldsTab, {
        busy: false,
        hasBody: true,
        deliveryMode: 'share',
        fields,
        setFieldMeta: () => {},
        addable: [],
        unnamed: [],
        fillDetectedCount: 0,
        fromDetection: new Set<string>(),
        onAccept: () => {},
        onDismiss: () => {},
      }),
    );

  /**
   * Driven by the union, not by a list written here. A format added to
   * TEMPLATE_FIELD_TYPES with no option in the editor fails this, which is the
   * half of the trap the whitelist alone does not cover: the store would keep
   * it and no author could ever pick it.
   */
  it('has an option for each one, labelled from the shared list', () => {
    const html = markup();
    for (const type of TEMPLATE_FIELD_TYPES) {
      expect(html).toContain(`value="${type}"`);
      expect(html).toContain(TEMPLATE_FIELD_TYPE_LABELS[type]);
    }
  });

  /**
   * The Fields section is where an author goes looking for a way to add a
   * signature, so it is where the answer belongs. Without it the only signal
   * is the absence of an option, which reads as a missing feature.
   */
  it('says where a signature comes from, rather than offering one as a format', () => {
    const html = markup();
    expect(html).not.toContain('value="signature"');
    expect(html).toMatch(/[Ss]ignature section/);
  });
});

describe('the Hub form a colleague fills in', () => {
  const source = read(FILL_FORM);

  /**
   * The attributes have to reach the input, not merely be computed.
   *
   * The first version of this asserted only that the module was imported, and
   * a mutation that replaced the input's own `type` with the old
   * `field.type === 'date' ? 'date' : 'text'` left the call sitting there
   * unused and this green. A guard satisfied by a call whose result is thrown
   * away is not a guard.
   */
  it('puts the shared type and keyboard on the input itself', () => {
    expect(source).toContain('templateFieldInputAttributes');
    expect(source).toContain('inputMode={attrs.inputMode}');
    expect(source).toContain('attrs.type');
    expect(source).not.toMatch(/type=\{f(ield)?\.type === 'date'/);
  });

  it('checks the answer with the same rule the server refuses on', () => {
    expect(source).toContain('invalidFieldValues');
  });

  /**
   * An error nobody can hear is an error nobody has. aria-describedby is what
   * makes the sentence under an input belong to that input for a screen
   * reader; aria-invalid is what says the input is the one at fault.
   */
  it('associates each error with its own input', () => {
    expect(source).toContain('aria-describedby');
    expect(source).toContain('aria-invalid');
  });

  it('will not send an answer that does not fit', () => {
    // `ready` is the one expression the send and export buttons are disabled
    // on. A check that did not reach it would be a red sentence beside a
    // working button.
    const ready = /const ready =[\s\S]*?;\n/.exec(source)?.[0] ?? '';
    expect(ready).toContain('formatProblems.length === 0');
  });
});

describe('the signing page the other side fills in', () => {
  const source = read(SIGNING_PAGE);

  /**
   * The attributes have to reach the input, not merely be computed.
   *
   * The first version of this asserted only that the module was imported, and
   * a mutation that replaced the input's own `type` with the old
   * `field.type === 'date' ? 'date' : 'text'` left the call sitting there
   * unused and this green. A guard satisfied by a call whose result is thrown
   * away is not a guard.
   */
  it('puts the shared type and keyboard on the input itself', () => {
    expect(source).toContain('templateFieldInputAttributes');
    expect(source).toContain('inputMode={attrs.inputMode}');
    expect(source).toContain('attrs.type');
    expect(source).not.toMatch(/type=\{f(ield)?\.type === 'date'/);
  });

  it('checks the answer with the same rule the server refuses on', () => {
    expect(source).toContain('invalidFieldValues');
  });

  it('associates each error with its own input', () => {
    expect(source).toContain('aria-describedby');
    expect(source).toContain('aria-invalid');
  });
});

describe('the template list counts every format', () => {
  it('builds its chips from the shared list rather than a copy of it', () => {
    const source = read('app/counsel/forms/template-cards.tsx');
    expect(source).toContain('TEMPLATE_FIELD_TYPES');
    expect(source).not.toMatch(/type: 'textarea', label:/);
  });
});
