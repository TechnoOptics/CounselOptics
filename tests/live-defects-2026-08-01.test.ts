import { describe, it, expect } from 'vitest';
import {
  absoluteTimestamp,
  relativeTime,
} from '../lib/intake-conversation-types';
import { gradeFromPulse } from '../lib/security-scan';
import {
  rollupStatus,
  summarizeOpenCrashes,
  summarizeProbeUptime,
} from '../lib/hq-metrics';
import { sanitizeNext } from '../lib/sign-in-next';
import {
  RESERVED_FIRM_KEYS,
  isReservedFirmKey,
  isSelfNameField,
} from '../lib/firm-template-placeholders';

/**
 * Regression tests for the six live defects found in the 2026-08-01 browser
 * walkthrough of the employee Hub and HQ. Each block names the user-visible
 * symptom it locks down.
 */

describe('hydration-safe timestamps (React #425 on /portal/[id])', () => {
  const ISO = '2026-07-20T14:05:09.000Z';

  it('is anchored to UTC and en-US, so the host timezone cannot change it', () => {
    // Pinned exactly. A server in UTC and a browser in Chicago or Tokyo all
    // produce this string, which is the whole point: the first client render
    // has nothing to disagree with the server about. Run the suite under
    // `TZ=Asia/Tokyo` and it still holds.
    expect(absoluteTimestamp(ISO)).toBe('Jul 20, 2026, 2:05 PM UTC');
  });

  it('does not depend on the current clock', () => {
    expect(absoluteTimestamp(ISO)).toBe(absoluteTimestamp(ISO));
    expect(absoluteTimestamp(ISO)).toMatch(/UTC$/);
  });

  it('returns an empty string for an unparseable value rather than "Invalid Date"', () => {
    expect(absoluteTimestamp('not-a-date')).toBe('');
  });

  it('relativeTime still reads naturally once the client supplies its own clock', () => {
    const now = Date.parse('2026-07-20T14:35:09.000Z');
    expect(relativeTime(ISO, now)).toBe('30 min ago');
  });
});

describe('Security Center rollups never paint unknown as healthy', () => {
  const c = (status: 'healthy' | 'warning' | 'critical' | 'unknown') => ({ status });

  it('a domain whose only control is unknown rolls up as unknown, not healthy', () => {
    expect(rollupStatus([c('unknown')])).toBe('unknown');
  });

  it('one unknown control demotes an otherwise passing domain', () => {
    expect(rollupStatus([c('healthy'), c('healthy'), c('unknown')])).toBe('unknown');
  });

  it('critical and warning still outrank unknown', () => {
    expect(rollupStatus([c('unknown'), c('critical')])).toBe('critical');
    expect(rollupStatus([c('unknown'), c('warning')])).toBe('warning');
  });

  it('an empty domain is unknown, because nothing was checked', () => {
    expect(rollupStatus([])).toBe('unknown');
  });

  it('all-passing stays healthy', () => {
    expect(rollupStatus([c('healthy'), c('healthy')])).toBe('healthy');
  });

  it('the posture grade cannot reach A while a control could not be checked', () => {
    const grade = gradeFromPulse({
      counts: { healthy: 12, warning: 0, critical: 0, unknown: 1 },
    } as never);
    expect(grade.grade).not.toBe('A');
    expect(grade.tone).not.toBe('green');
  });

  it('the posture grade still reaches A when everything genuinely passed', () => {
    const grade = gradeFromPulse({
      counts: { healthy: 13, warning: 0, critical: 0, unknown: 0 },
    } as never);
    expect(grade.grade).toBe('A');
  });
});

describe('HQ crash backlog agrees with itself', () => {
  const rows = [
    { message: 'TypeError: x is not a function' },
    { message: 'ResizeObserver loop limit exceeded' },
    { message: 'Another real crash' },
  ];

  it('reports the true total alongside the noise-filtered figure', () => {
    const s = summarizeOpenCrashes(rows, 3);
    expect(s.total).toBe(3);
    expect(s.open + s.noise).toBe(s.total);
  });

  it('flags when the sample was capped so a page can say "showing N of M"', () => {
    const capped = summarizeOpenCrashes(rows, 900);
    expect(capped.total).toBe(900);
    expect(capped.truncated).toBe(true);
    const whole = summarizeOpenCrashes(rows, 3);
    expect(whole.truncated).toBe(false);
  });
});

describe('HQ uptime counts probe results, not perfect runs', () => {
  it('four passing probes out of five is 80%, not 0%', () => {
    const u = summarizeProbeUptime([
      { probes: { auth: 'pass', bella: 'fail', email: 'pass', stripe: 'pass', database: 'pass' } },
    ]);
    expect(u.passedProbes).toBe(4);
    expect(u.totalProbes).toBe(5);
    expect(u.ratio).toBeCloseTo(0.8);
    expect(u.passedRuns).toBe(0);
    expect(u.totalRuns).toBe(1);
  });

  it('skipped probes are excluded from the denominator, not counted as failures', () => {
    const u = summarizeProbeUptime([
      { probes: { auth: 'pass', stripe: 'skipped' } },
    ]);
    expect(u.totalProbes).toBe(1);
    expect(u.ratio).toBe(1);
  });

  it('no runs at all reads as unknown rather than zero percent', () => {
    const u = summarizeProbeUptime([]);
    expect(u.totalProbes).toBe(0);
    expect(u.ratio).toBeNull();
  });
});

describe('sanitizeNext keeps /auth/landing from becoming an open redirect', () => {
  it('rejects the browser-normalised backslash escapes', () => {
    // `new URL(v, base)` treats these as scheme-relative, so before the fix
    // /auth/landing answered `Location: https://evil.com/` for all of them.
    for (const hostile of [
      '//evil.com',
      '/\\evil.com',
      '/\\/evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      '/\\\\evil.com',
    ]) {
      expect(sanitizeNext(hostile)).toBe('/cases');
    }
  });

  it('rejects an absolute URL on a host that is not ours', () => {
    expect(sanitizeNext('https://evil.com/x')).toBe('/cases');
    expect(sanitizeNext('https://advottic.com.evil.com/x')).toBe('/cases');
    expect(sanitizeNext('http://advottic.com/x')).toBe('/cases');
  });

  it('still honours ordinary destinations and tenant subdomains', () => {
    expect(sanitizeNext('/counsel/settings')).toBe('/counsel/settings');
    expect(sanitizeNext('/portal/requests')).toBe('/portal/requests');
    expect(sanitizeNext(undefined)).toBe('/cases');
    expect(sanitizeNext('https://zinpro.advottic.com/portal')).toBe(
      'https://zinpro.advottic.com/portal',
    );
  });

  it('still collapses sign-in aliases, and falls back rather than guessing', () => {
    expect(sanitizeNext('/admin/sign-in')).toBe('/admin');
    expect(sanitizeNext('/counsel/login')).toBe('/counsel');
    // A value that is still URL-encoded after the peel pass is not a path we
    // recognise, so it goes to the default rather than being decoded further.
    expect(sanitizeNext('%252Fcounsel%252Fsettings')).toBe('/cases');
  });
});

describe('NDA template placeholders', () => {
  // The keys on the live Zinpro NDA row.
  const KEYS = [
    'effective_date',
    'counterparty_name',
    'counterparty_address',
    'purpose',
    'governing_state',
    'your_name',
    'your_title',
  ];

  it('pre-fills the signer, never the other side of the agreement', () => {
    expect(KEYS.filter(isSelfNameField)).toEqual(['your_name']);
  });

  it('does not pre-fill the counterparty just because the key contains "name"', () => {
    for (const k of ['counterparty_name', 'recipient_name', 'party_b_name', 'company_name']) {
      expect(isSelfNameField(k)).toBe(false);
    }
  });

  it('keeps firm-resolved keys out of the employee-fillable field list', () => {
    // The authoring UI derives a required input from every {{token}}. If it
    // derived one from {{firm_name}}, the employee would face an empty
    // required "Firm Name" box and the auto-substitution would never run.
    for (const k of RESERVED_FIRM_KEYS) expect(isReservedFirmKey(k)).toBe(true);
    expect(isReservedFirmKey('counterparty_name')).toBe(false);
  });
});
