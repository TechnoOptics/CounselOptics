import { describe, expect, it } from 'vitest';
import { intakeViewTest, type IntakeListRow } from '../lib/intake-list';

/**
 * The inbox offered "All open 4" and "Unassigned 7" over the same seven rows.
 *
 * Every lane except Everything is a view of OPEN work, and three of them did
 * not test the state at all: unassigned was simply "nobody's name on it", so a
 * CLOSED request with no owner still counted as work waiting for an owner.
 * mine and urgent had the same shape.
 *
 * It was invisible while every request in the workspace was open. Closing
 * three test requests in a real firm made it visible immediately, which is the
 * sort of miscount somebody notices while reading over your shoulder.
 */

const row = (over: Partial<IntakeListRow>): IntakeListRow =>
  ({
    id: 'r1',
    reference: 'ZT0001000',
    subject: 'A request',
    requester: 'Someone',
    state: 'open',
    assignedTo: null,
    priority: 'Normal',
    source: 'internal',
    updatedAt: '2026-08-24T00:00:00.000Z',
    createdAt: '2026-08-24T00:00:00.000Z',
    ...over,
  }) as unknown as IntakeListRow;

const DECIDED = ['completed', 'closed', 'cancelled'] as const;
const ME = 'user-me';

describe('a decided request is not open work', () => {
  /** Mutation: drop live() from the unassigned lane. Goes red. */
  it.each(DECIDED)('unassigned does not count a %s request with no owner', (state) => {
    const r = row({ state, assignedTo: null } as Partial<IntakeListRow>);
    expect(intakeViewTest('unassigned', ME)(r)).toBe(false);
  });

  /** Mutation: drop live() from the mine lane. Goes red. */
  it.each(DECIDED)('mine does not count a %s request assigned to me', (state) => {
    const r = row({ state, assignedTo: ME } as Partial<IntakeListRow>);
    expect(intakeViewTest('mine', ME)(r)).toBe(false);
  });

  /** Mutation: drop live() from the urgent lane. Goes red. */
  it.each(DECIDED)('urgent does not count a %s request marked Urgent', (state) => {
    const r = row({ state, priority: 'Urgent' } as Partial<IntakeListRow>);
    expect(intakeViewTest('urgent', ME)(r)).toBe(false);
  });
});

describe('the lanes still count the work they are for', () => {
  it('unassigned counts an open request with no owner', () => {
    expect(intakeViewTest('unassigned', ME)(row({ state: 'open', assignedTo: null }))).toBe(true);
  });

  it('mine counts an open request assigned to me', () => {
    expect(intakeViewTest('mine', ME)(row({ state: 'open', assignedTo: ME }))).toBe(true);
  });

  it('urgent counts an open request marked Urgent', () => {
    expect(
      intakeViewTest('urgent', ME)(row({ state: 'open', priority: 'Urgent' } as Partial<IntakeListRow>)),
    ).toBe(true);
  });

  it('new and awaiting need no state test, because their states are already live', () => {
    expect(intakeViewTest('new', ME)(row({ state: 'new' }))).toBe(true);
    expect(intakeViewTest('waiting', ME)(row({ state: 'awaiting_signatures' }))).toBe(true);
  });
});

describe('Everything means everything', () => {
  /**
   * The one lane that must NOT be narrowed. It is named so nobody expects it
   * to hide finished work, and it is how somebody finds a closed request.
   *
   * Mutation: apply live() to 'all'. Goes red.
   */
  it.each(DECIDED)('counts a %s request', (state) => {
    expect(intakeViewTest('all', ME)(row({ state } as Partial<IntakeListRow>))).toBe(true);
  });
});

describe('open never counts a decided request', () => {
  it.each(DECIDED)('excludes %s', (state) => {
    expect(intakeViewTest('open', ME)(row({ state } as Partial<IntakeListRow>))).toBe(false);
  });
});
