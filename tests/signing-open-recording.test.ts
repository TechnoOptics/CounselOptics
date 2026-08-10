import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A recorded open or download is attributable to the right document and the
 * right recipient, or it is worse than nothing.
 *
 * These events are read back and reported to a firm and to the colleague who
 * filed the document, and an event on the wrong request or the wrong signer is
 * a false statement about a real person on a legal matter. This file drives
 * GET /api/firm/sign/document/[token] for real and asserts what it wrote.
 *
 * The properties held down:
 *   1. A browser pointed at the file records a download, carrying the signing
 *      request id and the signer address off the row the TOKEN resolved to.
 *      Not off anything the caller supplied: the caller supplies the token
 *      and nothing else.
 *   2. The signing page's own render fetch records NOTHING. It happens on
 *      every page load and is not a download by any reading; recording it
 *      would tell a firm the recipient saved a file they never asked for.
 *   3. A refused request records nothing. An event describing bytes that were
 *      never served is a fabricated fact.
 *   4. An audit write that fails does not cost the signer the document.
 *
 * Mutations this file is meant to catch, each verified red:
 *   - record on every purpose rather than only 'navigate'
 *   - move the append above the delivery refusal
 *   - take the request id or signer email from anywhere but the resolved row
 */

const audit = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  throwOnAppend: false,
  reset() {
    this.events = [];
    this.throwOnAppend = false;
  },
}));

const row = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock('@/lib/esign-audit', () => ({
  appendSignatureEvent: async (
    _admin: unknown,
    input: Record<string, unknown>,
  ) => {
    if (audit.throwOnAppend) throw new Error('events table is gone');
    audit.events.push(input);
    return { id: 'evt-1', eventHash: 'hash' };
  },
}));

vi.mock('@/lib/firm-storage', () => ({
  getSignatureByToken: async () => row.value,
}));

const PDF = new Blob([new Uint8Array(2048)], { type: 'application/pdf' });

vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    storage: {
      from: () => ({
        info: async () => ({ data: { size: PDF.size } }),
        download: async () => ({ data: PDF, error: null }),
      }),
    },
  }),
}));

const { GET } = await import('@/app/api/firm/sign/document/[token]/route');

const REQUEST_ID = 'req-9f3a';
const OTHER_REQUEST_ID = 'req-not-this-one';
const SIGNER = 'counterparty@example.com';

function signatureRow(over?: {
  signedAt?: string | null;
  signerCanDownload?: boolean;
}) {
  return {
    signature: {
      id: 'sig-1',
      token: 'tok',
      signerEmail: SIGNER,
      signedAt: over?.signedAt ?? null,
      accessCodeRequired: false,
      accessVerifiedAt: null,
      response: null,
    },
    request: {
      id: REQUEST_ID,
      status: 'sent',
      signerCanDownload: over?.signerCanDownload ?? true,
      documentSha256: 'abc123',
    },
    document: { signableFilePath: 'firm/doc-signable.pdf', filePath: null },
    firm: { id: 'firm-1', name: 'Firm' },
  };
}

/** A GET whose Fetch Metadata says what the client is going to do. */
function fetchFor(kind: 'navigate' | 'render' | 'unstated') {
  const headers: Record<string, string> = {
    'user-agent': 'Mozilla/5.0 Chrome/126.0',
    'x-forwarded-for': '203.0.113.9',
  };
  if (kind === 'navigate') {
    headers['sec-fetch-dest'] = 'document';
    headers['sec-fetch-mode'] = 'navigate';
  } else if (kind === 'render') {
    headers['sec-fetch-dest'] = 'empty';
    headers['sec-fetch-mode'] = 'cors';
  }
  return new Request('https://advottic.test/api/firm/sign/document/tok', {
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

const params = { params: { token: 'tok' } };

beforeEach(() => {
  audit.reset();
  row.value = signatureRow();
});

describe('a browser pointed at the file records a download', () => {
  it('records it against the request and signer the token resolved to', async () => {
    const res = await GET(fetchFor('navigate'), params);
    expect(res.status).toBe(200);
    expect(audit.events).toHaveLength(1);
    const event = audit.events[0];
    expect(event.eventType).toBe('document_downloaded');
    // The identity comes off the resolved row. The caller supplied a token
    // and nothing else, so there is nothing here they could have steered.
    expect(event.signingRequestId).toBe(REQUEST_ID);
    expect(event.signingRequestId).not.toBe(OTHER_REQUEST_ID);
    expect(event.signatureId).toBe('sig-1');
    expect(event.signerEmail).toBe(SIGNER);
    // And it is the same document the request was hashed over.
    expect(event.documentSha256).toBe('abc123');
  });

  it('is distinct from copy_downloaded, which is the executed instrument', async () => {
    await GET(fetchFor('navigate'), params);
    expect(audit.events[0].eventType).not.toBe('copy_downloaded');
  });
});

describe('nothing else is recorded as a download', () => {
  it('records nothing for the signing page own render fetch', async () => {
    // This fires on every load of the signing page. Recording it would tell
    // a firm the recipient saved a file, on the strength of the page having
    // drawn itself.
    const res = await GET(fetchFor('render'), params);
    expect(res.status).toBe(200);
    expect(audit.events).toHaveLength(0);
  });

  it('records nothing for a client that stated no purpose', async () => {
    // Safari before 16.4 and a number of in-app webviews send no Fetch
    // Metadata and are doing the render fetch above. Under-reporting is the
    // safe direction; inventing a download is not.
    const res = await GET(fetchFor('unstated'), params);
    expect(res.status).toBe(200);
    expect(audit.events).toHaveLength(0);
  });

  it('records nothing when the firm withheld the file and the request was refused', async () => {
    row.value = signatureRow({ signerCanDownload: false });
    const res = await GET(fetchFor('navigate'), params);
    expect(res.status).toBe(403);
    // No bytes were served, so there is no download to describe.
    expect(audit.events).toHaveLength(0);
  });

  it('records nothing when the document was refused outright', async () => {
    row.value = signatureRow({ signedAt: '2026-08-01T00:00:00.000Z' });
    const res = await GET(fetchFor('navigate'), params);
    expect(res.status).toBe(403);
    expect(audit.events).toHaveLength(0);
  });
});

describe('the audit write never costs the recipient the document', () => {
  it('still serves the file when the event cannot be written', async () => {
    audit.throwOnAppend = true;
    const res = await GET(fetchFor('navigate'), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });
});

/**
 * The open half of the same question, checked at the call site.
 *
 * app/sign/[token]/page.tsx is an async server component reaching for
 * next/headers, and there is no DOM in this environment; it is verified in a
 * browser, the way tests/signer-view.test.ts and
 * tests/signing-handoff-routes.test.ts verify the rest of this ceremony.
 * What can be held down without one is the wiring, and the wiring is where
 * the property lives: an open event that does not carry the attribution reads
 * back as 'unverified' and a link scanner is counted as the recipient.
 */
describe('the sign page records what the request said about who made it', () => {
  const source = readFileSync(
    join(__dirname, '..', 'app/sign/[token]/page.tsx'),
    'utf8',
  );

  it('classifies the open and puts the answer on the event', () => {
    expect(source).toContain('classifyOpenAttribution');
    expect(source).toContain('OPEN_ATTRIBUTION_KEY');
    // The classifier is fed the headers it needs to say 'automated' at all.
    // Without sec-purpose it cannot see a browser prefetch, and without the
    // user agent it cannot see a scanner naming itself.
    for (const header of [
      "h.get('sec-purpose')",
      "h.get('purpose')",
      "h.get('x-purpose')",
      "h.get('x-moz')",
      "h.get('sec-fetch-user')",
    ]) {
      expect(source, header).toContain(header);
    }
    expect(source).toMatch(/metadata:\s*\{\s*\[OPEN_ATTRIBUTION_KEY\]:\s*attribution\s*\}/);
  });
});
