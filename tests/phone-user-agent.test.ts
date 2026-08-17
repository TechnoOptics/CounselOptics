import { describe, expect, it } from 'vitest';
import { isPhoneUserAgent } from '../lib/platform';

/**
 * "Is the person holding a phone", answered from the request and nowhere else.
 *
 * WHY THE REQUEST AND NOT THE BROWSER. app/billing/tier-card.tsx decided
 * iOS-ness in a client effect that runs once with no retry, the first paint
 * happened before it resolved, and the wrong UI shipped and was rejected by
 * App Review (2.1(b), 2026-07-02). A header is available before the first byte
 * of HTML, so a boolean derived from it cannot lose a race that does not exist.
 * These tests are therefore all pure string cases: there is no window, no
 * effect and no timing in the thing being tested.
 *
 * WHY NO VIEWPORT ANYWHERE. A width test cannot tell a phone from a desktop
 * window someone dragged narrow, and the desktop case is the expensive one: it
 * would withdraw the handoff from a person who has a phone in their pocket and
 * a mouse in their hand. The narrowed-desktop case below is a real assertion,
 * not a formality.
 *
 * WHICH WAY IT FAILS. Every unrecognised string reads as "not a phone", which
 * is the answer that changes nothing about today's page. See the module
 * comment: this boolean only ever withdraws the QR and widens the pad, so a
 * false negative leaves the current behaviour standing and a false positive is
 * the one that would cost somebody a route. The default is chosen accordingly.
 */

/** Real strings, kept verbatim. A paraphrased user agent proves nothing. */
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidFirefox:
    'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  /** The native shell, which appends its own token. It is on an iPhone, and
   *  the iPhone in the string is what answers this question. */
  iphoneAdvotticApp:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AdvotticApp/ios',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidTabletChrome:
    'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  androidTabletFirefox:
    'Mozilla/5.0 (Android 14; Tablet; rv:127.0) Gecko/127.0 Firefox/127.0',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
};

describe('a phone', () => {
  it('is recognised on iOS Safari', () => {
    expect(isPhoneUserAgent(UA.iphoneSafari)).toBe(true);
  });

  it('is recognised on Android Chrome', () => {
    expect(isPhoneUserAgent(UA.androidChrome)).toBe(true);
  });

  it('is recognised on Android Firefox', () => {
    expect(isPhoneUserAgent(UA.androidFirefox)).toBe(true);
  });

  /** The Capacitor shell needs no special case, and it is checked so that
   *  nobody adds one. */
  it('is recognised inside the native app on an iPhone', () => {
    expect(isPhoneUserAgent(UA.iphoneAdvotticApp)).toBe(true);
  });
});

/**
 * A DESKTOP WINDOW DRAGGED NARROW IS NOT A PHONE, which is the assertion that
 * would have to be deleted for anyone to reintroduce a breakpoint here. The
 * user agent does not change with the window, so this passes for the right
 * reason: there is no width in the input at all.
 */
describe('a desktop', () => {
  it('is not a phone on macOS, at any window width', () => {
    expect(isPhoneUserAgent(UA.macChrome)).toBe(false);
  });

  it('is not a phone on Windows', () => {
    expect(isPhoneUserAgent(UA.windowsEdge)).toBe(false);
  });
});

/**
 * A TABLET IS NOT A PHONE, and this is a decision rather than a fallout.
 *
 * Three reasons, and the third is the one that settles it.
 *
 * A tablet is routinely docked in a keyboard case on a desk, where the phone in
 * somebody's pocket genuinely is a second device and the handoff is not the
 * nonsense it is on a phone.
 *
 * A firm that restricted a template to the phone named a phone. Nothing is
 * taken away from a tablet by this: it keeps the drawn pad wherever the firm
 * allows drawing, and on a phone-only template it keeps the handoff, which is
 * the truthful route for it.
 *
 * And iPadOS Safari reports a Macintosh user agent by default, so a
 * string-based test CANNOT reliably identify an iPad in the first place. Any
 * rule that treated tablets as phones would therefore be a rule that worked on
 * some iPads and not others. Ruling them out keeps the unreliable half on the
 * side that changes nothing.
 *
 * HOW they are ruled out matters, and these cases are what pin it. There is no
 * tablet check in lib/platform.ts: tablets are excluded because the allowlist
 * does not name them. An earlier draft did subtract them afterwards, and
 * mutation testing showed the subtraction was unreachable, so these assertions
 * held whatever it said. The mistake they really guard against is substituting
 * the usual "does the user agent say Mobile" test, which an iPad passes. The
 * iPad case below asserts that token is present, so the day somebody reaches for
 * the generic rule this file goes red.
 */
describe('a tablet', () => {
  /**
   * The Mobile token is asserted first, so this case cannot be satisfied by a
   * fixture that quietly stopped containing it. It is the reason the detection
   * is an allowlist rather than a test for that token.
   */
  it('is not a phone on iPadOS, despite carrying the Mobile token', () => {
    expect(UA.ipadSafari).toContain('Mobile');
    expect(isPhoneUserAgent(UA.ipadSafari)).toBe(false);
  });

  it('is not a phone on an Android tablet', () => {
    expect(isPhoneUserAgent(UA.androidTabletChrome)).toBe(false);
  });

  it('is not a phone on Android Firefox for tablets', () => {
    expect(isPhoneUserAgent(UA.androidTabletFirefox)).toBe(false);
  });

  /** An iPad asking for the desktop site is indistinguishable from a Mac, and
   *  lands on the same answer this file already gives a tablet. */
  it('is not a phone when it asks for the desktop site', () => {
    expect(isPhoneUserAgent(UA.macChrome)).toBe(false);
  });
});

describe('a request that says nothing useful', () => {
  it('is not a phone when there is no user agent at all', () => {
    expect(isPhoneUserAgent(null)).toBe(false);
    expect(isPhoneUserAgent(undefined)).toBe(false);
    expect(isPhoneUserAgent('')).toBe(false);
  });

  it('is not a phone for a string that means nothing here', () => {
    expect(isPhoneUserAgent('curl/8.6.0')).toBe(false);
    expect(isPhoneUserAgent('Advottic-Healthcheck/1.0')).toBe(false);
  });
});
