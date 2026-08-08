import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The rate control has to be ON the team row, and it has to show the rate the
 * row is for.
 *
 * This renders the row and reads the markup that comes out, rather than
 * matching source text. A source-level guard would still pass with the control
 * left in a comment, imported and never used, or rendered with the wrong user
 * id - all of which have shipped in this repo. Rendering also proves the number
 * survives the trip: the field below has to read 450.00, which only happens if
 * 45000 cents went through the formatter and into the input.
 *
 * Being drawn is NOT the gate. `setFirmMemberRateAction` is a `'use server'`
 * export and therefore a public endpoint; its owner/admin gate is asserted in
 * tests/billing-rate-action.test.ts against direct calls.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock('@/components/i18n/LocaleProvider', () => ({
  T: ({ children }: { children?: unknown }) => children ?? null,
  useT: () => (s: string) => s,
}));
vi.mock('@/lib/firm-actions', () => ({
  removeFirmMemberAction: async () => ({ ok: true }),
  updateFirmMemberRoleAction: async () => ({ ok: true }),
  transferFirmOwnershipAction: async () => ({ ok: true }),
}));
vi.mock('@/lib/time-tracking', () => ({
  setFirmMemberRateAction: async () => ({ ok: true }),
}));

const { TeamMemberRow } = await import('../app/counsel/team/member-row');

const MEMBER = {
  id: 'm-1',
  firmId: 'firm-1',
  userId: 'user-attorney',
  role: 'attorney' as const,
  displayName: 'A. Attorney',
  email: 'a@example.test',
  joinedAt: '2026-01-01T00:00:00.000Z',
};

/** The row, rendered inside the table it lives in so the markup is valid. */
function render(over: Record<string, unknown> = {}): string {
  const props = {
    member: MEMBER,
    firmId: 'firm-1',
    canManage: true,
    isMe: false,
    isLastOwner: false,
    otherMembers: [],
    rateCents: 45000,
    ...over,
  } as Parameters<typeof TeamMemberRow>[0];
  return renderToStaticMarkup(
    createElement(
      'table',
      null,
      createElement('tbody', null, createElement(TeamMemberRow, props)),
    ),
  );
}

/** The rate field, found by the label a screen reader would announce. */
function rateField(html: string): string | null {
  const match = /<input[^>]*aria-label="Hourly rate in dollars"[^>]*>/.exec(html);
  return match ? match[0] : null;
}

describe('the team row carries a rate control for an owner/admin', () => {
  it('renders the field with the member’s current rate in it', () => {
    const field = rateField(render());
    expect(field).not.toBeNull();
    expect(field).toContain('value="450.00"');
  });

  it('renders an empty field, not a zero, when no rate is set', () => {
    const field = rateField(render({ rateCents: null }));
    expect(field).not.toBeNull();
    expect(field).toContain('value=""');
    // And says plainly what that costs, rather than leaving a blank box.
    expect(render({ rateCents: null })).toContain(
      'Time logged now bills at $0.00.',
    );
  });

  it('draws no rate field for a viewer who cannot manage the firm', () => {
    expect(rateField(render({ canManage: false }))).toBeNull();
  });
});
