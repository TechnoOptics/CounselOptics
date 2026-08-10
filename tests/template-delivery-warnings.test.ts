import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  counterpartyFieldsGoUnfilled,
  deliveryModeFlipped,
} from '../lib/firm-template-placeholders';

/**
 * The two consequences of the delivery mode that the legal team could not see.
 *
 * Both are told rather than refused, which is this codebase's standing
 * preference: a firm may have a reason, and a blocked control teaches nobody
 * anything. Both are stated at the moment the author creates the situation,
 * not later on somebody else's screen.
 *
 * ONE. A field marked as the recipient's on a template that goes out as a
 * read-only link has nobody to fill it. It renders as its bracketed label
 * (mergeTemplateDocument), which is honest and visible, but it is permanent:
 * the recipient reads `[Company address]` on the face of the document and
 * nobody could have typed anything there. The author was told none of that.
 *
 * TWO. Flipping a template's mode no longer redirects submissions already in
 * the approval queue. That is correct, because their document_text was merged
 * under the old mode and re-merging would change words a reviewer already
 * approved (resolveDispatchMode). But the person flipping it had no way to
 * know, and would have expected the change to apply to work in flight.
 *
 * The conditions are pure functions here because a warning shown at the wrong
 * moment is worse than no warning: one that fired on a template being created,
 * which has no queue at all, would be a warning about a thing that cannot
 * happen, and the reader learns to skip the next one. The copy itself is
 * anchored on the source, because the node test environment has no DOM and
 * because <T> requires a literal child.
 */

describe('counterpartyFieldsGoUnfilled', () => {
  const employee = { key: 'company', label: 'Company', party: 'employee' as const };
  const other = { key: 'entity_name', label: 'Entity', party: 'counterparty' as const };

  it('is true for a recipient field on a template that is not sent for signature', () => {
    expect(counterpartyFieldsGoUnfilled({ deliveryMode: 'share', fields: [employee, other] })).toBe(
      true,
    );
  });

  it('is false once the template is sent for signature', () => {
    expect(
      counterpartyFieldsGoUnfilled({ deliveryMode: 'signature', fields: [employee, other] }),
    ).toBe(false);
  });

  it('is false when every field is the employee’s', () => {
    expect(counterpartyFieldsGoUnfilled({ deliveryMode: 'share', fields: [employee] })).toBe(false);
    expect(counterpartyFieldsGoUnfilled({ deliveryMode: 'share', fields: [] })).toBe(false);
  });

  it('treats a field with no party as the employee’s', () => {
    // The same fail-safe direction sanitizeFields takes. A warning that fired
    // for every field on every template would be noise.
    expect(
      counterpartyFieldsGoUnfilled({ deliveryMode: 'share', fields: [{ key: 'a', label: 'A' }] }),
    ).toBe(false);
  });
});

describe('deliveryModeFlipped', () => {
  it('is true when the author changed a saved template’s mode', () => {
    expect(deliveryModeFlipped('share', 'signature')).toBe(true);
    expect(deliveryModeFlipped('signature', 'share')).toBe(true);
  });

  it('is false while the mode is what it was', () => {
    expect(deliveryModeFlipped('share', 'share')).toBe(false);
  });

  it('is false for a template that is being created', () => {
    // Nothing has been filed under it, so no queued submission can keep an
    // old mode. This is the case that would have made the warning noise.
    expect(deliveryModeFlipped(null, 'signature')).toBe(false);
    expect(deliveryModeFlipped(undefined, 'signature')).toBe(false);
  });
});

const root = join(__dirname, '..');
const MANAGE = 'app/counsel/forms';
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('the template editor states both consequences', () => {
  /**
   * THE WHOLE SURFACE, not one file of it. The editor was split into a
   * section per tab: the delivery control and the field list no longer sit
   * in the same file, and an anchor pinned to one of them would fail for a
   * reason that has nothing to do with either warning.
   */
  const src = () =>
    readdirSync(join(root, MANAGE), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.tsx'))
      .map((e) => readFileSync(join(root, MANAGE, e.name), 'utf8'))
      .join('\n');

  it('asks both questions of the editor’s own state', () => {
    // The ARGUMENTS, not just the call. A call spelled with constants would
    // contain the function name and warn unconditionally, which is the
    // failure this pins: the flip warning has to compare what was saved with
    // what is on screen, and the field warning has to read the fields the
    // body actually produced.
    const s = src();
    expect(s).toContain('counterpartyFieldsGoUnfilled({ deliveryMode, fields })');
    expect(s).toContain('deliveryModeFlipped(initial?.deliveryMode, deliveryMode)');
  });

  it('says a recipient field on a read-only template is never filled in', () => {
    const s = flat(src());
    expect(s).toContain('nobody will fill');
    // And names both ways out, because a consequence with no remedy is a
    // complaint. Scoped to the warning sentence: both remedy phrases are
    // also <option> labels in the same file, so asked file-wide this was
    // answered by the two controls and truncating the remedy off the
    // warning stayed green.
    const at = s.indexOf('nobody will fill');
    const warning = s.slice(at, at + 400);
    expect(warning).toContain('Your colleague fills in');
    expect(warning).toContain('For signature');
  });

  it('says queued submissions keep the mode they were filed under', () => {
    expect(flat(src())).toContain('keep the way they were set up when they were filed');
  });

  it('refuses neither combination', () => {
    // Told, not blocked. Nothing here may disable the save or drop an option
    // out of either control.
    const s = src();
    expect(s).toContain('<option value="counterparty">');
    expect(s).toContain('<option value="signature">');
    expect(s).not.toMatch(/disabled=\{[^}]*counterpartyFieldsGoUnfilled/);
    expect(s).not.toMatch(/disabled=\{[^}]*deliveryModeFlipped/);
  });
});
