import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';
import {
  AI_PLACEHOLDER_REFUSED_MESSAGE,
  AI_UNAVAILABLE_MESSAGE,
} from '../lib/ai-errors';

/**
 * rerunCaseReviewAction can refuse for two reasons that need opposite fixes:
 * the provider call failed, or the provider answered with its example
 * placeholder and the action refused to store it. For a day both refusals
 * said "temporarily unavailable", and a person's report could not tell us
 * which one they had hit, and neither could we without the server log.
 *
 * This reads comment-stripped source and asserts the CALL on each branch,
 * so a comment naming a constant cannot satisfy it and neither can an import.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const actions = stripComments(readFileSync(join(root, 'lib/actions.ts'), 'utf8'));

function rerunBody(): string {
  const start = actions.indexOf('export async function rerunCaseReviewAction(');
  expect(start, 'rerunCaseReviewAction not found').toBeGreaterThan(-1);
  const end = actions.indexOf('\nexport ', start + 1);
  return actions.slice(start, end === -1 ? undefined : end);
}

describe('the two review refusals', () => {
  it('are two different sentences', () => {
    expect(AI_PLACEHOLDER_REFUSED_MESSAGE).not.toBe(AI_UNAVAILABLE_MESSAGE);
    expect(AI_PLACEHOLDER_REFUSED_MESSAGE).not.toMatch(/\/billing|\/pricing|upgrade|top up|subscribe/i);
  });

  it('a provider failure still goes through calmAiMessage', () => {
    expect(rerunBody()).toMatch(/calmAiMessage\(err, AI_UNAVAILABLE_MESSAGE\)/);
  });

  it('a refused placeholder returns its own sentence, not the provider one', () => {
    const body = rerunBody();
    const idx = body.indexOf('refusing to store a placeholder review');
    expect(idx, 'placeholder branch not found').toBeGreaterThan(-1);
    const after = body.slice(idx, idx + 600);
    expect(after).toMatch(/return \{ ok: false, error: AI_PLACEHOLDER_REFUSED_MESSAGE \}/);
    expect(after).not.toMatch(/return \{ ok: false, error: AI_UNAVAILABLE_MESSAGE \}/);
  });
});
