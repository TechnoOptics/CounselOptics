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
const QR_BUTTON = 'Sign with mobile';

describe('the employee form page', () => {
  it('offers the phone when this database has the handoff table', async () => {
    tableExists = true;
    expect(await render()).toContain(QR_BUTTON);
  });

  /**
   * Production today: both migrations unapplied. The template reads as
   * unrestricted, which used to be the whole of the decision and meant the
   * phone was offered on a database that could not mint a handoff.
   */
  it('does not offer the phone when the handoff table is absent', async () => {
    tableExists = false;
    const html = await render();
    expect(html).not.toContain(QR_BUTTON);
    // And the rest of the page is untouched: this employee signs on the pad.
    expect(html).toContain('>Draw<');
    expect(html).toContain('intend that the mark above be my signature');
  });
});
