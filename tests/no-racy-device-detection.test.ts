import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';

/**
 * The device question is answered by the SERVER, and this is the guard that
 * keeps it there.
 *
 * WHY A SOURCE GUARD AND NOT ONLY A RENDER TEST. The render tests beside this
 * one prove the form obeys `viewerOnPhone`. They would go on proving it after
 * somebody added a `matchMedia` or a `navigator.userAgent` check next to it,
 * because renderToStaticMarkup runs no effects and has no window: a client-side
 * detection is INVISIBLE to them. That invisibility is the whole shape of the
 * bug being guarded against.
 *
 * WHAT WENT WRONG BEFORE. app/billing/tier-card.tsx resolved iOS-ness in a
 * client effect that runs once with no retry. On the remote-URL WebView the
 * first paint happened before it resolved, so the page rendered the wrong
 * control and shipped: the 5th App Store rejection (2.1(b), 2026-07-02). The
 * same race had already been diagnosed and fixed server-side for the Google
 * Play badge (2.3.10, 2026-06-29) and simply not applied there. It is applied
 * here from the start, and this file is what stops it drifting back.
 *
 * AND NO VIEWPORT. A width cannot tell a phone from a desktop window dragged
 * narrow, and mistaking one would withdraw the handoff from somebody who has a
 * phone in their pocket and a mouse in their hand. So the breakpoint APIs are
 * banned outright in this decision's files rather than merely discouraged.
 *
 * Comments are stripped before matching. A comment explaining a fix routinely
 * contains the string a guard searches for, and this repo has twice shipped a
 * guard that its own explanatory comment kept green. The last test in this file
 * proves the stripping happens.
 */

const ROOT = join(__dirname, '..');
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

const FILL_CLIENT = 'app/portal/forms/[id]/form-fill-client.tsx';
const FILL_PAGE = 'app/portal/forms/[id]/page.tsx';

/**
 * The outside signer's ceremony, which had the same defect on the higher-stakes
 * surface and was fixed second. What is being signed here is an executed
 * instrument, so the same decision is held to the same rule.
 */
const SIGN_CAPTURE = 'app/sign/[token]/signature-capture.tsx';
const SIGN_SURFACE = 'app/sign/[token]/signer-surface.tsx';
const SIGN_PAGE = 'app/sign/[token]/page.tsx';

/**
 * Every way a browser can be asked about itself that has raced, or would race,
 * in this codebase. `matchMedia` and `innerWidth` are the viewport ban;
 * `navigator` and the Capacitor bridge readers are the tier-card ban.
 */
const CLIENT_DETECTION = [
  'navigator.userAgent',
  'navigator.platform',
  'navigator.maxTouchPoints',
  'matchMedia',
  'innerWidth',
  'useIsNativeApp',
  'getNativePlatform',
  'isNativeApp',
  'isIOSApp',
  'isAndroidApp',
];

describe('the employee fill page', () => {
  const src = read(FILL_CLIENT);

  it.each(CLIENT_DETECTION)('does not ask the browser what device it is (%s)', (api) => {
    expect(src).not.toContain(api);
  });

  /** It is told, not left to work it out. */
  it('takes the device answer as a prop', () => {
    expect(src).toContain('viewerOnPhone');
  });

  /**
   * A prop with a default is a prop callers can forget, and forgetting this one
   * puts the QR back in front of somebody holding a phone. The same reason
   * phoneHandoffAvailable is not defaulted either.
   */
  it('does not default the device answer to anything', () => {
    expect(src).not.toMatch(/viewerOnPhone\s*=/);
  });
});

describe('the server component above it', () => {
  const src = read(FILL_PAGE);

  it('reads the request user agent', () => {
    expect(src).toContain('user-agent');
    expect(src).toContain('isPhoneUserAgent');
  });

  it('passes the answer down', () => {
    expect(src).toContain('viewerOnPhone');
  });

  it('does not ask the browser instead', () => {
    for (const api of CLIENT_DETECTION) expect(src).not.toContain(api);
  });
});

/**
 * THE OUTSIDE SIGNER'S CEREMONY.
 *
 * One exception is carried here that the employee form does not need, and it is
 * narrowed rather than waived: this component reads `navigator.userAgent` on
 * purpose, into `consent.uaSnapshot`, which is EVIDENCE recorded in the audit
 * chain about the device a signature was made on. That is a legitimate read and
 * banning it would delete part of an evidentiary record.
 *
 * The distinction the tests below draw is the one that matters: reading the
 * browser's own string to WRITE IT DOWN is fine, and reading it to DECIDE what
 * to render is the race. So the snapshot is pinned to exactly one occurrence on
 * the line that records it, and every other way of asking the browser about
 * itself stays banned outright.
 */
describe('the outside signer ceremony', () => {
  const src = read(SIGN_CAPTURE);

  /** Everything except the audit snapshot, which is handled on its own below. */
  const BANNED_HERE = CLIENT_DETECTION.filter((a) => a !== 'navigator.userAgent');

  it.each(BANNED_HERE)('does not ask the browser what device it is (%s)', (api) => {
    expect(src).not.toContain(api);
  });

  it('takes the device answer as a prop', () => {
    expect(src).toContain('viewerOnPhone');
  });

  it('does not default the device answer to anything', () => {
    expect(src).not.toMatch(/viewerOnPhone\s*=\s*(false|true)/);
  });

  /**
   * The narrow exception, pinned. If a second read appears this fails, and a
   * second read is what a device decision in this component would look like.
   */
  it('reads the browser user agent exactly once, and only to record it', () => {
    const hits = src.split('navigator.userAgent').length - 1;
    expect(hits).toBe(1);
    // A window rather than the line: the assignment wraps, so `uaSnapshot:` sits
    // on the line above the read. Kept tight so an unrelated read elsewhere in
    // the file could not borrow this field name from a distance.
    const at = src.indexOf('navigator.userAgent');
    expect(src.slice(Math.max(0, at - 120), at)).toContain('uaSnapshot');
  });

  /**
   * And the snapshot never becomes the decision. The device flag must not be
   * derived from it: that would be the client detection this file bans, wearing
   * the evidence field as a disguise.
   */
  it('does not derive the device from that snapshot', () => {
    expect(src).not.toMatch(/viewerOnPhone[^\n]*uaSnapshot/);
    expect(src).not.toMatch(/isPhoneUserAgent\s*\(/);
  });
});

describe('the signer surface between them', () => {
  const src = read(SIGN_SURFACE);

  it('does not ask the browser instead', () => {
    for (const api of CLIENT_DETECTION) expect(src).not.toContain(api);
  });

  /** It carries the answer and does not re-resolve it. */
  it('passes the answer straight down', () => {
    expect(src).toContain('viewerOnPhone={viewerOnPhone}');
  });

  it('does not default the device answer to anything', () => {
    expect(src).not.toMatch(/viewerOnPhone\s*=\s*(false|true)/);
  });
});

describe('the signer server component above them', () => {
  const src = read(SIGN_PAGE);

  it('reads the request user agent', () => {
    expect(src).toContain('user-agent');
    expect(src).toContain('isPhoneUserAgent');
  });

  it('passes the answer down', () => {
    expect(src).toContain('viewerOnPhone={viewerOnPhone}');
  });

  it('does not ask the browser instead', () => {
    for (const api of CLIENT_DETECTION) expect(src).not.toContain(api);
  });
});

/**
 * The server gate, which decides whether the widened route reaches a record.
 *
 * It reads the device too, and from the request the route handed it rather than
 * from the `uaSnapshot` inside the consent body. The difference matters: the
 * snapshot is the browser's own string sent in a POST body, so a gate reading it
 * would be taking the caller's word for the caller's device.
 */
describe('the signature write', () => {
  const src = read('lib/signature-write.ts');

  it('resolves the device from the request user agent', () => {
    expect(src).toContain('isPhoneUserAgent(input.userAgent)');
  });

  it('does not read the device out of the posted consent snapshot', () => {
    expect(src).not.toMatch(/isPhoneUserAgent\([^)]*uaSnapshot/);
  });

  /**
   * THE INVARIANT, in the one place a source guard can state it usefully: the
   * attestation is still decided by `fromHandoff` alone. Widening what may be
   * signed must never widen what is claimed about it, and this is the line that
   * would have to change for it to.
   */
  it('still attests the method from the handoff alone', () => {
    expect(src).toContain("signature_method_attested_by: fromHandoff ? 'server' : 'signer'");
    expect(src).not.toMatch(/attested_by:[^\n]*isPhoneUserAgent/);
    expect(src).not.toMatch(/attested_by:[^\n]*viewerOnPhone/);
  });
});

/**
 * The detection itself must be a pure function of the header. A `window` in
 * lib/platform.ts is not by itself wrong (the Capacitor bridge readers live
 * there and are legitimately client-side), so what is checked is the one
 * function, sliced out of the file.
 */
describe('isPhoneUserAgent', () => {
  const src = readFileSync(join(ROOT, 'lib/platform.ts'), 'utf8');
  const body = (() => {
    const start = src.indexOf('export function isPhoneUserAgent');
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('\nexport ', start + 1);
    return stripComments(src.slice(start, next === -1 ? undefined : next));
  })();

  it('touches no browser global', () => {
    expect(body).not.toContain('window');
    expect(body).not.toContain('navigator');
    expect(body).not.toContain('matchMedia');
  });

  it('takes no viewport measurement', () => {
    expect(body).not.toContain('innerWidth');
    expect(body).not.toContain('clientWidth');
  });
});

/**
 * The guard checking itself, because every assertion above is a substring match
 * over source text and a comment naming `navigator.userAgent` while explaining
 * why it is not used would turn them red for no reason. The usual reaction to
 * that is to weaken the pattern until it catches nothing.
 */
describe('the guard', () => {
  it('does not read a banned API out of a comment', () => {
    const stripped = stripComments(
      [
        'const a = 1;',
        '// deliberately not navigator.userAgent',
        '/* and no matchMedia either */',
        'const b = 2;',
      ].join('\n'),
    );

    expect(stripped).not.toContain('navigator.userAgent');
    expect(stripped).not.toContain('matchMedia');
  });

  /** And it still sees real code, which is the half a broken stripper breaks. */
  it('does see a banned API in real code', () => {
    expect(stripComments('const ua = navigator.userAgent;')).toContain(
      'navigator.userAgent',
    );
  });
});
