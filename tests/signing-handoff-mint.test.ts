import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  desktopConsentForHandoff,
  handoffQrUrl,
  mergeHandoffConsent,
  HANDOFF_TTL_MINUTES,
} from '../lib/signing-handoff';
import {
  mintSigningHandoff,
  MINT_REFUSAL_ACCESS_CODE,
  MINT_REFUSAL_ALREADY_SIGNED,
  MINT_REFUSAL_DISCLOSURE,
  MINT_REFUSAL_LINK_INVALID,
  MINT_REFUSAL_ON_HOLD,
  MINT_REFUSAL_UNAVAILABLE,
  type MintHandoffDeps,
  type MintSignatureRow,
} from '../lib/signing-handoff-mint';

/**
 * The laptop side of the QR handoff.
 *
 * mintSigningHandoffAction is a 'use server' export, which is to say a
 * public HTTP endpoint that anyone can call with anything. Its guards
 * are therefore the part worth testing, and they are all reachable here
 * because lib/signing-handoff-mint.ts takes its lookup, its insert and
 * its encoder as arguments instead of reaching for a database.
 *
 * The pad and the rendered QR are verified in a browser, as
 * signature-capture.tsx already is. Everything below is executed.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const DURABLE = 'durable-signer-token-aaaaaaaaaaaaaaaaaaaa';
const HANDOFF = 'handoff-token-bbbbbbbbbbbbbbbbbbbbbbbb';

const CONSENT = {
  electronicRecordsConsentedAt: '2026-08-06T10:00:00.000Z',
  hardwareSoftwareConfirmedAt: '2026-08-06T10:00:00.000Z',
  documentPresented: true,
  documentReviewedAt: '2026-08-06T10:00:01.000Z',
};

function signature(over: Partial<MintSignatureRow> = {}): MintSignatureRow {
  return {
    id: 'sig-1',
    signedAt: null,
    accessCodeHash: null,
    accessCodeVerifiedAt: null,
    response: null,
    ...over,
  };
}

/** Records what the real deps would have been asked to do. */
function deps(over: Partial<MintHandoffDeps> = {}) {
  const encoded: string[] = [];
  const created: { signatureId: string; consent: unknown }[] = [];
  const base: MintHandoffDeps = {
    origin: 'https://advottic.com',
    loadSignature: async () => signature(),
    createHandoff: async (signatureId, consent) => {
      created.push({ signatureId, consent });
      return { ok: true, rawToken: HANDOFF };
    },
    encode: (url) => {
      encoded.push(url);
      return `<svg data-fake-for="${url.length}"></svg>`;
    },
    ...over,
  };
  return { deps: base, encoded, created };
}

describe('the URL the code encodes', () => {
  it('is absolute, so a phone camera has something it can open', () => {
    expect(handoffQrUrl('https://advottic.com', HANDOFF)).toBe(
      `https://advottic.com/sign/m/${HANDOFF}`,
    );
  });

  it('refuses a relative origin rather than encoding a search query', () => {
    // A decoded "/sign/m/..." has no base to resolve against on a
    // phone. It is not a degraded QR, it is not a URL at all.
    expect(() => handoffQrUrl('', HANDOFF)).toThrow();
    expect(() => handoffQrUrl('/', HANDOFF)).toThrow();
    expect(() => handoffQrUrl('advottic.com', HANDOFF)).toThrow();
    expect(() => handoffQrUrl('ftp://advottic.com', HANDOFF)).toThrow();
  });

  it('refuses an empty token rather than encoding a bare path', () => {
    expect(() => handoffQrUrl('https://advottic.com', '   ')).toThrow();
  });

  it('does not double the slash on a configured trailing one', () => {
    expect(handoffQrUrl('https://advottic.com//', HANDOFF)).toBe(
      `https://advottic.com/sign/m/${HANDOFF}`,
    );
  });

  it('keeps a base path a deployment is served under', () => {
    expect(handoffQrUrl('https://example.test/app', HANDOFF)).toBe(
      `https://example.test/app/sign/m/${HANDOFF}`,
    );
  });
});

describe('the disclosure the laptop may carry', () => {
  it('carries the affirmations the signer actually made', () => {
    expect(desktopConsentForHandoff(CONSENT)).toEqual(CONSENT);
  });

  it('is nothing at all without an electronic-records consent', () => {
    expect(desktopConsentForHandoff(null)).toBeNull();
    expect(desktopConsentForHandoff(undefined)).toBeNull();
    expect(desktopConsentForHandoff({})).toBeNull();
    expect(
      desktopConsentForHandoff({ ...CONSENT, electronicRecordsConsentedAt: '' }),
    ).toBeNull();
    expect(
      desktopConsentForHandoff({
        ...CONSENT,
        electronicRecordsConsentedAt: 'sometime last week',
      }),
    ).toBeNull();
  });

  it('drops a review affirmation for a document never presented', () => {
    // The pair is frozen together on the desktop precisely so it can
    // never say the signer read something they were not shown.
    const carried = desktopConsentForHandoff({
      ...CONSENT,
      documentPresented: false,
    });
    expect(carried).not.toBeNull();
    expect(carried?.documentPresented).toBe(false);
    expect(carried?.documentReviewedAt).toBeNull();
  });

  it('treats anything but a literal true as not presented', () => {
    expect(
      desktopConsentForHandoff({ ...CONSENT, documentPresented: 'yes' })
        ?.documentPresented,
    ).toBe(false);
  });

  it('drops an unparseable hardware confirmation instead of inventing one', () => {
    expect(
      desktopConsentForHandoff({
        ...CONSENT,
        hardwareSoftwareConfirmedAt: 'whenever',
      })?.hardwareSoftwareConfirmedAt,
    ).toBeNull();
  });

  it('reads back exactly what it wrote, so the stored blob is re-checked', () => {
    const once = desktopConsentForHandoff(CONSENT);
    expect(desktopConsentForHandoff(once)).toEqual(once);
  });
});

describe('what a mobile-signed row records', () => {
  const phone = {
    intentAffirmedAt: '2026-08-06T10:05:00.000Z',
    uaSnapshot: 'PhoneBrowser/1.0',
    tzOffsetMinutes: -60,
  };

  it('carries the laptop disclosure beside the phone attestation', () => {
    expect(mergeHandoffConsent(CONSENT, phone)).toEqual({
      electronicRecordsConsentedAt: CONSENT.electronicRecordsConsentedAt,
      hardwareSoftwareConfirmedAt: CONSENT.hardwareSoftwareConfirmedAt,
      documentPresented: true,
      documentReviewedAt: CONSENT.documentReviewedAt,
      ...phone,
    });
  });

  it('never lets the carried blob assert an intent nobody affirmed here', () => {
    // Handed to the merge unvalidated, on purpose. desktopConsentForHandoff
    // would strip these fields on the way through, so validating first
    // would test that function again and leave the merge's own half of
    // the guarantee unexercised.
    const carried = {
      ...CONSENT,
      intentAffirmedAt: '2026-08-06T09:00:00.000Z',
      uaSnapshot: 'LaptopBrowser/1.0',
      tzOffsetMinutes: 300,
    } as unknown as Parameters<typeof mergeHandoffConsent>[0];
    const merged = mergeHandoffConsent(carried, {
      intentAffirmedAt: null,
      uaSnapshot: null,
      tzOffsetMinutes: null,
    });
    expect(merged.intentAffirmedAt).toBeNull();
    expect(merged.uaSnapshot).toBeNull();
    expect(merged.tzOffsetMinutes).toBeNull();
    // The disclosure half still comes through, so this is not passing
    // by the whole object being dropped.
    expect(merged.electronicRecordsConsentedAt).toBe(
      CONSENT.electronicRecordsConsentedAt,
    );
  });

  it('drops the phone fields a stored blob carries, even validated', () => {
    const carried = desktopConsentForHandoff({
      ...CONSENT,
      intentAffirmedAt: '2026-08-06T09:00:00.000Z',
    } as never);
    expect(carried).not.toHaveProperty('intentAffirmedAt');
  });

  it('never lets the phone assert a disclosure it did not show', () => {
    // Fields the phone has no business supplying, ignored by type and
    // by construction.
    const smuggled = {
      ...phone,
      electronicRecordsConsentedAt: '2026-08-06T10:04:00.000Z',
      documentPresented: true,
      documentReviewedAt: '2026-08-06T10:04:00.000Z',
    } as unknown as Parameters<typeof mergeHandoffConsent>[1];
    const merged = mergeHandoffConsent(null, smuggled);
    expect(merged.electronicRecordsConsentedAt).toBeNull();
    expect(merged.hardwareSoftwareConfirmedAt).toBeNull();
    expect(merged.documentPresented).toBe(false);
    expect(merged.documentReviewedAt).toBeNull();
    expect(merged.intentAffirmedAt).toBe(phone.intentAffirmedAt);
  });

  it('records an empty disclosure for a handoff that carried none', () => {
    // Older rows, and any row whose blob failed re-validation. An
    // absent affirmation must read as absent, not as a default.
    const merged = mergeHandoffConsent(null, phone);
    expect(merged.electronicRecordsConsentedAt).toBeNull();
    expect(merged.documentPresented).toBe(false);
  });

  it('drops a timezone offset that is not a finite number', () => {
    expect(
      mergeHandoffConsent(CONSENT, { tzOffsetMinutes: Number.NaN })
        .tzOffsetMinutes,
    ).toBeNull();
  });
});

describe('minting refuses', () => {
  it('a blank token, without asking the database anything', async () => {
    let asked = false;
    const d = deps({
      loadSignature: async () => {
        asked = true;
        return signature();
      },
    });
    const result = await mintSigningHandoff('   ', CONSENT, d.deps);
    expect(result).toEqual({ ok: false, error: MINT_REFUSAL_LINK_INVALID });
    expect(asked).toBe(false);
  });

  it('a token that resolves to nothing', async () => {
    const d = deps({ loadSignature: async () => null });
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result).toEqual({ ok: false, error: MINT_REFUSAL_LINK_INVALID });
    expect(d.created).toEqual([]);
  });

  it('a row that has already been signed', async () => {
    const d = deps({
      loadSignature: async () =>
        signature({ signedAt: '2026-08-06T09:00:00.000Z' }),
    });
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result).toEqual({ ok: false, error: MINT_REFUSAL_ALREADY_SIGNED });
    expect(d.created).toEqual([]);
  });

  it('a row the signer has declined or asked to change', async () => {
    for (const response of ['rejected', 'changes_requested'] as const) {
      const d = deps({ loadSignature: async () => signature({ response }) });
      const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
      expect(result).toEqual({ ok: false, error: MINT_REFUSAL_ON_HOLD });
      expect(d.created).toEqual([]);
    }
  });

  it('an external signer who has not entered their access code', async () => {
    // The security property this whole feature rests on. An unmet gate
    // must not be walked around by moving to a second device.
    const d = deps({
      loadSignature: async () =>
        signature({ accessCodeHash: 'hash', accessCodeVerifiedAt: null }),
    });
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result).toEqual({ ok: false, error: MINT_REFUSAL_ACCESS_CODE });
    expect(d.created).toEqual([]);
  });

  it('a caller with no disclosure to hand over', async () => {
    // The capture step is the only place that has one, so this is the
    // ordering guard: consent first, then the code.
    for (const consent of [null, undefined, {}, { documentPresented: true }]) {
      const d = deps();
      const result = await mintSigningHandoff(DURABLE, consent, d.deps);
      expect(result).toEqual({ ok: false, error: MINT_REFUSAL_DISCLOSURE });
      expect(d.created).toEqual([]);
    }
  });

  it('an insert that did not land', async () => {
    const d = deps({ createHandoff: async () => ({ ok: false }) });
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result).toEqual({ ok: false, error: MINT_REFUSAL_UNAVAILABLE });
    expect(d.encoded).toEqual([]);
  });

  it('an origin it cannot build an absolute URL from', async () => {
    const d = deps({ origin: '' });
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result).toEqual({ ok: false, error: MINT_REFUSAL_UNAVAILABLE });
    expect(d.encoded).toEqual([]);
  });

  it('an encoder that throws, rather than showing a broken image', async () => {
    const d = deps({
      encode: () => {
        throw new Error('too much data for a QR');
      },
    });
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result).toEqual({ ok: false, error: MINT_REFUSAL_UNAVAILABLE });
  });

  it('an external signer whose gate is met, only once it is', async () => {
    const d = deps({
      loadSignature: async () =>
        signature({
          accessCodeHash: 'hash',
          accessCodeVerifiedAt: '2026-08-06T09:59:00.000Z',
        }),
    });
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result.ok).toBe(true);
  });
});

describe('minting succeeds', () => {
  it('encodes the handoff token and never the durable signer token', async () => {
    // The property the whole design exists for. An internal signer has
    // no access code in front of /sign/[token], so a QR carrying it
    // could be photographed off the screen and used to sign as them.
    const d = deps();
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result.ok).toBe(true);
    expect(d.encoded).toHaveLength(1);
    expect(d.encoded[0]).toBe(`https://advottic.com/sign/m/${HANDOFF}`);
    expect(d.encoded[0]).not.toContain(DURABLE);
  });

  it('hands the validated consent to the row, not the raw input', async () => {
    const d = deps();
    await mintSigningHandoff(
      DURABLE,
      { ...CONSENT, documentPresented: false, intentAffirmedAt: 'x' } as never,
      d.deps,
    );
    expect(d.created).toEqual([
      {
        signatureId: 'sig-1',
        consent: {
          electronicRecordsConsentedAt: CONSENT.electronicRecordsConsentedAt,
          hardwareSoftwareConfirmedAt: CONSENT.hardwareSoftwareConfirmedAt,
          documentPresented: false,
          documentReviewedAt: null,
        },
      },
    ]);
  });

  it('returns the server lifetime with the code, not a client copy of it', async () => {
    const d = deps();
    const result = await mintSigningHandoff(DURABLE, CONSENT, d.deps);
    expect(result.ok && result.expiresInSeconds).toBe(HANDOFF_TTL_MINUTES * 60);
  });
});

describe('the laptop wiring', () => {
  const ACTIONS = 'app/sign/[token]/handoff-actions.ts';
  const COMPONENT = 'app/sign/[token]/mobile-handoff.tsx';
  const CAPTURE = 'app/sign/[token]/signature-capture.tsx';
  const MOBILE_ROUTE = 'app/api/firm/sign/mobile/route.ts';
  const PAD = 'components/SignaturePad.tsx';

  it('runs the mint through the tested decision, with the real encoder', () => {
    const src = read(ACTIONS);
    expect(src).toMatch(/return mintSigningHandoff\(signerToken, consent, \{/);
    expect(src).toMatch(/encode: qrSvg,/);
    expect(src).toMatch(/createHandoff,/);
  });

  it('never sends a signing credential to a third party', () => {
    // A hosted QR image service would hand a live credential to
    // somebody else's server. lib/qr-svg.ts is server-only for the
    // same reason.
    for (const rel of [ACTIONS, COMPONENT]) {
      expect(read(rel)).not.toMatch(/https?:\/\/(?!advottic\.com)/);
      expect(read(rel)).not.toMatch(/chart\.googleapis|qrserver|api\.qrcode/);
    }
  });

  it('takes the durable token as the only credential, never a row id', () => {
    const src = read(ACTIONS);
    expect(src).toMatch(/mintSigningHandoffAction\(\s*signerToken: string/);
    expect(src).not.toMatch(/signatureId: string/);
  });

  it('offers the code at the capture step and not at the disclosure', () => {
    const src = read(CAPTURE);
    // The single mount sits after the pad, inside the block that
    // returns the capture card. The disclosure step returns earlier,
    // so a mount in it would have to appear before that return.
    const mount = src.indexOf('<MobileHandoff');
    const disclosureReturn = src.indexOf("if (step === 'disclosure')");
    expect(mount).toBeGreaterThan(disclosureReturn);
    expect(src.split('<MobileHandoff')).toHaveLength(2);
  });

  it('hands the mount the same consent capture the desktop submit sends', () => {
    // Sliced to the element itself, not searched over the whole file.
    // The desktop submit body a few lines above names the same state
    // variables, so a file-wide match would go on passing with the
    // element's own props emptied, and a mobile signature would
    // silently record no disclosure at all.
    const src = read(CAPTURE);
    const start = src.indexOf('<MobileHandoff');
    const element = src.slice(start, src.indexOf('/>', start));
    expect(element).toMatch(/signerToken=\{token\}/);
    expect(element).toMatch(/electronicRecordsConsentedAt: erdConsentedAt,/);
    expect(element).toMatch(/hardwareSoftwareConfirmedAt: erdConsentedAt,/);
    expect(element).toMatch(/documentPresented: docPresentedAtReview,/);
    expect(element).toMatch(/documentReviewedAt: docReviewedAt,/);
    // The phone finishing has to close this card, or the signer is left
    // looking at a pad for a signature that already exists.
    expect(element).toMatch(/onSigned=\{\(\) => setStep\('done'\)\}/);
  });

  it('leaves the pad in place beside it', () => {
    // The handoff is a fourth way to make the mark, not a replacement
    // for the other three. The pad itself now lives in
    // components/SignaturePad.tsx, shared with the employee form, so
    // this asserts the capture step still mounts it and that it still
    // offers all three modes rather than grepping this file for state
    // setters that moved.
    expect(read(CAPTURE)).toContain('<SignaturePad');
    const pad = read(PAD);
    for (const mode of [
      "tab('drawn', 'Draw')",
      "tab('typed', 'Type')",
      "tab('uploaded', 'Upload')",
    ]) {
      expect(pad).toContain(mode);
    }
  });

  it('merges the carried disclosure into the phone submit', () => {
    expect(read(MOBILE_ROUTE)).toMatch(
      /consent: mergeHandoffConsent\(bound\.desktopConsent, \{/,
    );
  });

  it('stores the disclosure on the handoff row and reads it back validated', () => {
    // The carriage itself. Written on the insert, selected on the read,
    // and put back through the same validator on the way out, so a blob
    // that was hand-edited or left null cannot become evidence by
    // sitting in a column.
    const src = read('lib/signing-handoff-queries.ts');
    expect(src).toMatch(/desktop_consent: desktopConsent,/);
    expect(src).toMatch(/consumed_at, desktop_consent, firm_signatures!inner/);
    expect(src).toMatch(
      /const desktopConsent = desktopConsentForHandoff\(\s*raw\.desktop_consent/,
    );
    expect(src).toMatch(/desktopConsent: found\.desktopConsent,/);
  });

  it('has a column for it in the migration that creates the table', () => {
    // The migration is unapplied, so this is the only thing that
    // notices if the column and the code stop agreeing.
    expect(read('supabase/migrations/20260801_signature_handoffs.sql')).toMatch(
      /desktop_consent jsonb/,
    );
  });
});
