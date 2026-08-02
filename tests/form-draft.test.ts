import { describe, it, expect } from 'vitest';
import {
  addQuestion,
  clearRule,
  defaultConfigFor,
  deleteQuestion,
  flattenQuestions,
  moveQuestion,
  partnerDegradations,
  questionsBefore,
  ruleProblems,
  startingDraft,
  TYPE_GROUPS,
  updateQuestion,
} from '../lib/form-draft';
import { QUESTION_TYPES, validateFormPayload } from '../lib/form-schema';
import type { FormPayload, Question } from '../lib/form-schema';

// The builder's canvas is one `FormPayload` in React state and a set of pure
// functions that rewrite it. Everything worth getting wrong lives in those
// functions: which questions a rule may point at, what happens to a rule when
// its target is deleted, and what "move this field left" means at a row
// boundary. This file is the coverage for those, because the repo's vitest
// environment is `node` and the component itself cannot be mounted here.

const NO_FROZEN_KEYS: ReadonlySet<string> = new Set<string>();

function q(over: Partial<Question> & { id: string }): Question {
  return {
    key: over.id,
    type: 'short_text',
    label: over.id.toUpperCase(),
    required: false,
    config: {},
    ...over,
  };
}

function payload(rows: { id: string; fields: Question[] }[]): FormPayload {
  return { schemaVersion: 1, rows };
}

/** Row-major ids, which is the document order every rule is judged against. */
function order(p: FormPayload): string[][] {
  return p.rows.map((r) => r.fields.map((f) => f.id));
}

describe('flattenQuestions and questionsBefore', () => {
  const p = payload([
    { id: 'r1', fields: [q({ id: 'a' }), q({ id: 'b' })] },
    { id: 'r2', fields: [q({ id: 'c' })] },
  ]);

  it('numbers questions from one in document order, not per row', () => {
    expect(flattenQuestions(p).map((f) => [f.question.id, f.number])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('reports each question position, so a move knows where it started', () => {
    expect(flattenQuestions(p).map((f) => [f.rowIndex, f.fieldIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it('offers a rule only the questions strictly above it, including its row-mates', () => {
    // 'b' shares a row with 'a'. Document order still puts 'a' first, and the
    // renderer resolves visibility in that order, so 'a' is a legal target.
    expect(questionsBefore(p, 'b').map((f) => f.question.id)).toEqual(['a']);
    expect(questionsBefore(p, 'c').map((f) => f.question.id)).toEqual(['a', 'b']);
  });

  it('offers nothing to the first question and nothing for an unknown id', () => {
    expect(questionsBefore(p, 'a')).toEqual([]);
    expect(questionsBefore(p, 'nope')).toEqual([]);
  });
});

describe('addQuestion', () => {
  it('appends to the named row and returns the question it made', () => {
    const p = payload([{ id: 'r1', fields: [q({ id: 'a' })] }]);
    const { payload: next, question } = addQuestion(p, { kind: 'row', rowIndex: 0 }, 'email');
    expect(next.rows[0].fields.map((f) => f.id)).toEqual(['a', question.id]);
    expect(question.type).toBe('email');
    expect(question.label).toBe('');
  });

  it('starts a new row when asked for one', () => {
    const p = payload([{ id: 'r1', fields: [q({ id: 'a' })] }]);
    const { payload: next } = addQuestion(p, { kind: 'newRow' }, 'short_text');
    expect(next.rows).toHaveLength(2);
    expect(next.rows[1].fields).toHaveLength(1);
  });

  it('refuses a fourth field in a row, because the grid lays out three', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' }), q({ id: 'b' }), q({ id: 'c' })] },
    ]);
    const { payload: next } = addQuestion(p, { kind: 'row', rowIndex: 0 }, 'short_text');
    expect(next.rows[0].fields.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(next.rows).toHaveLength(1);
  });

  it('gives every new question a key no other question is using', () => {
    let p = payload([]);
    for (let i = 0; i < 3; i += 1) {
      p = addQuestion(p, { kind: 'newRow' }, 'short_text').payload;
    }
    const keys = flattenQuestions(p).map((f) => f.question.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys.every((k) => k.length > 0)).toBe(true);
  });

  it('gives a select an options array and a currency a currency, so the editor has something to edit', () => {
    const select = addQuestion(payload([]), { kind: 'newRow' }, 'select').question;
    expect(select.config.options).toEqual([]);
    const money = addQuestion(payload([]), { kind: 'newRow' }, 'currency').question;
    expect(money.config.currency).toBe('USD');
    expect(defaultConfigFor('short_text')).toEqual({});
  });
});

describe('updateQuestion', () => {
  const base = payload([{ id: 'r1', fields: [q({ id: 'a', key: 'short_text', label: '' })] }]);

  it('writes the label through', () => {
    const next = updateQuestion(base, 'a', { label: 'Counterparty name' }, NO_FROZEN_KEYS);
    expect(next.rows[0].fields[0].label).toBe('Counterparty name');
  });

  it('derives a readable key from the label while the question has never been published', () => {
    const next = updateQuestion(base, 'a', { label: 'Counterparty name' }, NO_FROZEN_KEYS);
    expect(next.rows[0].fields[0].key).toBe('counterparty_name');
  });

  it('leaves a published question its key, because answers are stored against it', () => {
    const published = payload([
      { id: 'r1', fields: [q({ id: 'a', key: 'counterparty', label: 'Counterparty' })] },
    ]);
    const next = updateQuestion(
      published,
      'a',
      { label: 'Other side' },
      new Set(['counterparty']),
    );
    expect(next.rows[0].fields[0].label).toBe('Other side');
    expect(next.rows[0].fields[0].key).toBe('counterparty');
  });

  it('never derives a key another question already holds', () => {
    const p = payload([
      {
        id: 'r1',
        fields: [q({ id: 'a', key: 'amount', label: 'Amount' }), q({ id: 'b', key: 'x', label: '' })],
      },
    ]);
    const next = updateQuestion(p, 'b', { label: 'Amount' }, NO_FROZEN_KEYS);
    expect(next.rows[0].fields[1].key).not.toBe('amount');
    expect(next.rows[0].fields[1].key).toBe('amount_2');
  });

  it('keeps a usable key when the label is only punctuation', () => {
    const next = updateQuestion(base, 'a', { label: '???' }, NO_FROZEN_KEYS);
    expect(next.rows[0].fields[0].key.trim()).not.toBe('');
  });

  it('swaps in the new type\'s config when the type changes', () => {
    const p = payload([{ id: 'r1', fields: [q({ id: 'a', type: 'select', config: { options: ['A'] } })] }]);
    const next = updateQuestion(p, 'a', { type: 'number' }, NO_FROZEN_KEYS);
    expect(next.rows[0].fields[0].config.options).toBeUndefined();
  });

  it('carries options across select and multiselect, which are the same question asked twice', () => {
    const p = payload([{ id: 'r1', fields: [q({ id: 'a', type: 'select', config: { options: ['A', 'B'] } })] }]);
    const next = updateQuestion(p, 'a', { type: 'multiselect' }, NO_FROZEN_KEYS);
    expect(next.rows[0].fields[0].config.options).toEqual(['A', 'B']);
  });

  it('leaves every other question alone', () => {
    const p = payload([{ id: 'r1', fields: [q({ id: 'a' }), q({ id: 'b', label: 'B' })] }]);
    const next = updateQuestion(p, 'a', { label: 'Changed' }, NO_FROZEN_KEYS);
    expect(next.rows[0].fields[1]).toEqual(p.rows[0].fields[1]);
  });
});

describe('deleteQuestion', () => {
  it('removes the question and drops a row it emptied', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b' }), q({ id: 'c' })] },
    ]);
    expect(order(deleteQuestion(p, 'a'))).toEqual([['b', 'c']]);
    expect(order(deleteQuestion(p, 'b'))).toEqual([['a'], ['c']]);
  });

  it('leaves a rule pointing at the deleted question in place, for ruleProblems to surface', () => {
    // Deleting the rule here would silently turn a conditional question into
    // an unconditional one. The author is told instead.
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', showWhen: { questionId: 'a', op: 'answered' } })] },
    ]);
    const next = deleteQuestion(p, 'a');
    expect(next.rows[0].fields[0].showWhen).toEqual({ questionId: 'a', op: 'answered' });
  });
});

describe('clearRule', () => {
  it('takes the rule off one question and touches nothing else', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', showWhen: { questionId: 'a', op: 'answered' } })] },
    ]);
    const next = clearRule(p, 'b');
    expect(next.rows[1].fields[0].showWhen).toBeUndefined();
    expect(next.rows[0].fields[0]).toEqual(p.rows[0].fields[0]);
  });
});

describe('moveQuestion left and right, which reorder within a row', () => {
  const p = payload([{ id: 'r1', fields: [q({ id: 'a' }), q({ id: 'b' }), q({ id: 'c' })] }]);

  it('swaps with the neighbour', () => {
    expect(order(moveQuestion(p, 'b', 'left'))).toEqual([['b', 'a', 'c']]);
    expect(order(moveQuestion(p, 'b', 'right'))).toEqual([['a', 'c', 'b']]);
  });

  it('does nothing at either end of the row', () => {
    expect(order(moveQuestion(p, 'a', 'left'))).toEqual([['a', 'b', 'c']]);
    expect(order(moveQuestion(p, 'c', 'right'))).toEqual([['a', 'b', 'c']]);
  });
});

describe('moveQuestion up and down, which move between rows', () => {
  it('swaps whole rows when the question is alone in its row', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b' })] },
    ]);
    expect(order(moveQuestion(p, 'b', 'up'))).toEqual([['b'], ['a']]);
    expect(order(moveQuestion(p, 'a', 'down'))).toEqual([['b'], ['a']]);
  });

  it('joins the row above when that row has room', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b' }), q({ id: 'c' })] },
    ]);
    expect(order(moveQuestion(p, 'b', 'up'))).toEqual([['a', 'b'], ['c']]);
  });

  it('joins the row below at its start, so moving down lands the question first', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' }), q({ id: 'b' })] },
      { id: 'r2', fields: [q({ id: 'c' })] },
    ]);
    expect(order(moveQuestion(p, 'b', 'down'))).toEqual([['a'], ['b', 'c']]);
  });

  it('takes a row of its own when the neighbouring row is full', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' }), q({ id: 'b' }), q({ id: 'c' })] },
      { id: 'r2', fields: [q({ id: 'd' }), q({ id: 'e' })] },
    ]);
    expect(order(moveQuestion(p, 'e', 'up'))).toEqual([['a', 'b', 'c'], ['e'], ['d']]);
  });

  it('takes a row of its own at the bottom of the form', () => {
    const p = payload([{ id: 'r1', fields: [q({ id: 'a' }), q({ id: 'b' })] }]);
    expect(order(moveQuestion(p, 'a', 'down'))).toEqual([['b'], ['a']]);
  });

  it('does nothing above the first row or below the last', () => {
    const p = payload([{ id: 'r1', fields: [q({ id: 'a' })] }]);
    expect(order(moveQuestion(p, 'a', 'up'))).toEqual([['a']]);
    expect(order(moveQuestion(p, 'a', 'down'))).toEqual([['a']]);
  });

  it('never leaves an empty row behind', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b' }), q({ id: 'c' })] },
    ]);
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      for (const id of ['a', 'b', 'c']) {
        const next = moveQuestion(p, id, dir);
        expect(next.rows.every((r) => r.fields.length > 0)).toBe(true);
      }
    }
  });

  it('keeps every question, whatever the move', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' }), q({ id: 'b' })] },
      { id: 'r2', fields: [q({ id: 'c' })] },
    ]);
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      for (const id of ['a', 'b', 'c']) {
        const ids = flattenQuestions(moveQuestion(p, id, dir)).map((f) => f.question.id);
        expect([...ids].sort()).toEqual(['a', 'b', 'c']);
      }
    }
  });
});

describe('ruleProblems', () => {
  it('finds nothing wrong with a rule pointing at an earlier question', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', showWhen: { questionId: 'a', op: 'answered' } })] },
    ]);
    expect(ruleProblems(p)).toEqual([]);
  });

  it('names both questions when a rule points at a later one', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a', label: 'Is there an NDA?', showWhen: { questionId: 'b', op: 'eq', value: 'Yes' } })] },
      { id: 'r2', fields: [q({ id: 'b', label: 'Counterparty' })] },
    ]);
    const problems = ruleProblems(p);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('forward');
    expect(problems[0].questionId).toBe('a');
    expect(problems[0].questionLabel).toBe('Is there an NDA?');
    expect(problems[0].targetLabel).toBe('Counterparty');
    expect(problems[0].targetNumber).toBe(2);
  });

  it('catches a rule pointing at a question that is no longer in the form', () => {
    // The failure this prevents: `coerceRule` keeps a rule whose target is
    // gone, `computeVisibilityMap` resolves it to hidden, and the author's
    // question vanishes from their own preview with nothing said about it.
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', label: 'Term length', showWhen: { questionId: 'gone', op: 'answered' } })] },
    ]);
    const problems = ruleProblems(p);
    expect(problems).toHaveLength(1);
    expect(problems[0].kind).toBe('missing');
    expect(problems[0].questionId).toBe('b');
    expect(problems[0].targetLabel).toBeUndefined();
  });

  it('reports the question deleting a controller left dangling', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', showWhen: { questionId: 'a', op: 'answered' } })] },
    ]);
    expect(ruleProblems(p)).toEqual([]);
    expect(ruleProblems(deleteQuestion(p, 'a')).map((x) => x.kind)).toEqual(['missing']);
  });

  it('catches an is / is not rule with no value to compare against', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', showWhen: { questionId: 'a', op: 'eq', value: '' } })] },
    ]);
    expect(ruleProblems(p).map((x) => x.kind)).toEqual(['value']);
  });

  it('is deliberately stricter than the publish validator about that empty value', () => {
    // This pins a known divergence. `validateFormPayload` only checks that
    // `value` is a string, so '' publishes; the builder blocks it because the
    // question it guards could never appear. If the server ever starts or
    // stops rejecting this, one of these two assertions fails instead of the
    // two gates quietly disagreeing.
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', showWhen: { questionId: 'a', op: 'eq', value: '' } })] },
    ]);
    expect(validateFormPayload(p).ok).toBe(true);
    expect(ruleProblems(p).map((x) => x.kind)).toEqual(['value']);
  });

  it('does not ask an "has any answer" rule for a value', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', showWhen: { questionId: 'a', op: 'answered' } })] },
    ]);
    expect(ruleProblems(p)).toEqual([]);
  });

  it('agrees with the publish validator about a forward reference', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a', showWhen: { questionId: 'b', op: 'answered' } })] },
      { id: 'r2', fields: [q({ id: 'b' })] },
    ]);
    expect(ruleProblems(p)).not.toEqual([]);
    expect(validateFormPayload(p).ok).toBe(false);
  });
});

describe('partnerDegradations', () => {
  it('says nothing about the three types older partner apps render natively', () => {
    const p = payload([
      {
        id: 'r1',
        fields: [
          q({ id: 'a', type: 'short_text' }),
          q({ id: 'b', type: 'select', config: { options: ['A'] } }),
          q({ id: 'c', type: 'yesno' }),
        ],
      },
    ]);
    expect(partnerDegradations(p).types).toEqual([]);
  });

  it('lists each degraded type once, in the order the form uses them', () => {
    const p = payload([
      { id: 'r1', fields: [q({ id: 'a', type: 'date' }), q({ id: 'b', type: 'currency' })] },
      { id: 'r2', fields: [q({ id: 'c', type: 'date' })] },
    ]);
    expect(partnerDegradations(p).types).toEqual([
      { type: 'date', renderedAs: 'text' },
      { type: 'currency', renderedAs: 'text' },
    ]);
  });

  it('reports a multiselect as the single-choice list it becomes', () => {
    const p = payload([{ id: 'r1', fields: [q({ id: 'a', type: 'multiselect', config: { options: ['A'] } })] }]);
    expect(partnerDegradations(p).types).toEqual([{ type: 'multiselect', renderedAs: 'select' }]);
  });

  it('reports conditional questions separately, because those degrade by being always shown', () => {
    const plain = payload([{ id: 'r1', fields: [q({ id: 'a' })] }]);
    expect(partnerDegradations(plain).conditional).toBe(0);
    const conditional = payload([
      { id: 'r1', fields: [q({ id: 'a' })] },
      { id: 'r2', fields: [q({ id: 'b', showWhen: { questionId: 'a', op: 'answered' } })] },
    ]);
    expect(partnerDegradations(conditional).conditional).toBe(1);
  });
});

describe('TYPE_GROUPS', () => {
  it('offers every question type the schema knows about, exactly once', () => {
    // The picker is the only way to create a question, so a type missing from
    // a group is a type nobody can ever use.
    const offered = TYPE_GROUPS.flatMap((g) => g.types);
    expect([...offered].sort()).toEqual([...QUESTION_TYPES].sort());
  });
});

describe('startingDraft', () => {
  const published = payload([{ id: 'r1', fields: [q({ id: 'a', label: 'Published' })] }]);

  it('takes the saved draft when there is one', () => {
    const draft = { schemaVersion: 1, rows: [{ id: 'd1', fields: [{ id: 'z', key: 'z', type: 'email', label: 'Draft', required: false, config: {} }] }] };
    const start = startingDraft(draft, published);
    expect(start.source).toBe('draft');
    expect(start.payload.rows[0].fields[0].label).toBe('Draft');
  });

  it('keeps a draft question whose label has not been typed yet', () => {
    // `readFormPayload` drops this question. The builder must not: it is the
    // question the author is looking at.
    const draft = { schemaVersion: 1, rows: [{ id: 'd1', fields: [{ id: 'z', key: 'z', type: 'short_text', label: '', required: false, config: {} }] }] };
    expect(startingDraft(draft, null).payload.rows[0].fields).toHaveLength(1);
  });

  it('offers the published form as the starting point when there is no draft', () => {
    const start = startingDraft(null, published);
    expect(start.source).toBe('published');
    expect(start.payload.rows[0].fields[0].label).toBe('Published');
  });

  it('starts empty when there is neither', () => {
    expect(startingDraft(null, null)).toEqual({ source: 'empty', payload: { schemaVersion: 1, rows: [] } });
    expect(startingDraft({ schemaVersion: 1, rows: [] }, null).source).toBe('empty');
  });

  it('survives a draft that is not a payload at all', () => {
    for (const junk of ['rows', 42, [], true]) {
      expect(startingDraft(junk, null).payload.rows).toEqual([]);
    }
  });
});
