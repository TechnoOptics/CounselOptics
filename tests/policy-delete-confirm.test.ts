import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Deleting a firm's written policy asks first, and names what it is deleting.
 *
 * The Delete button called the action straight from onClick. One tap and the
 * policy was gone: no confirmation, and deleteFirmPolicyAction has no undo, so
 * a mis-tap on a touch device removed a firm's written policy with nothing to
 * recover it from. Every other destructive control in this product asks.
 *
 * The question NAMES the policy. "Delete this policy?" is a question nobody can
 * check before answering, which makes the dialog a speed bump rather than a
 * safeguard; the row is held in state, not just its id, so the name is there
 * to show.
 *
 * Source-reading, and says so: the component is a client component with no
 * pure decision to extract, and vitest runs in the node environment with no
 * DOM here. What it holds is that the click no longer deletes, and that the
 * name reaches the question.
 */

const SRC = readFileSync(
  join(process.cwd(), 'app/counsel/policies/policies-manage-client.tsx'),
  'utf8',
);
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('deleting a policy asks first', () => {
  it('the button no longer deletes on click', () => {
    // The exact expression that shipped.
    expect(CODE).not.toMatch(/onClick=\{\(\) => void remove\(p\.id\)\}/);
    expect(CODE).toMatch(/onClick=\{\(\) => setPendingDelete\(p\)\}/);
  });

  it('a confirmation stands between the click and the action', () => {
    expect(CODE).toContain('ConfirmDialog');
    expect(CODE).toMatch(/onConfirm=\{\(\) => void remove\(pendingDelete\.id\)\}/);
  });

  it('the question names the policy', () => {
    // Holding the row rather than the id is what makes this possible, and is
    // the difference between a safeguard and a speed bump.
    expect(CODE).toMatch(/pendingDelete\.name/);
    expect(CODE).toMatch(/useState<FirmPolicy \| null>\(null\)/);
  });

  it('says plainly that it cannot be undone', () => {
    expect(SRC).toMatch(/cannot be undone/i);
  });

  it('clears the pending row after the action runs', () => {
    // Otherwise a failed delete leaves the dialog up over a stale question.
    expect(CODE).toMatch(/setPendingDelete\(null\)/);
  });
});
