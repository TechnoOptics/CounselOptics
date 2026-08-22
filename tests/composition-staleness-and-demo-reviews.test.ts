import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  appendCompositionVersion,
  isRealReview,
  isReviewStale,
  lastCompositionEditAt,
  parseCompositionHistory,
  type CompositionVersion,
} from '../lib/composition';

/**
 * Two rules about the account of what happened, and the wiring that carries
 * them to the screen.
 *
 * The account is `cases.description`: the `description` textarea in
 * app/cases/new/case-form.tsx writes it at creation, and it is now editable
 * from the case page.
 *
 * Rule one. A review written before a rewrite is never presented as current.
 * A review is an issue-spotting document about a legal matter; shown as
 * current against text that has since changed, it describes facts that are no
 * longer being asserted, and it can reach a judge that way.
 *
 * Rule two. A demo placeholder is never stored or shown as a real review.
 * `runReview` in lib/ai.ts returns one when the deployment has no API key and
 * again when a token balance has run out, and it reads exactly like analysis.
 *
 * The source-reading blocks at the bottom strip comments before matching and
 * require the CALL form, never the bare name. Guards in this repo have been
 * satisfied by their own prose and by an import line, and a guard that a
 * comment can satisfy is checking spelling rather than behaviour.
 */

const v = (text: string, replacedAt: string): CompositionVersion => ({ text, replacedAt });

describe('a review written before a rewrite is stale', () => {
  it('is not stale when the account was never rewritten', () => {
    expect(isReviewStale({ createdAt: '2026-08-01T00:00:00.000Z' }, [])).toBe(false);
  });

  it('is not stale when every rewrite predates the review', () => {
    const history = [v('first draft', '2026-07-01T00:00:00.000Z')];
    expect(isReviewStale({ createdAt: '2026-08-01T00:00:00.000Z' }, history)).toBe(false);
  });

  it('is stale when a rewrite came after the review', () => {
    const history = [v('first draft', '2026-08-10T00:00:00.000Z')];
    expect(isReviewStale({ createdAt: '2026-08-01T00:00:00.000Z' }, history)).toBe(true);
  });

  it('is stale when any one of several rewrites came after the review', () => {
    const history = [
      v('first draft', '2026-06-01T00:00:00.000Z'),
      v('second draft', '2026-09-01T00:00:00.000Z'),
    ];
    expect(isReviewStale({ createdAt: '2026-08-01T00:00:00.000Z' }, history)).toBe(true);
  });

  it('is stale, not assumed current, when a timestamp cannot be read', () => {
    // Failing towards "stale" is the point. The alternative is showing a
    // review as current because a date did not parse.
    expect(isReviewStale({ createdAt: 'not a date' }, [v('x', '2026-08-01T00:00:00.000Z')])).toBe(
      true,
    );
    expect(isReviewStale({ createdAt: '2026-08-01T00:00:00.000Z' }, [v('x', 'nope')])).toBe(true);
  });

  it('reports nothing to mark when there is no review at all', () => {
    expect(isReviewStale(null, [v('x', '2026-08-01T00:00:00.000Z')])).toBe(false);
  });

  it('names the most recent rewrite, which is the date the banner shows', () => {
    const history = [
      v('a', '2026-06-01T00:00:00.000Z'),
      v('b', '2026-09-01T00:00:00.000Z'),
      v('c', '2026-07-01T00:00:00.000Z'),
    ];
    expect(lastCompositionEditAt(history)).toBe('2026-09-01T00:00:00.000Z');
    expect(lastCompositionEditAt([])).toBeNull();
  });
});

describe('the earlier account survives the rewrite', () => {
  const at = '2026-08-22T00:00:00.000Z';

  it('keeps the outgoing text verbatim', () => {
    const out = appendCompositionVersion([], 'He arrived at 9pm.', 'He arrived at 10pm.', at);
    expect(out).toEqual([{ text: 'He arrived at 9pm.', replacedAt: at }]);
  });

  it('keeps the outgoing text when the account is cleared to nothing', () => {
    // Deleting the words is still an edit, and the deleted words are kept.
    const out = appendCompositionVersion([], 'He arrived at 9pm.', '', at);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('He arrived at 9pm.');
  });

  it('never drops an earlier version to make room', () => {
    let history: CompositionVersion[] = [];
    for (let i = 0; i < 200; i += 1) {
      history = appendCompositionVersion(
        history,
        `version ${i}`,
        `version ${i + 1}`,
        `2026-08-22T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      );
    }
    expect(history).toHaveLength(200);
    expect(history[0].text).toBe('version 0');
  });

  it('records no version for a save that changed nothing', () => {
    expect(appendCompositionVersion([], 'same words', 'same words', at)).toHaveLength(0);
    expect(appendCompositionVersion([], '  same words ', 'same words', at)).toHaveLength(0);
  });

  it('records no version when there was nothing there before', () => {
    expect(appendCompositionVersion([], '', 'the first account', at)).toHaveLength(0);
  });

  it('drops malformed stored entries rather than inventing a version', () => {
    expect(
      parseCompositionHistory([
        { text: 'kept', replacedAt: at },
        { text: '', replacedAt: at },
        { text: 'no date' },
        { replacedAt: at },
        null,
        'a string',
      ]),
    ).toEqual([{ text: 'kept', replacedAt: at }]);
    // The column is absent entirely until the migration is applied.
    expect(parseCompositionHistory(undefined)).toEqual([]);
    expect(parseCompositionHistory(null)).toEqual([]);
  });
});

describe('a placeholder is not a review', () => {
  it('excludes the demo flag', () => {
    expect(isRealReview({ isDemo: true, modelUsed: 'demo' })).toBe(false);
  });

  it('excludes a demo or unsupported model even without the flag', () => {
    expect(isRealReview({ isDemo: false, modelUsed: 'demo' })).toBe(false);
    expect(isRealReview({ isDemo: false, modelUsed: 'unsupported' })).toBe(false);
  });

  it('accepts a real model', () => {
    expect(isRealReview({ isDemo: false, modelUsed: 'claude-sonnet-4-5' })).toBe(true);
  });

  it('does not hide a real review whose model was never recorded', () => {
    // reviewFromRow in lib/storage.ts maps a null model_used to ''. Hiding
    // those would suppress genuine reviews, which is its own failure.
    expect(isRealReview({ isDemo: false, modelUsed: '' })).toBe(true);
  });

  it('treats a missing review as nothing to show', () => {
    expect(isRealReview(null)).toBe(false);
    expect(isRealReview(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The wiring. Source-reading, comments stripped, CALL form required.
// ---------------------------------------------------------------------------

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const stripComments = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the case page decides staleness and hands it to the panel', () => {
  const page = stripComments(read('../app/cases/[id]/page.tsx'));

  it('calls isReviewStale rather than merely importing it', () => {
    // Mutation: delete the isReviewStale( call and this goes red. The name
    // also appears in the import line and in the comments above the call,
    // which is why comments are stripped and the call form is required.
    expect(page).toMatch(/\bisReviewStale\s*\(/);
    expect(page).toMatch(/\blastCompositionEditAt\s*\(/);
  });

  it('passes the result to the review panel', () => {
    expect(page).toMatch(/staleSince=\{reviewStaleSince\}/);
  });

  it('calls isRealReview, so a placeholder never counts as a review on file', () => {
    expect(page).toMatch(/\bisRealReview\s*\(/);
  });

  it('gates the review tick, the teaser, and the hearing packet on the real review', () => {
    // A demo stored before this change must not light the tab tick or feed
    // the hearing packet as though it were analysis of this case.
    expect(page).toMatch(/badge:\s*realReview\s*\?/);
    expect(page).toMatch(/realReview\s*&&\s*!reviewEntitled/);
    expect(page).toMatch(/review=\{realReview\}/);
  });

  it('renders the account editor', () => {
    expect(page).toMatch(/<CompositionPanel\b/);
  });
});

describe('the review panel marks a stale review and refuses a placeholder', () => {
  const panel = stripComments(read('../app/cases/[id]/review-panel.tsx'));

  it('renders the stale banner from staleSince', () => {
    // Mutation: delete the banner block and this goes red.
    expect(panel).toMatch(/realReview\s*&&\s*staleSince\s*&&/);
    expect(panel).toMatch(/written against an earlier version of your account/);
  });

  it('calls isRealReview before it renders anything', () => {
    expect(panel).toMatch(/\bisRealReview\s*\(/);
  });

  it('renders the carousel from the real review, never the raw prop', () => {
    expect(panel).toMatch(/<ReviewCarousel review=\{realReview\}/);
    expect(panel).not.toMatch(/<ReviewCarousel review=\{review\}/);
  });

  it('reads the re-run refusal as a value instead of catching a throw', () => {
    // rescanExhibitAction's shape. A thrown message dies at the Server Action
    // boundary and the person reads a React digest instead of the reason.
    expect(panel).toMatch(/\brerunCaseReviewAction\s*\(/);
    expect(panel).toMatch(/if\s*\(!r\.ok\)/);
    expect(panel).not.toMatch(/\brunReviewAction\s*\(/);
  });
});

describe('the re-run action refuses to store a placeholder', () => {
  const actions = stripComments(read('../lib/actions.ts'));
  const body = actions.slice(actions.indexOf('export async function rerunCaseReviewAction'));

  it('calls isRealReview and returns rather than saving', () => {
    // Mutation: delete the !isRealReview(review) guard and this goes red.
    expect(body).toMatch(/\bisRealReview\s*\(/);
    expect(body).toMatch(/if\s*\(!isRealReview\(review\)\)/);
  });

  it('returns its refusal instead of throwing it', () => {
    expect(body).toMatch(/return\s*\{\s*ok:\s*false/);
    expect(body).not.toMatch(/throw new Error/);
  });

  it('confirms the caller owns the case before it spends anything', () => {
    expect(body).toMatch(/\bloadOwnedCase\s*\(/);
  });
});

describe('only the owner may rewrite the account', () => {
  const actions = stripComments(read('../lib/actions.ts'));
  const owner = actions.slice(
    actions.indexOf('async function loadOwnedCase'),
    actions.indexOf('export async function updateCaseCompositionAction'),
  );

  it('compares the case owner against the signed-in user', () => {
    // Mutation: delete the ownerId comparison and this goes red. Every server
    // action is a public HTTP endpoint, so this check cannot live in the page.
    expect(owner).toMatch(/\bgetCurrentUser\s*\(/);
    expect(owner).toMatch(/caseRecord\.ownerId\s*!==\s*user\.id/);
  });

  it('is what both write actions go through', () => {
    const writes = actions.slice(actions.indexOf('export async function updateCaseCompositionAction'));
    expect(writes).toMatch(/\bloadOwnedCase\s*\(/);
    expect(writes).toMatch(/\bclearCaseCompositionAction\b/);
  });
});
