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

  it('keeps a window shorter than the daily cron period', () => {
    // The property that makes the throttle correct rather than the exact
    // number. If someone raises this back to 24 hours, the alternating
    // silence comes back.
    expect(HEALTH_DIGEST_MIN_GAP_MS).toBeLessThan(24 * HOUR);
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
