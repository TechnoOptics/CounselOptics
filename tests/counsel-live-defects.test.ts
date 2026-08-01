import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  INTAKE_LANE_LABEL,
  INTAKE_STATUSES,
  OPEN_INTAKE_STATUSES,
  intakeLaneOf,
  isIntakeOpen,
  tallyIntakeLanes,
} from '../lib/intake-lanes';

/**
 * Regression tests for the defects found in the 2026-08-01 live browser
 * walkthrough of the counsel workspace (docs/audit/UX_AUDIT_COUNSEL_LIVE.md).
 *
 * The repo's vitest environment is Node, with no DOM and no React testing
 * library, so the UI findings are locked down the way scripts/test/*.mjs
 * already does it: by asserting invariants on the source text. That is enough
 * to stop each specific regression coming back (the drawer moving back inside
 * the blurred header, the service worker learning to answer navigations, an
 * emoji reappearing in the client-facing shell).
 */

const root = new URL('../', import.meta.url);
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, root)), 'utf8');

/* ------------------------------------------------------------------ *
 * L-N1: four different numbers for one queue
 * ------------------------------------------------------------------ */

describe('one definition of the intake queue', () => {
  it('classifies every status the database actually allows', () => {
    // Mirrors the CHECK constraint in
    // supabase/migrations/20260726_intake_status_lifecycle.sql.
    const allowed = [
      'in_progress',
      'conflict_check_passed',
      'conflict_check_flagged',
      'engaged',
      'converted',
      'rejected',
      'closed',
    ];
    expect([...INTAKE_STATUSES].sort()).toEqual([...allowed].sort());
    for (const s of allowed) {
      expect(INTAKE_LANE_LABEL[intakeLaneOf(s)]).toBeTypeOf('string');
    }
  });

  it('puts a cleared conflict check in review, not in "needs attention"', () => {
    // The dashboard used to test for a status named `in_review`, which the
    // schema has never allowed, so every conflict-cleared request fell through
    // to "needs attention" and the dashboard read 5 where the inbox read 4.
    expect(intakeLaneOf('conflict_check_passed')).toBe('review');
    expect(intakeLaneOf('in_review')).not.toBe('review');
  });

  it('treats a converted request as accepted, not as untriaged work', () => {
    expect(intakeLaneOf('converted')).toBe('accepted');
    expect(intakeLaneOf('engaged')).toBe('accepted');
  });

  it('treats both terminal statuses as closed', () => {
    expect(intakeLaneOf('rejected')).toBe('closed');
    expect(intakeLaneOf('closed')).toBe('closed');
  });

  it('sends an unrecognised status to a human rather than hiding it', () => {
    expect(intakeLaneOf('something_new')).toBe('attention');
  });

  it('defines "open" as needs attention plus in review, and nothing else', () => {
    expect([...OPEN_INTAKE_STATUSES].sort()).toEqual(
      ['conflict_check_flagged', 'conflict_check_passed', 'in_progress'].sort(),
    );
    expect(isIntakeOpen('converted')).toBe(false);
    expect(isIntakeOpen('closed')).toBe(false);
    expect(isIntakeOpen('in_progress')).toBe(true);
  });

  it('makes the dashboard row and the inbox lane report the same number', () => {
    // The exact shape the audit walked: four untriaged, one cleared conflict
    // check. Dashboard said "5 requests need attention"; the inbox lane said 4.
    const queue = [
      'in_progress',
      'in_progress',
      'in_progress',
      'conflict_check_flagged',
      'conflict_check_passed',
    ];
    const lanes = tallyIntakeLanes(queue);
    expect(lanes.attention).toBe(4);
    expect(lanes.review).toBe(1);
    // ...and "open requests" on Impact is the sum of the two, by definition.
    expect(queue.filter(isIntakeOpen).length).toBe(lanes.attention + lanes.review);
  });

  it('no longer counts a converted or closed request as an open request', () => {
    const lanes = tallyIntakeLanes(['converted', 'closed', 'in_progress']);
    expect(lanes.attention).toBe(1);
    expect(lanes.accepted).toBe(1);
    expect(lanes.closed).toBe(1);
  });
});

describe('the counting surfaces all read from that one definition', () => {
  const dashboard = read('app/counsel/page.tsx');
  const inbox = read('components/counsel/IntakeInbox.tsx');
  const inboxPage = read('app/counsel/inbox/page.tsx');
  const analytics = read('lib/counsel-analytics.ts');

  it('the dashboard no longer hand-rolls a lane map', () => {
    expect(dashboard).toContain('intake-lanes');
    expect(dashboard).not.toContain("=== 'in_review'");
  });

  it('the inbox lanes come from the shared map', () => {
    expect(inbox).toContain('intake-lanes');
  });

  it('the inbox tab badge and Impact use the same "open" test', () => {
    expect(inboxPage).toContain('isIntakeOpen');
    expect(analytics).toContain('isIntakeOpen');
  });

  it('the Action center totals work items, not the number of rows it drew', () => {
    const tiles = read('components/counsel/CounselDashboardTiles.tsx');
    expect(tiles).toContain('workItems');
  });
});

/* ------------------------------------------------------------------ *
 * L-B1: the mobile drawer opened empty
 * ------------------------------------------------------------------ */

describe('counsel mobile navigation drawer', () => {
  const nav = read('components/counsel/CounselMobileNav.tsx');
  const header = read('components/counsel/CounselHeader.tsx');

  it('escapes the header, which is a containing block for fixed children', () => {
    // CounselHeader carries backdrop-blur-md. A backdrop-filter makes the
    // element a containing block for position:fixed descendants, so a drawer
    // rendered inside it resolves `inset-0` against the header bar (~145px)
    // instead of the viewport, and every row lands outside the visible box.
    expect(header).toContain('backdrop-blur-md');
    expect(nav).toContain('createPortal');
    expect(nav).toContain('document.body');
  });

  it('restores focus to the trigger and traps focus while open', () => {
    expect(nav).toContain('lastFocusedRef');
    expect(nav).toContain("'Tab'");
  });

  it('still locks page scroll and closes on Escape', () => {
    expect(nav).toContain('lockScroll()');
    expect(nav).toContain("e.key === 'Escape'");
  });

  it('locks the root element too, because <html> carries overflow-x: clip', () => {
    // app/globals.css sets `overflow-x: clip` on html AND body. A root element
    // whose overflow is not `visible` stops the body's overflow propagating to
    // the viewport, so the body-only lock never actually held the page still.
    // The lock itself now lives in lib/scroll-lock.ts, which every overlay in
    // the app shares; tests/scroll-lock.test.ts covers its behavior.
    expect(read('app/globals.css')).toContain('overflow-x: clip');
    expect(read('lib/scroll-lock.ts')).toContain(
      "root.style.overflow = 'hidden'",
    );
  });

  it('closes itself if the viewport grows past the md breakpoint', () => {
    // The drawer is md:hidden. Left open across 768px it would vanish with
    // `open` still true, so the effect never cleaned up and the scroll lock
    // stayed on a page with no control left to release it.
    expect(nav).toContain("matchMedia('(min-width: 768px)')");
  });
});

describe('the reload prompt can be dismissed', () => {
  const guard = read('components/FreshnessGuard.tsx');

  it('latches off once shown or waved away, instead of re-firing on focus', () => {
    expect(guard).toContain('settledRef');
    expect(guard).toContain('cancelled || settledRef.current');
  });
});

/* ------------------------------------------------------------------ *
 * L-B2: production served a stale document with no reload prompt
 * ------------------------------------------------------------------ */

describe('freshness of authenticated app documents', () => {
  const sw = read('public/sw.js');
  const guard = read('components/FreshnessGuard.tsx');
  const rootLayout = read('app/layout.tsx');

  it('the service worker never answers a navigation from cache', () => {
    expect(sw).toContain("req.mode === 'navigate'");
    expect(sw).toContain("req.destination === 'document'");
  });

  it('the service worker only reads its own static cache', () => {
    expect(sw).toContain('cacheName: STATIC_CACHE');
  });

  it('the version check runs on load and on refocus, not only on a timer', () => {
    // The poll was a bare setInterval(90s) that restarts with every full page
    // load, so a user clicking through the workspace never reached the first
    // tick and never saw the "Advottic just updated" prompt.
    expect(guard).toContain('checkVersion');
    expect(guard).toContain('visibilitychange');
    expect(guard.match(/checkVersion\(\)/g)?.length ?? 0).toBeGreaterThan(1);
  });

  it('the guard is mounted once at the root, so counsel and portal inherit it', () => {
    expect(rootLayout).toContain('<FreshnessGuard');
  });
});

/* ------------------------------------------------------------------ *
 * L-B3 / L-B4: counsel 404s, and the links that caused them
 * ------------------------------------------------------------------ */

describe('counsel 404s stay inside the counsel shell', () => {
  it('has its own not-found boundary', () => {
    const nf = read('app/counsel/not-found.tsx');
    expect(nf).toContain('export default');
    // It must not recommend a rail row a firm is allowed to hide.
    expect(nf).not.toContain('/counsel/cases');
  });

  it('the dashboard no longer links at routes that do not exist', () => {
    const tiles = read('components/counsel/CounselDashboardTiles.tsx');
    expect(tiles).not.toContain('/counsel/cases/new');
    expect(tiles).not.toContain('/counsel/clients/${');
  });
});

/* ------------------------------------------------------------------ *
 * L-U1: real emoji in counsel UI chrome
 * ------------------------------------------------------------------ */

describe('no emoji in the counsel chrome', () => {
  // Colour emoji only. The monochrome typographic glyphs (☰ ▦ ▤ → ✓) that
  // also stand in for icons in these files are a separate, larger cleanup and
  // are deliberately not in scope here.
  const EMOJI = /\p{Emoji_Presentation}|️/u;

  it('the client-facing guest shell is emoji-free', () => {
    expect(EMOJI.test(read('components/counsel/CounselGuestNav.tsx'))).toBe(false);
  });

  it('the evidence centre is emoji-free', () => {
    expect(
      EMOJI.test(read('app/counsel/cases/[id]/evidence/evidence-intake.tsx')),
    ).toBe(false);
  });

  it('the replacements are stroke SVGs that inherit currentColor', () => {
    const icons = read('components/counsel/EntityIcons.tsx');
    expect(icons).toContain('stroke="currentColor"');
    expect(icons).not.toContain('fill="#');
  });
});
