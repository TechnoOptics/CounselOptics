import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { affirmedAt, MARK_INTENT_REQUIRED } from '../lib/mark-handoff-queries';
import { stripComments } from './support/strip-comments';

/**
 * A signature with no affirmation of intent is not a signature.
 *
 * The consent checkbox is on all three signing surfaces and always has been:
 * the desk form, the outside signer's page, and the phone pad, all rendering
 * the same sentence from lib/signing-intent.ts. What was missing is that only
 * the browser enforced it.
 *
 * /api/firm/mark is a public HTTP endpoint. It is bound to one device by an
 * httpOnly cookie, but anything holding that cookie can post to it, and the
 * pad's own check protects nobody who did not want protecting. The server
 * stored:
 *
 *     mark_intent_at:
 *       typeof input.intentAffirmedAt === 'string' ? new Date().toISOString() : null
 *
 * so a body omitting the field entirely stored null AND THE MARK LANDED. The
 * result is a countersigned document whose signature carries no affirmation of
 * intent, which is the definitional element of an electronic signature under
 * 15 USC 7006(5) and UETA 2(8). The same expression also accepted '' and
 * 'banana', making the field a boolean wearing a timestamp's clothes.
 *
 * These tests are on the pure validator, which is where the decision lives.
 * The refusal happens BEFORE the row is touched, so a request without an
 * affirmation does not burn the handoff and send the person back to the desk
 * for a new code.
 */

describe('what counts as an affirmation', () => {
  it('accepts a real instant', () => {
    expect(affirmedAt(new Date().toISOString())).toBe(true);
    expect(affirmedAt('2026-08-15T10:00:00.000Z')).toBe(true);
  });

  it('refuses an absent field, which is the case that shipped', () => {
    expect(affirmedAt(undefined)).toBe(false);
    expect(affirmedAt(null)).toBe(false);
  });

  it('refuses a string that is not an instant', () => {
    // The old check was `typeof x === 'string'`, so every one of these passed
    // and was recorded as somebody affirming their intent to sign.
    for (const value of ['', '   ', 'banana', 'true', 'yes']) {
      expect(affirmedAt(value), `"${value}" must not count as affirmation`).toBe(false);
    }
  });

  it('refuses a non-string, however plausible', () => {
    for (const value of [true, 1, 0, {}, [], new Date()]) {
      expect(affirmedAt(value)).toBe(false);
    }
  });

  it('does not fall for Invalid Date', () => {
    // The trap this is written against: `new Date('garbage')` is an Invalid
    // Date, and EVERY comparison against it is false. A validator written as
    // `d > someFloor` therefore passes garbage through silently. The check has
    // to assert on getTime() being NaN, which is what affirmedAt does.
    const invalid = new Date('garbage');
    expect(Number.isNaN(invalid.getTime())).toBe(true);
    expect(invalid > new Date(0)).toBe(false);
    expect(invalid < new Date(0)).toBe(false);
    expect(affirmedAt('garbage')).toBe(false);
  });
});

describe('storeMarkForHandoff actually calls it', () => {
  // A validator nothing invokes is the failure shape this repository keeps
  // producing, and the mutation that removed the call site left every test
  // above green. Source-reading, and says so: driving the real function needs
  // a Supabase admin client, and the decision under test is one line.
  //
  // COMMENTS STRIPPED FIRST. The block comment above the guard in that file
  // quotes the very expression these assertions look for, so an unstripped
  // read is satisfied by the prose explaining the fix rather than by the fix.
  // That has now happened twice in this repository, in both directions: a ban
  // going red against correct code, and a requirement going green against
  // deleted code.
  const SOURCE = stripComments(
    readFileSync(join(process.cwd(), 'lib/mark-handoff-queries.ts'), 'utf8'),
  );

  it('refuses an unaffirmed mark', () => {
    expect(SOURCE).toMatch(
      /if \(!affirmedAt\(input\.intentAffirmedAt\)\) \{\s*\n\s*return \{ ok: false, error: MARK_INTENT_REQUIRED \};/,
    );
  });

  it('refuses BEFORE the row is touched, so the code is not burned', () => {
    // Order matters: refusing after the update would consume the handoff and
    // send somebody back to the desk to mint a new code for a mistake the
    // client made.
    // Scoped to this function's body. The file updates firm_mark_handoffs in
    // several places (claim, collect, store), and a bare indexOf found the
    // FIRST of them, in a different function, and reported the guard as coming
    // too late. Measuring the wrong pair is how a green order-assertion means
    // nothing.
    const start = SOURCE.indexOf('export async function storeMarkForHandoff');
    expect(start).toBeGreaterThan(-1);
    const body = SOURCE.slice(start);
    const guard = body.indexOf('if (!affirmedAt(input.intentAffirmedAt))');
    const update = body.indexOf('.update({');
    expect(guard).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(update);
  });

  it('no longer stores a conditional null for the affirmation', () => {
    // The exact expression that shipped. Its presence means an unaffirmed
    // mark can land again.
    expect(SOURCE).not.toMatch(/mark_intent_at:\s*\n?\s*typeof input\.intentAffirmedAt === 'string'/);
  });
});

/**
 * The endpoint in front of it.
 *
 * The validator and its call site are pinned above. This pins the one link
 * between them: the route has to actually pass the caller's field down. A
 * route that read the body and dropped this key would leave every assertion
 * above green while the endpoint accepted an unaffirmed mark again, because
 * `undefined` is exactly the value the shipped defect stored null for.
 *
 * Reordering the UI so the affirmation gates the pad does not touch any of
 * this, and is not allowed to. The browser's ordering is a courtesy; this is
 * the control.
 */
describe('the route hands the affirmation to the gate', () => {
  const ROUTE = stripComments(
    readFileSync(join(process.cwd(), 'app/api/firm/mark/route.ts'), 'utf8'),
  );

  it('passes the caller field through to storeMarkForHandoff', () => {
    const call = ROUTE.indexOf('storeMarkForHandoff({');
    expect(call).toBeGreaterThan(-1);
    const args = ROUTE.slice(call, ROUTE.indexOf('});', call));
    expect(args).toContain('intentAffirmedAt: payload.intentAffirmedAt');
  });

  it('does not decide for itself whether the affirmation is good enough', () => {
    // One gate, in one place. A second opinion here is how the two drift and
    // the weaker one wins.
    expect(ROUTE).not.toMatch(/intentAffirmedAt\s*(\?\?|\|\||&&)/);
    expect(ROUTE).not.toMatch(/typeof payload\.intentAffirmedAt/);
  });
});

describe('the refusal', () => {
  it('tells the signer what to do, and names no internals', () => {
    expect(MARK_INTENT_REQUIRED).toMatch(/affirm/i);
    expect(MARK_INTENT_REQUIRED).not.toMatch(/intentAffirmedAt|null|400|column/i);
  });
});
