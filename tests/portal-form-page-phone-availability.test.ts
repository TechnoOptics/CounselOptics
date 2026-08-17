import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * The wiring, which is the part a component test cannot reach.
 *
 * tests/employee-form-phone-signing.test.ts proves the form honours
 * phoneHandoffAvailable. It would go on proving that while this page passed a
 * hardcoded true, which is exactly the defect being fixed: the card was never
 * told anything, it just assumed. So this drives the real server component and
 * renders what it returns, with the probe answering the way production
 * answers it today.
 *
 * The probe is the only thing stubbed on that path. Nothing here asserts that
 * a name appears in a file.
 */

let tableExists = true;

/**
 * The request's own user agent, which is where the answer to "is this person
 * holding a phone" has to come from.
 *
 * A real header, read by the real page, because the whole point of deriving it
 * on the server is that no client effect can lose a race to the first paint.
 * Defaults to a desktop so every assertion written before the device mattered
 * keeps asserting exactly what it always did.
 */
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
let requestUserAgent = DESKTOP_UA;

vi.mock('next/headers', () => ({
  headers: () => new Headers({ 'user-agent': requestUserAgent }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  redirect: () => {
    throw new Error('redirected');
  },
  notFound: () => {
    throw new Error('not found');
  },
}));

vi.mock('../lib/persona', () => ({
  getWorkspacePersona: async () => ({
    kind: 'employee',
    firm: { id: 'f1', name: 'Anderson Foundation' },
    employee: { displayName: 'Jane Okafor', email: 'jane@example.com' },
  }),
}));

vi.mock('../lib/firm-templates', () => ({
  getPortalTemplateAction: async () => ({
    ok: true,
    template: {
      id: 't1',
      firmId: 'f1',
      name: 'Mutual NDA',
      description: '',
      category: 'nda',
      body: 'Agreement body.',
      fields: [],
      status: 'published',
      requiresApproval: true,
      deliveryMode: 'signature',
      // What a database without 20260814_signature_methods.sql reports:
      // no restriction recorded, so every method is allowed.
      signatureMethods: null,
      documentLayout: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  }),
}));

vi.mock('../lib/mark-handoff-queries', () => ({
  markHandoffFeatureAvailable: async () => tableExists,
}));

vi.mock('../app/portal/forms/[id]/mark-handoff-actions', () => ({
  mintPhoneMarkAction: async () => ({ ok: false, error: 'stub' }),
  collectPhoneMarkAction: async () => ({ mark: null }),
}));

const PortalFormFillPage = (await import('../app/portal/forms/[id]/page')).default;

async function render(): Promise<string> {
  const element = await PortalFormFillPage({ params: { id: 't1' } });
  return renderToStaticMarkup(element as never);
}

/** The card's own button label. Its presence is the QR option being offered. */
/**
 * The phone is offered through a TAB now, not a card below the pad.
 *
 * It used to render as its own block under the signature pad, with a "Sign
 * with mobile" button always in the markup. That was reported as the phone
 * being missing from the options: three tabs on one row and the fourth way
 * somewhere further down does not read as four ways of signing.
 *
 * So the assertion moves with it. What is checked is still "is the phone
 * offered", but the evidence is the tab in the strip rather than a button in
 * a panel that is now only mounted once the tab is chosen. Asserting the old
 * string here would have kept passing right up until the day it silently
 * meant nothing.
 */
const QR_BUTTON = 'Phone';

describe('the employee form page', () => {
  it('offers the phone when this database has the handoff table', async () => {
    tableExists = true;
    requestUserAgent = DESKTOP_UA;
    expect(await render()).toContain(QR_BUTTON);
  });

  /**
   * Production today: both migrations unapplied. The template reads as
   * unrestricted, which used to be the whole of the decision and meant the
   * phone was offered on a database that could not mint a handoff.
   */
  it('does not offer the phone when the handoff table is absent', async () => {
    tableExists = false;
    requestUserAgent = DESKTOP_UA;
    const html = await render();
    expect(html).not.toContain(QR_BUTTON);
    // And the rest of the page is untouched: this employee signs on the pad.
    expect(html).toContain('>Draw<');
    expect(html).toContain('intend that the mark above be my signature');
  });
});

/**
 * The device, established the same way and for the same reason.
 *
 * Whether the firm ALLOWS the phone and whether the handoff is POSSIBLE were
 * already two questions asked of two authorities. This is the third: whether
 * the person is on a phone at all. Offering to show a code for them to scan
 * with their phone, on their phone, is not a handoff.
 *
 * It is derived HERE, from the request, and not in the browser. The 5th App
 * Store rejection (2.1(b), 2026-07-02) was app/billing/tier-card.tsx resolving
 * the device in a client effect that had not finished by the first paint, so
 * the wrong UI rendered and shipped. A header is present before the first byte,
 * so this decision cannot be raced. Driving the real page with a real header is
 * what proves the page asks the request rather than the window.
 */
describe('the employee form page, on a phone', () => {
  it('does not offer a code to scan with the device showing it', async () => {
    tableExists = true;
    requestUserAgent = PHONE_UA;
    const html = await render();
    expect(html).not.toContain(QR_BUTTON);
  });

  /** The pad is the screen already in their hand, and it is still there. */
  it('leaves the employee the pad to draw on', async () => {
    tableExists = true;
    requestUserAgent = PHONE_UA;
    const html = await render();
    expect(html).toContain('>Draw<');
    expect(html).toContain('intend that the mark above be my signature');
  });

  /**
   * A tablet is not a phone, decided explicitly rather than fallen out of a
   * breakpoint. See tests/phone-user-agent.test.ts for why, including that
   * iPadOS reports a desktop user agent by default and so cannot be identified
   * this way reliably in the first place.
   */
  it('still offers the handoff on a tablet', async () => {
    tableExists = true;
    requestUserAgent =
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(await render()).toContain(QR_BUTTON);
  });

  /** No user agent at all reads as not-a-phone, which is the answer that
   *  changes nothing about the page that shipped. */
  it('still offers the handoff when the request says nothing', async () => {
    tableExists = true;
    requestUserAgent = '';
    expect(await render()).toContain(QR_BUTTON);
  });
});
