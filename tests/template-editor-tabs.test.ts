import { describe, expect, it } from 'vitest';
import {
  EDITOR_TABS,
  blankIdentity,
  deriveFields,
  extractKeys,
  layoutOverride,
  nextTabIndex,
} from '../app/counsel/forms/template-editor-model';
import type { DetectedBlank } from '../lib/template-blank-detection';
import type { DocumentLayout } from '../lib/document-layout';

/**
 * The parts of the template editor that are decisions rather than markup.
 *
 * The editor is a client component and this suite runs in `environment:
 * node` with no DOM, so anything that has to be PROVEN rather than looked
 * at has to be a plain function living outside the JSX. That is the whole
 * reason this module exists: the tab keyboard map, the field derivation
 * and the layout override are all rules somebody can get wrong silently,
 * and none of them need a browser to be checked.
 */

describe('the editor tab strip', () => {
  it('offers the four sections in reading order', () => {
    // The order is the order the work is done in: write the document,
    // name what gets filled in, decide how it is signed, then look at it.
    expect(EDITOR_TABS).toEqual([
      'document',
      'fields',
      'signature',
      'preview',
    ]);
  });

  it('moves right and left with the arrow keys', () => {
    expect(nextTabIndex(0, 'ArrowRight', 4)).toBe(1);
    expect(nextTabIndex(2, 'ArrowLeft', 4)).toBe(1);
  });

  it('wraps at both ends rather than dead-ending', () => {
    expect(nextTabIndex(3, 'ArrowRight', 4)).toBe(0);
    expect(nextTabIndex(0, 'ArrowLeft', 4)).toBe(3);
  });

  it('jumps to the first and last section with Home and End', () => {
    expect(nextTabIndex(2, 'Home', 4)).toBe(0);
    expect(nextTabIndex(1, 'End', 4)).toBe(3);
  });

  it('leaves every other key to the page', () => {
    // Including the vertical arrows: the strip is horizontal, and
    // swallowing ArrowDown would stop the panel scrolling.
    for (const key of ['ArrowDown', 'ArrowUp', 'Tab', 'a', 'Enter']) {
      expect([key, nextTabIndex(1, key, 4)]).toEqual([key, null]);
    }
  });
});

describe('the keys a body produces', () => {
  it('reads every placeholder once, lower cased', () => {
    expect(extractKeys('{{Client_Name}} and {{client_name}} on {{ date }}')).toEqual([
      'client_name',
      'date',
    ]);
  });

  it('leaves out the keys the firm record fills in', () => {
    // A field row for firm_name would put an empty required input in front
    // of an employee AND disable the substitution the author asked for.
    expect(extractKeys('{{firm_name}} agrees with {{company}}')).toEqual(['company']);
  });

  it('ignores a token the merge could never match', () => {
    expect(extractKeys('{{client-name}}')).toEqual([]);
  });
});

describe('the fields derived from a body', () => {
  it('labels an unconfigured key from the key itself', () => {
    expect(deriveFields('{{recipient_name}}', {})).toEqual([
      {
        key: 'recipient_name',
        label: 'Recipient Name',
        type: 'text',
        required: true,
      },
    ]);
  });

  it('reads a key that mentions a date as a date', () => {
    expect(deriveFields('{{effective_date}}', {})[0].type).toBe('date');
  });

  it('keeps what the author configured for a key that is still in the body', () => {
    const stored = {
      company: {
        key: 'company',
        label: 'Their company',
        type: 'text' as const,
        required: false,
        party: 'counterparty' as const,
      },
    };
    expect(deriveFields('{{company}}', stored)).toEqual([stored.company]);
  });

  it('drops settings for a key the body no longer has', () => {
    // Settings are held by key, and a body that no longer mentions one must
    // not carry its old label out to the save.
    const stored = {
      gone: { key: 'gone', label: 'Gone', type: 'text' as const, required: true },
    };
    expect(deriveFields('nothing here', stored)).toEqual([]);
  });
});

describe('the page layout a template writes', () => {
  const draft = {
    margins: { top: 1 },
    letterhead: { mode: 'image' },
    watermark: { text: 'DRAFT' },
    footer: { text: 'x' },
  } as unknown as DocumentLayout;

  it('writes only the bands the author took over', () => {
    expect(layoutOverride(new Set(['footer']), draft)).toEqual({ footer: draft.footer });
  });

  it('writes nothing at all when every band is left to the firm', () => {
    // Null is the same value as "follow the firm", so a template that
    // overrides nothing must not pin today's firm layout into its own row.
    expect(layoutOverride(new Set(), draft)).toBeNull();
  });
});

describe('a detected blank identity', () => {
  const blank = (over: Partial<DetectedBlank>): DetectedBlank => ({
    kind: 'fill',
    index: 0,
    raw: '______',
    label: 'Print Name',
    key: 'print_name',
    type: 'text',
    inExecutionBlock: false,
    context: 'Print Name: ______',
    ...over,
  });

  it('is the same for the same blank at a different offset', () => {
    // Identity by what it describes, not where it sits: an index would be
    // invalidated by the next keystroke.
    expect(blankIdentity(blank({ index: 10 }))).toBe(blankIdentity(blank({ index: 900 })));
  });

  it('changes when the words around it change', () => {
    expect(blankIdentity(blank({ context: 'Signed by: ______' }))).not.toBe(
      blankIdentity(blank({})),
    );
  });
});
