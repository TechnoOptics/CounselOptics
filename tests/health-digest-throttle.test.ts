import { describe, expect, it } from 'vitest';
import { healthDigestDecision, HEALTH_DIGEST_MIN_GAP_MS } from '../lib/hq-metrics';

/**
 * The throttle window has to be shorter than the cron period, or the
 * digest it throttles can never fire on schedule.
 *
 * Production, 30 daily runs to 2026-08-06: 42 failed runs across the
 * table but only 18 carried an `email_sent_at`. The suppressed runs were
 * not random. Every one of them sat between 86302 and 86400 seconds after
 * the previous send, never more, and they fell on alternating days. Vercel
 * fires the 07:00 cron with up to ~90s of jitter, the previous send was
 * stamped a few hundred milliseconds after the previous run, and the rule
 * asked for a strictly greater than 24-hour gap. Roughly half of the time
 * a 24-hour cadence does not clear a 24-hour bar.
 *
 * The cases below are the real production timestamps.
 */

const HOUR = 60 * 60 * 1000;
/** The cron period this throttle has to fit inside: vercel.json is "0 7 * * *". */
const CRON_PERIOD_MS = 24 * HOUR;

describe('healthDigestDecision', () => {
  it('stays quiet when there is nothing to report', () => {
    expect(
      healthDigestDecision({
        hasFailures: false,
        unacknowledgedCrashes: 0,
        lastEmailSentAt: null,
        now: Date.parse('2026-08-06T07:01:29.223Z'),
      }),
    ).toBe('nothing-to-report');
  });

  it('sends the first digest when nothing has ever been sent', () => {
    expect(
      healthDigestDecision({
        hasFailures: true,
        unacknowledgedCrashes: 0,
        lastEmailSentAt: null,
        now: Date.parse('2026-08-06T07:01:29.223Z'),
      }),
    ).toBe('send');
  });

  it('sends for unacknowledged crashes even when every probe passed', () => {
    expect(
      healthDigestDecision({
        hasFailures: false,
        unacknowledgedCrashes: 3,
        lastEmailSentAt: null,
        now: Date.parse('2026-08-06T07:01:29.223Z'),
      }),
    ).toBe('send');
  });

  it('sends the day after a send that landed later in the minute', () => {
    // 2026-08-05 07:00:36 ran 86345s after the 2026-08-04 07:01:31 send.
    // Under the old 24-hour window this run was dropped, and production
    // shows email_sent_at null for it.
    expect(
      healthDigestDecision({
        hasFailures: true,
        unacknowledgedCrashes: 0,
        lastEmailSentAt: '2026-08-04T07:01:31.725Z',
        now: Date.parse('2026-08-05T07:00:36.680Z'),
      }),
    ).toBe('send');
  });

  it('sends every day across the real 2026-08-01 to 2026-08-06 cron runs', () => {
    // ran_at values straight out of public.system_health. Each run failed
    // the bella probe, so each one had something to say. Production sent on
    // 08-01, 08-03, 08-04 and 08-06 only.
    const runs = [
      '2026-08-01T07:01:16.847Z',
      '2026-08-02T07:00:36.226Z',
      '2026-08-03T07:00:39.227Z',
      '2026-08-04T07:01:31.280Z',
      '2026-08-05T07:00:36.680Z',
      '2026-08-06T07:01:29.223Z',
    ];
    let lastEmailSentAt: string | null = null;
    const sent: string[] = [];
    for (const ranAt of runs) {
      const now = Date.parse(ranAt);
      const decision = healthDigestDecision({
        hasFailures: true,
        unacknowledgedCrashes: 0,
        lastEmailSentAt,
        now,
      });
      if (decision === 'send') {
        sent.push(ranAt);
        // The send is stamped a few hundred ms after the run, exactly as
        // markHealthEmailSent does it.
        lastEmailSentAt = new Date(now + 400).toISOString();
      }
    }
    expect(sent).toEqual(runs);
  });

  it('throttles a second digest inside the same working day', () => {
    // A re-invocation an hour later, e.g. a Vercel retry or someone
    // hitting the endpoint by hand, must not mail a second copy.
    expect(
      healthDigestDecision({
        hasFailures: true,
        unacknowledgedCrashes: 0,
        lastEmailSentAt: '2026-08-06T07:01:29.604Z',
        now: Date.parse('2026-08-06T08:01:29.604Z'),
      }),
    ).toBe('throttled');
  });

  it('leaves at least an hour of headroom under the cron period', () => {
    // "Shorter than 24 hours" was too weak to protect anything. A window
    // of 86_340_000 (23h59m) satisfies it, passes the replay above
    // because the simulated sends land 400ms after each run, and still
    // re-suppresses the real 2026-07-20 run below. The load-bearing
    // property is the window plus the cron's jitter fitting inside the
    // period, so the headroom is what gets pinned.
    //
    // The observed jitter budget is about 98 seconds: production's
    // suppressed gaps bottomed out at 86301.9s against an 86400s period.
    // An hour is far more than that on purpose, because the jitter is
    // something Vercel happens to do and not something it promises.
    expect(HEALTH_DIGEST_MIN_GAP_MS).toBeLessThan(CRON_PERIOD_MS - HOUR);
  });

  it('sends at the tightest gap production has actually produced', () => {
    // 2026-07-20 07:00:07.775 ran 86301.9s after the 2026-07-19
    // 07:01:45.839 send. That is the shortest gap in the table and the
    // old rule suppressed it. Any window that re-suppresses this run has
    // reintroduced the bug, whatever the property test says.
    expect(
      healthDigestDecision({
        hasFailures: true,
        unacknowledgedCrashes: 0,
        lastEmailSentAt: '2026-07-19T07:01:45.839Z',
        now: Date.parse('2026-07-20T07:00:07.775Z'),
      }),
    ).toBe('send');
  });

  it('sends at exactly the window boundary, and not a millisecond before', () => {
    // Pins the comparison as >=. Relaxing it to > survives every other
    // case in this file, because nothing else lands on the boundary.
    const lastEmailSentAt = '2026-08-06T07:00:00.000Z';
    const boundary = Date.parse(lastEmailSentAt) + HEALTH_DIGEST_MIN_GAP_MS;
    const at = (now: number) =>
      healthDigestDecision({
        hasFailures: true,
        unacknowledgedCrashes: 0,
        lastEmailSentAt,
        now,
      });
    expect(at(boundary)).toBe('send');
    expect(at(boundary - 1)).toBe('throttled');
  });

  it('treats an unparseable timestamp as no previous send rather than silence', () => {
    expect(
      healthDigestDecision({
        hasFailures: true,
        unacknowledgedCrashes: 0,
        lastEmailSentAt: 'not a timestamp',
        now: Date.parse('2026-08-06T07:01:29.223Z'),
      }),
    ).toBe('send');
  });
});
