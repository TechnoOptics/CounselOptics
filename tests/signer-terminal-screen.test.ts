import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIGNER_ALREADY_SIGNED_SENTENCE,
  SIGNER_COPY_RETENTION_DAYS,
  SIGNER_COPY_RETENTION_EXPIRED_COPY,
} from '../lib/signer-retention';

/**
 * The terminal screen, rendered rather than grepped.
 *
 * Copy is the deliverable of this slice, so asserting that a sentence
 * exists in a source file is not enough: slice 2 of this plan already
 * found a guard that was present and had nothing reaching it. The sign
 * page is a server component, which is to say a plain function
 * returning an element tree, so it can be CALLED here and the words a
 * signer would actually read pulled out of what it returns. No DOM and
 * no renderer are needed, which matters because vitest runs in
 * environment: 'node' and no jsdom is being added.
 *
 * What is being held to account:
 *
 *   - the screen states that the document cannot be signed AGAIN, and
 *     never that the link is dead, deleted or expired, because the link
 *     demonstrably still resolves (it just served this page);
 *   - the retention window is stated in days rather than implied;
 *   - the access code is mentioned only to a signer who was issued one;
 *   - and once the window has closed the page stops offering a download
 *     the copy route would refuse.
 */

const store = vi.hoisted(() => ({
  signedAt: '2026-08-01T12:00:00.000Z' as string | null,
  completedAt: null as string | null,
  accessCodeRequired: true,
  signerCanDownload: true,
  signedFilePath: 'firm-1/req-1/executed.pdf' as string | null,
}));

vi.mock('@/lib/firm-storage', () => ({
  getSignatureByToken: async () => ({
    signature: {
      id: 'sig-1',
      token: 'tok-1',
      signerEmail: 'counterparty@example.test',
      signerName: 'A Counterparty',
      signedAt: store.signedAt,
      response: null,
      accessCodeRequired: store.accessCodeRequired,
      accessVerifiedAt: store.accessCodeRequired ? '2026-08-01T11:00:00.000Z' : null,
      positionPage: 1,
      positionX: 0.1,
      positionY: 0.1,
    },
    request: {
      id: 'req-1',
      status: 'completed',
      message: null,
      completedAt: store.completedAt,
      signerCanDownload: store.signerCanDownload,
      signedFilePath: store.signedFilePath,
    },
    document: { name: 'Mutual NDA', filePath: 'firm-1/doc-1/nda.pdf', signableFilePath: null },
    firm: { name: 'Anderson Foundation', accentColor: '#c9a24a' },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabase: () => null }));
vi.mock('@/lib/esign-audit', () => ({ appendSignatureEvent: async () => {} }));
vi.mock('@/lib/i18n/locale', () => ({ getLocaleCookie: async () => 'en' }));
vi.mock('next/headers', () => ({ headers: () => new Map() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('next/link', () => ({ default: (p: unknown) => ({ type: 'a', props: p }) }));
// The ceremony below the terminal branch. Stubbed because it pulls in
// the pdf.js runtime, which this branch never reaches and which has no
// business being loaded to read a sentence.
vi.mock('@/app/sign/[token]/signer-surface', () => ({ SignerSurface: () => null }));
vi.mock('@/app/sign/[token]/signer-response', () => ({ SignerResponse: () => null }));
vi.mock('@/app/sign/[token]/access-code-gate', () => ({ AccessCodeGate: () => null }));
vi.mock('@/components/TraceWatermark', () => ({ TraceWatermark: () => null }));
vi.mock('@/components/i18n/AutoTranslate', () => ({
  AutoTranslate: (p: { children?: unknown }) => p.children,
}));
vi.mock('@/components/i18n/LanguageSwitcher', () => ({ LanguageSwitcher: () => null }));

/** Every string in a returned element tree, joined and normalised. */
function textOf(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
  } else if (Array.isArray(node)) {
    for (const child of node) textOf(child, out);
  } else if (node && typeof node === 'object') {
    const el = node as { props?: { children?: unknown } };
    if (el.props && typeof el.props === 'object') textOf(el.props.children, out);
  }
  return out;
}

let SignPage: (args: { params: { token: string } }) => Promise<unknown>;

async function screen(): Promise<string> {
  const tree = await SignPage({ params: { token: 'tok-1' } });
  return textOf(tree).join(' ').replace(/\s+/g, ' ');
}

beforeEach(async () => {
  store.signedAt = '2026-08-01T12:00:00.000Z';
  store.completedAt = null;
  store.accessCodeRequired = true;
  store.signerCanDownload = true;
  store.signedFilePath = 'firm-1/req-1/executed.pdf';
  vi.resetModules();
  SignPage = (await import('@/app/sign/[token]/page')).default as typeof SignPage;
}, 20_000);

describe('after signing', () => {
  it('says the document cannot be signed again', async () => {
    store.completedAt = new Date().toISOString();
    expect(await screen()).toContain(SIGNER_ALREADY_SIGNED_SENTENCE);
  });

  it('states the retention window in days rather than implying one', async () => {
    store.completedAt = new Date().toISOString();
    const text = await screen();
    expect(text).toContain(`for ${SIGNER_COPY_RETENTION_DAYS} more days so you can keep your copy`);
  });

  it('tells a signer with a code that they will need it, and one without nothing', async () => {
    store.completedAt = new Date().toISOString();
    store.accessCodeRequired = true;
    expect(await screen()).toContain('You will need your access code to open it.');

    store.accessCodeRequired = false;
    vi.resetModules();
    SignPage = (await import('@/app/sign/[token]/page')).default as typeof SignPage;
    expect(await screen()).not.toContain('access code');
  });

  it('offers the copy while the window is open', async () => {
    store.completedAt = new Date().toISOString();
    expect(await screen()).toContain('Download your copy');
  });

  it('stops offering the copy, and says where it is, once the window has passed', async () => {
    // The page must not put a button in front of a signer that the copy
    // route is going to refuse. Both read resolveSignerCopyRetention.
    store.completedAt = new Date(
      Date.now() - (SIGNER_COPY_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
    ).toISOString();
    const text = await screen();
    expect(text).not.toContain('Download your copy');
    expect(text).toContain(SIGNER_COPY_RETENTION_EXPIRED_COPY);
  });

  it('says "at least" while the other party has not signed yet', async () => {
    store.completedAt = null;
    expect(await screen()).toContain(
      `for at least ${SIGNER_COPY_RETENTION_DAYS} days after everyone has signed`,
    );
  });

  it('never claims the link is gone, or that screenshots are prevented', async () => {
    // The page the signer is reading was served BY the link. Telling
    // them it no longer exists would be contradicted by the fact that
    // they are looking at it. Screenshots are the other claim this repo
    // has decided in writing that it will not make.
    const forbidden =
      /\b(deleted|destroyed|dead|revoked|no longer exists|screenshot|screen recording|link has expired|link is invalid)\b/i;
    for (const completedAt of [
      null,
      new Date().toISOString(),
      new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString(),
    ]) {
      store.completedAt = completedAt;
      expect(await screen()).not.toMatch(forbidden);
    }
  });

  it("keeps the firm's own refusal when downloads were turned off", async () => {
    // A firm that withheld the copy must not be overridden by a
    // retention sentence promising the signer a download.
    store.completedAt = new Date().toISOString();
    store.signerCanDownload = false;
    const text = await screen();
    expect(text).toContain(SIGNER_ALREADY_SIGNED_SENTENCE);
    expect(text).toContain('The firm has not enabled downloads for this document.');
    expect(text).not.toContain('Download your copy');
    expect(text).not.toContain('so you can keep your copy');
  });
});

describe('before signing', () => {
  it('describes what the link does rather than calling it single-use', async () => {
    store.signedAt = null;
    const text = await screen();
    expect(text).toContain('This link can be used to sign once.');
    expect(text).toContain(
      `Afterwards it stays available to you for ${SIGNER_COPY_RETENTION_DAYS} days so you can download your copy.`,
    );
    // The word that was wrong: it described the URL, and the URL is not
    // consumed by signing.
    expect(text).not.toContain('single-use');
  });
});
