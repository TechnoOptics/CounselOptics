import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Both controls that reassign a matter must go through assignTo.
 *
 * setCaseAssigneeAction returns { ok: false, error } for the refusals it
 * anticipates, but requireUser() THROWS when the session has gone. A server
 * action that throws inside a transition rejects it, and React replaces the
 * surrounding component with an error boundary instead of letting the control
 * report what happened. On the matter list that meant reassigning with no
 * session replaced the whole table with the error page.
 *
 * That was fixed on the list first and the matter detail page kept the
 * uncaught shape for a while afterwards, which is exactly how a pair of call
 * sites drift apart. This pins both.
 *
 * The match strips comments before looking, and requires the CALL form rather
 * than the bare name. Three guards in this repo have been satisfied by their
 * own prose or by a name appearing in a comment, so a guard that can be
 * satisfied by text that is not code is checking spelling, not behaviour.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SITES = [
  ['the matter list row picker', '../app/counsel/cases/matters-table.tsx'],
  ['the matter detail picker', '../app/counsel/cases/[id]/assignee-picker.tsx'],
] as const;

describe('every matter reassignment survives a dead session', () => {
  for (const [label, rel] of SITES) {
    it(`${label} calls assignTo, never the action directly`, () => {
      const code = stripComments(read(rel));
      // Mutation: swap assignTo( back for setCaseAssigneeAction( at either
      // site and this goes red. The comment above each call mentions the
      // action by name, which is why comments are stripped first.
      expect(code).toMatch(/\bassignTo\s*\(/);
      expect(code).not.toMatch(/\bsetCaseAssigneeAction\s*\(/);
    });
  }

  it('assignTo is the only place the action is called', () => {
    const helper = stripComments(read('../app/counsel/cases/assign-to.ts'));
    expect(helper).toMatch(/\bsetCaseAssigneeAction\s*\(/);
    // The catch is the whole point of the module. Removing it turns both
    // pickers back into error boundaries.
    expect(helper).toMatch(/catch\s*\{/);
  });
});
