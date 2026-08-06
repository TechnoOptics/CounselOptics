import { describe, it, expect } from 'vitest';
import {
  COUNSEL_ACCOUNT_EQUIVALENT,
  PERSONAL_PROFILE_HREF,
  counselAccountRedirect,
  wantsPersonal,
} from '../lib/counsel-account-routes';

/**
 * The firm-member account redirect. Both directions matter, and the wrong
 * one is worse than the bug it fixes: pushing a consumer into the firm
 * workspace would show them a product they do not have, and hijacking a firm
 * member who deliberately opened their personal profile would take away Safe
 * Witness, theme, language and paired devices with no route back.
 */
describe('counselAccountRedirect', () => {
  it('sends a firm member from each consumer account route to its counsel twin', () => {
    expect(counselAccountRedirect('/profile', true)).toBe('/counsel/profile');
    expect(counselAccountRedirect('/profile/api-tokens', true)).toBe(
      '/counsel/profile/api-tokens',
    );
    expect(counselAccountRedirect('/feedback', true)).toBe('/counsel/feedback');
  });

  // The direction that must never fire. A consumer, and a co-counsel guest
  // (who has no firm_members row and so arrives here as isFirmMember=false),
  // stay exactly where they are.
  it('never moves a non-member', () => {
    expect(counselAccountRedirect('/profile', false)).toBeNull();
    expect(counselAccountRedirect('/profile/api-tokens', false)).toBeNull();
    expect(counselAccountRedirect('/feedback', false)).toBeNull();
  });

  it('honours the deliberate-consumer marker for a firm member', () => {
    expect(counselAccountRedirect('/profile', true, { personal: '1' })).toBeNull();
    expect(counselAccountRedirect('/profile', true, { personal: 'true' })).toBeNull();
    expect(
      counselAccountRedirect('/feedback', true, { personal: '1' }),
    ).toBeNull();
  });

  it('ignores an unrelated or malformed marker', () => {
    expect(counselAccountRedirect('/profile', true, { personal: '0' })).toBe(
      '/counsel/profile',
    );
    expect(counselAccountRedirect('/profile', true, { personal: '' })).toBe(
      '/counsel/profile',
    );
    expect(counselAccountRedirect('/profile', true, { other: '1' })).toBe(
      '/counsel/profile',
    );
  });

  it('leaves every route that is not an account route alone', () => {
    for (const path of ['/cases', '/inbox', '/', '/counsel', '/counsel/profile']) {
      expect(counselAccountRedirect(path, true)).toBeNull();
    }
  });

  // No target may itself be a source, or the redirect chases its own tail.
  it('cannot loop: no counsel destination is also a redirected path', () => {
    for (const destination of Object.values(COUNSEL_ACCOUNT_EQUIVALENT)) {
      expect(COUNSEL_ACCOUNT_EQUIVALENT[destination]).toBeUndefined();
      expect(counselAccountRedirect(destination, true)).toBeNull();
    }
  });

  // The escape hatch is load-bearing: /counsel/profile links to it, and it is
  // the only URL that reaches the dropped sections once the redirect is on.
  it('the personal href opts itself out of the redirect', () => {
    const [path, query] = PERSONAL_PROFILE_HREF.split('?');
    expect(path).toBe('/profile');
    const params = Object.fromEntries(new URLSearchParams(query));
    expect(wantsPersonal(params)).toBe(true);
    expect(counselAccountRedirect(path!, true, params)).toBeNull();
  });

  it('reads the marker out of a repeated query parameter', () => {
    expect(wantsPersonal({ personal: ['1', '0'] })).toBe(true);
    expect(wantsPersonal({ personal: [] })).toBe(false);
    expect(wantsPersonal(undefined)).toBe(false);
  });
});
