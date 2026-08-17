import { describe, expect, it } from 'vitest';
import { refFor } from '../lib/intake-notify';
import { ticketRef } from '../lib/intake-conversation-types';

/**
 * What one legal request is called, everywhere.
 *
 * refFor is the single rule, and a second copy of it is how the portal and the
 * email would come to call one request two different things. This file pins the
 * order of precedence, because each of the three forms is somebody's record key
 * and getting the order wrong renames a request that has already been quoted.
 */

const ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

describe('refFor', () => {
  /**
   * A partner-supplied id is that partner's OWN record key. Their system
   * quotes it, sends it, and expects to see it come back, so it keeps winning
   * even once we have a number of our own for the same request.
   */
  it('shows a partner its own external id ahead of anything we allocated', () => {
    expect(
      refFor({
        id: ID,
        request_number: 'ZT0001000',
        intake_answers: { partner: { externalId: 'ZIN-55912' } },
      }),
    ).toBe('ZIN-55912');
  });

  it('shows the allocated number when there is no partner id', () => {
    expect(refFor({ id: ID, request_number: 'ZT0001000', intake_answers: null })).toBe(
      'ZT0001000',
    );
  });

  it('ignores a blank partner id rather than showing an empty reference', () => {
    expect(
      refFor({
        id: ID,
        request_number: 'ZT0001000',
        intake_answers: { partner: { externalId: '   ' } },
      }),
    ).toBe('ZT0001000');
  });

  /**
   * THE ONE THAT PROTECTS MAIL ALREADY SENT. A request filed before the
   * allocator existed has no number and must still answer to the reference it
   * was emailed under, or every notification sent before this shipped cites
   * something that cannot be found.
   */
  it('leaves a request filed before this shipped with the reference it was sent under', () => {
    expect(refFor({ id: ID, request_number: null, intake_answers: null })).toBe(ticketRef(ID));
  });

  it('treats a blank number as no number', () => {
    expect(refFor({ id: ID, request_number: '  ', intake_answers: null })).toBe(ticketRef(ID));
  });
});
