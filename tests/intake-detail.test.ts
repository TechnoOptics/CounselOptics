import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { intakeChannel, intakeDeadline } from '../lib/intake-detail';

/**
 * The counsel request detail, rebuilt to the DETAIL pattern in
 * docs/PARITY-PAGE-RULES.md.
 *
 * Two things are pinned here and they are pinned for different reasons.
 *
 * The pure helpers behind the meta row and the action bar's deadline are
 * pinned because they are the only place the page decides what a request's
 * provenance and its deadline ARE, and both are read off a schema-less
 * answers blob where a missing key and an unparseable value look the same.
 *
 * The containment guard is pinned because the whole structural point of the
 * screen is that the controls which CHANGE the record sit in one strip.
 * They were scattered down the page before, and nothing but a guard stops
 * the next person putting one back where it was: a reviewer reading the
 * diff sees a control moved five lines, not a pattern broken.
 */

const page = readFileSync(
  fileURLToPath(new URL('../app/counsel/intake/[id]/page.tsx', import.meta.url)),
  'utf8',
);

describe('intakeChannel', () => {
  it('reads a partner-app ticket from its partner block', () => {
    expect(intakeChannel({ partner: { source: 'acme', externalId: 'X-1' } })).toBe(
      'partner',
    );
  });

  it('reads an employee-filed request from submitted_by', () => {
    expect(intakeChannel({ submitted_by: 'A. Person' })).toBe('portal');
  });

  it('treats a request with neither marker as opened in the firm workspace', () => {
    expect(intakeChannel({})).toBe('firm');
    expect(intakeChannel(null)).toBe('firm');
  });

  it('does not call a blank submitted_by a portal request', () => {
    expect(intakeChannel({ submitted_by: '   ' })).toBe('firm');
  });

});

describe('intakeDeadline', () => {
  const now = Date.parse('2026-08-10T12:00:00Z');

  it('is null when the request carries no date at all', () => {
    expect(intakeDeadline({}, now)).toBeNull();
    expect(intakeDeadline(null, now)).toBeNull();
  });

  it('is null when the date is there but unparseable', () => {
    expect(intakeDeadline({ due_by: 'whenever' }, now)).toBeNull();
  });

  it('reads due_by, and is not breached while it is still ahead', () => {
    const d = intakeDeadline({ due_by: '2026-08-20T09:00:00Z' }, now);
    expect(d).not.toBeNull();
    expect(d!.kind).toBe('due');
    expect(d!.breached).toBe(false);
  });

  it('is breached once due_by is behind us', () => {
    const d = intakeDeadline({ due_by: '2026-08-01T09:00:00Z' }, now);
    expect(d!.breached).toBe(true);
  });

  it('falls back to the reminder when there is no due date', () => {
    const d = intakeDeadline({ reminder_at: '2026-08-20T09:00:00Z' }, now);
    expect(d!.kind).toBe('reminder');
    expect(d!.breached).toBe(false);
  });

  it('prefers the due date over the reminder when both are set', () => {
    const d = intakeDeadline(
      { due_by: '2026-08-01T09:00:00Z', reminder_at: '2026-08-20T09:00:00Z' },
      now,
    );
    expect(d!.kind).toBe('due');
    expect(d!.breached).toBe(true);
  });
});

describe('the request detail gathers its record controls into one strip', () => {
  /** Everything between the opening ActionBar tag and its close. */
  function actionBarSource(): string {
    const open = page.indexOf('<ActionBar');
    const close = page.indexOf('</ActionBar>');
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    return page.slice(open, close);
  }

  it.each([
    ['the folder select', '<FolderPicker'],
    // Was '<DecideJump', a button in this bar whose whole job was to scroll
    // to a section in the right rail. The decision is now the modal this
    // control raises, so the bar holds the decision itself rather than a
    // pointer to it. See tests/ticket-decline-dialog.test.ts.
    ['the way in to declining or closing it', '<DecideRequest'],
  ])('holds %s', (_label, tag) => {
    expect(actionBarSource()).toContain(tag);
  });

  /**
   * Taking the request on as a matter used to be this bar's primary, and this
   * case used to pin it as PRESENT. It is now pinned as an ABSENCE, because
   * removing it was the point: an in-house legal team answers requests rather
   * than opening matters from them, and the owner does not expect that to
   * change. tests/ticket-not-a-matter.test.ts carries the full reasoning and
   * the guard on the read path that survives.
   */
  it('no longer offers taking the request on as a matter', () => {
    expect(actionBarSource()).not.toContain('<ConvertToMatter');
  });

  /**
   * The owner select USED to be pinned here. It is now one field of the ticket
   * management block, alongside the status, the priority and the dates the
   * team runs the request by, rather than being the single one of those that
   * lived somewhere else.
   *
   * Pinned as an ABSENCE rather than deleted, because the failure this guards
   * against is the control being drawn in both places: two selects over one
   * value that can show different things. tests/ticket-workspace.test.ts pins
   * the other half, that it is drawn exactly once.
   */
  it('has handed the owner select to the management block', () => {
    expect(actionBarSource()).not.toContain('<IntakeOwnerSelect');
  });

  it('renders the deadline in the bar rather than leaving it to a card', () => {
    expect(actionBarSource()).toContain('deadline');
  });
});

describe('the request detail keeps to the DETAIL pattern', () => {
  it('puts the people and the matter in an aside, not in the record column', () => {
    expect(page).toContain('<aside');
    // The two-column body the pattern asks for. The rail is 380 rather than
    // the pattern's 340 because it now carries the firm's operations (the
    // conflict check, the decision, Analyze) and not only readouts, and
    // because collapsing the nav rail on this route gave the page the width
    // to spend. The pattern is the two columns, not the number.
    expect(page).toMatch(/lg:grid-cols-\[minmax\(0,1fr\)_380px\]/);
  });

  it('does not link out to a client record the product does not have', () => {
    // PARITY-PAGE-RULES: no affordance without the thing behind it. There
    // is no /counsel/clients/[id] route, so the client card carries no arrow.
    expect(page).not.toMatch(/counsel\/clients\/\$\{/);
  });
});
