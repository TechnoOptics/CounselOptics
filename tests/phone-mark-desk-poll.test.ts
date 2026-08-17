import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The desk's poll is not allowed to give up in silence.
 *
 * It did, and that is how a lost signature reached production undetected. The
 * poll read `if (!mark) return false`, so "the phone has not drawn yet", "you
 * are not signed in any more" and "the server stamped this row collected and
 * sent nothing back" were one branch with one outcome and no trace anywhere.
 * The browser console on the laptop that lost the signature was completely
 * clean. That was the third silent bail found in this one code path in a day.
 *
 * So the two states that are NOT a wait get a sentence, and the ordinary wait
 * stays quiet: a console.error every 1200ms would be noise, and noise is the
 * other way to make a real failure invisible.
 */

// The action module is a 'use server' file whose imports reach the Supabase
// server client. Nothing here calls it: the decision under test is pure and
// takes the action's RESULT, which is the point of it being a function at all.
vi.mock('../app/portal/forms/[id]/mark-handoff-actions', () => ({
  collectPhoneMarkAction: async () => ({
    mark: null,
    markAt: null,
    scanned: false,
    collected: false,
  }),
}));

const { phoneMarkProblem } = await import(
  '../app/portal/forms/[id]/phone-mark-handoff'
);

const waiting = { mark: null, markAt: null, scanned: false, collected: false };

describe('what the desk says when a poll comes back with no signature', () => {
  it('stays quiet while the phone has simply not drawn yet', () => {
    expect(phoneMarkProblem(waiting)).toBe(null);
    expect(phoneMarkProblem({ ...waiting, scanned: true })).toBe(null);
  });

  it('says nothing when the picture arrived', () => {
    expect(phoneMarkProblem({ ...waiting, mark: 'data:image/png;base64,x' })).toBe(
      null,
    );
  });

  it('reports a signature that can never be collected again', () => {
    // The production state exactly: collected_at stamped, no picture returned.
    // Whatever put the row there, a person has signed something and it has
    // gone, and the poll must not answer that with another 1200ms of nothing.
    const problem = phoneMarkProblem({ ...waiting, scanned: true, collected: true });
    expect(problem).toEqual(expect.any(String));
    expect(problem).toContain('collected');
  });

  it('reports what the server said when the server said something', () => {
    const problem = phoneMarkProblem({ ...waiting, error: 'Please sign in again.' });
    expect(problem).toContain('Please sign in again.');
  });

  it('prefers the server error over its own guess', () => {
    // A session that has expired explains a collected-looking row better than
    // "your signature vanished" does, and it is the one the operator can act
    // on.
    expect(
      phoneMarkProblem({
        mark: null,
        markAt: null,
        scanned: true,
        collected: true,
        error: 'Please sign in again.',
      }),
    ).toContain('Please sign in again.');
  });
});

describe('the poll actually reports it', () => {
  /**
   * Comments stripped BEFORE matching, and this is not a formality here: the
   * comment above the branch explains the console.error, so a guard run over
   * the raw file passes on the explanation of a fix that was never applied.
   * That exact false pass has happened twice in this repository.
   */
  const SOURCE = readFileSync(
    join(process.cwd(), 'app/portal/forms/[id]/phone-mark-handoff.tsx'),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  /**
   * Scoped to the poll callback, not to the file. `SOURCE.includes(
   * 'phoneMarkProblem(')` was the first thing written here and it is worthless:
   * the file DECLARES that function, so the string is there whether or not
   * anything calls it, and the guard survived deleting the entire branch. That
   * is the same failure as a guard satisfied by its own comment, wearing a
   * different hat.
   */
  const POLL = /poll=\{async \(handoffId\) => \{([\s\S]*?)\n      \}\}/.exec(SOURCE);

  it('has a poll callback to read at all', () => {
    expect(POLL, 'the poll is no longer an inline async arrow').not.toBeNull();
  });

  it('consults phoneMarkProblem inside the poll, not merely in the file', () => {
    expect(POLL![1]).toContain('phoneMarkProblem(result)');
  });

  it('calls console.error with the problem, in code and not in a comment', () => {
    expect(POLL![1]).toMatch(/console\.error\([^)]*problem/);
  });

  it('never leaves the poll empty-handed without consulting it', () => {
    // Once the server has answered, every way out of this callback either
    // carries the picture or has been past phoneMarkProblem. That is the whole
    // property: the branch that lost a signature was an exit taken before
    // anybody had looked at what came back.
    const body = POLL![1];
    const answered = body.indexOf('collectPhoneMarkAction');
    const consult = body.indexOf('phoneMarkProblem(result)');
    expect(answered, 'the poll no longer asks the server').toBeGreaterThan(-1);
    expect(consult, 'the poll no longer consults phoneMarkProblem').toBeGreaterThan(
      -1,
    );

    const exits = [...body.matchAll(/return [^;\n]*/g)];
    for (const exit of exits) {
      const at = exit.index;
      if (at > answered && at < consult) {
        // Allowed only if it is the branch that has the picture in hand.
        expect(
          exit[0],
          'an exit between the server answering and the problem being looked at',
        ).toContain("'done'");
      }
    }
    expect(exits.length).toBeGreaterThan(1);
  });
});
