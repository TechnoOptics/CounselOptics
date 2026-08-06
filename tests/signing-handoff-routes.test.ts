import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  HANDOFF_REFUSAL_ALREADY_SIGNED,
  HANDOFF_REFUSAL_UNAVAILABLE,
} from '../lib/signing-handoff';

/**
 * The phone route is a page, a canvas and two HTTP handlers, none of
 * which a node-environment test can execute: there is no jsdom here and
 * none is being added, for the same reason app/sign/[token] is verified
 * in a browser. What CAN be checked without a browser is the wiring, and
 * the wiring is where the security properties live. Each test below
 * fails if a specific property is removed from the source.
 *
 * These are the same call-site guards tests/signer-view.test.ts already
 * uses on the desktop half of this ceremony.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const MOBILE_ROUTE = 'app/api/firm/sign/mobile/route.ts';
const CLAIM_ROUTE = 'app/sign/m/[handoff]/route.ts';
const PAD_PAGE = 'app/sign/m/[handoff]/pad/page.tsx';
const PAD = 'app/sign/m/[handoff]/mobile-pad.tsx';
const QUERIES = 'lib/signing-handoff-queries.ts';
const WRITE = 'lib/signature-write.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('one write path', () => {
  it('has exactly one place in the tree that stamps signed_at', () => {
    // The whole point of extracting lib/signature-write.ts. If a second
    // file ever sets signed_at, the desktop and the phone can disagree
    // about what a signed row contains, and "what does this signature
    // record mean" stops having one answer.
    const writers = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))]
      .filter((f) => /signed_at:\s*(new Date|now)/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1));
    expect(writers).toEqual(['lib/signature-write.ts']);
  });

  it('has both signing routes go through that one function', () => {
    expect(read('app/api/firm/sign/route.ts')).toMatch(/recordSignature\(\{/);
    expect(read(MOBILE_ROUTE)).toMatch(/recordSignature\(\{/);
  });

  it('has neither route keep a signature write of its own', () => {
    for (const rel of ['app/api/firm/sign/route.ts', MOBILE_ROUTE]) {
      const src = read(rel);
      expect(src).not.toMatch(/\.from\('firm_signatures'\)/);
      expect(src).not.toMatch(/\.storage\b/);
      expect(src).not.toMatch(/appendSignatureEvent\(/);
    }
  });
});

describe('the phone never receives the durable signer token', () => {
  it('resolves the signature id from the handoff, never from the body', () => {
    const src = read(MOBILE_ROUTE);
    expect(src).toMatch(/locator: \{ kind: 'id', signatureId: bound\.signatureId \}/);
    // A body that named its own row would turn a scanned code into a
    // way to sign somebody else's document.
    expect(src).not.toMatch(/payload\.signatureId/);
    expect(src).not.toMatch(/signatureId\??:\s*string/);
  });

  it('keeps firm_signatures.token out of everything the phone touches', () => {
    // firm_signatures.access_code_hash is set only for external signers,
    // so for an internal signer that token alone is enough to sign as
    // them. Nothing reachable by scanning a code off a screen may read
    // it, select it, or be handed it.
    for (const rel of [MOBILE_ROUTE, CLAIM_ROUTE, PAD_PAGE, PAD]) {
      const src = read(rel);
      expect(src).not.toMatch(/signerToken/);
      expect(src).not.toMatch(/\.eq\('token'/);
      expect(src).not.toMatch(/getSignatureByToken/);
    }
  });

  it('pins the column list the pad is allowed to read', () => {
    // Written out rather than described, so adding token to it is a
    // visible, failing change rather than a quiet one.
    expect(read(QUERIES)).toMatch(
      /\.select\('signer_name, signer_email, signing_request_id'\)/,
    );
  });

  it('never fetches the token into the write module the phone calls', () => {
    // The four files above are the phone's own surface. This one is
    // shared: the phone route calls recordSignature, so every column
    // this module selects lands in server memory on a request that
    // arrived from a scanned code. It cannot be added to the loop
    // above, because the desktop locator legitimately looks a row up
    // BY token here and always will. What can be guarded is that the
    // token is never READ back out, on either path.
    const src = read(WRITE);
    const selects = [
      ...src.matchAll(/from\('firm_signatures'\)\s*\.select\(\s*'([^']*)'/g),
    ];
    // If the shape of these calls changes enough that none match, the
    // loop below would pass by finding nothing to check.
    expect(selects.length).toBeGreaterThanOrEqual(1);
    for (const [, columns] of selects) {
      expect(columns).not.toContain('*');
      expect(columns).not.toContain('token');
    }
  });

  it('keeps the access-code gate columns on that same list', () => {
    // The narrowed list is only safe if narrowing it further is a
    // failing change. access_code_hash and access_code_verified_at feed
    // the server-side one-time-code check, which is what stops a
    // forwarded link from POSTing straight past the gate. Dropped from
    // the select, both read as undefined and the gate passes every
    // caller silently.
    const src = read(WRITE);
    expect(src).toMatch(
      /from\('firm_signatures'\)\s*\.select\(\s*'[^']*access_code_hash[^']*access_code_verified_at[^']*'/,
    );
    expect(src).toMatch(
      /if \(sig\.access_code_hash && !sig\.access_code_verified_at\)/,
    );
  });
});

describe('consume once, then bind', () => {
  it('consumes on the first GET of the scanned URL, not in the pad', () => {
    expect(read(CLAIM_ROUTE)).toMatch(/claimHandoff\(params\.handoff/);
    // The pad renders on every refresh. If it consumed anything, the
    // phone would burn its own session by reloading.
    expect(read(PAD_PAGE)).not.toMatch(/claimHandoff/);
    expect(read(PAD_PAGE)).toMatch(/loadBoundHandoff\(params\.handoff, cookie\)/);
  });

  it('binds with an httpOnly, secure, same-site cookie', () => {
    const src = read(CLAIM_ROUTE);
    expect(src).toMatch(/httpOnly: true/);
    expect(src).toMatch(/secure: true/);
    expect(src).toMatch(/sameSite: 'lax'/);
    // Only on a successful claim. Handing a cookie to a device whose
    // claim failed would bind a stranger to nothing, or worse.
    expect(src).toMatch(/if \(claimed\.ok\) \{[\s\S]{0,80}res\.cookies\.set/);
  });

  it('makes the claim conditional on the row still being unconsumed', () => {
    // Two phones scanning one screen in the same instant: the update
    // filter is what stops both of them winning.
    //
    // Anchored to the row selector above it, not to the filter alone.
    // The prose in that file explains the filter and therefore quotes
    // it, so a looser pattern went on passing with the real call
    // deleted, which is not a test.
    expect(read(QUERIES)).toMatch(
      /\.eq\('id', found\.id\)\s*\n\s*\.is\('consumed_at', null\)/,
    );
  });

  it('records the scanning device for the dispute record', () => {
    const src = read(QUERIES);
    expect(src).toMatch(/consumed_ip: ip/);
    expect(src).toMatch(/consumed_user_agent: userAgent/);
  });
});

describe('every refusal says the same calm thing', () => {
  it('has the pad page and the submit route read one function', () => {
    for (const rel of [PAD_PAGE, MOBILE_ROUTE]) {
      const src = read(rel);
      expect(src).toMatch(/handoffRefusalMessage\(/);
      // Not a second copy of the sentence, which is how the two
      // surfaces would drift apart and start leaking the difference.
      expect(src).not.toContain(HANDOFF_REFUSAL_UNAVAILABLE);
      expect(src).not.toContain(HANDOFF_REFUSAL_ALREADY_SIGNED);
    }
  });

  it('refuses an already-signed row rather than drawing a pad', () => {
    // handoffStateWithSessionHash reports already-signed before it looks
    // at anything else, so both surfaces get that state and refuse. The
    // pad only renders on ok.
    expect(read(PAD_PAGE)).toMatch(/if \(!bound\.ok\)/);
    expect(read(MOBILE_ROUTE)).toMatch(/if \(!bound\.ok\)/);
  });
});

describe('the pad', () => {
  it('reads the intent sentence from the shared module', () => {
    const src = read(PAD);
    expect(src).toMatch(/from '@\/lib\/signing-intent'/);
    // Never a local copy of the words.
    expect(src).not.toMatch(/legal effect as a handwritten/);
    // The signer's name stays out of machine translation, exactly as it
    // does inside the same sentence on the laptop.
    expect(src).toMatch(/<strong data-no-translate>\{signerLabel\}<\/strong>/);
  });

  it('does not show the document or repeat the disclosure', () => {
    const src = read(PAD);
    expect(src).not.toMatch(/document-view|renderPageToCanvas|pdfjs/);
    expect(src).not.toMatch(/electronic records|E-SIGN/i);
  });

  it('cancels touchmove itself, since React would not', () => {
    const src = read(PAD);
    expect(src).toMatch(/addEventListener\('touchmove', block, \{ passive: false \}\)/);
    expect(src).toMatch(/devicePixelRatio/);
  });
});
