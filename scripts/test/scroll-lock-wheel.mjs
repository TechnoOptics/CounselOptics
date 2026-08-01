#!/usr/bin/env node
/**
 * Does the page behind an open dialog actually stop scrolling?
 *
 * This is the one question about lib/scroll-lock.ts that cannot be
 * answered by reading source or by poking the DOM from a console.
 *
 *   - `window.scrollTo()` is PROGRAMMATIC and is not blocked by
 *     `overflow: hidden`. A scrollTo that still moves the page proves
 *     nothing about the lock, and a test built on it passes whether the
 *     lock works or not.
 *   - Several browser-automation tools "scroll" by calling scrollBy in
 *     page context. Those move `scrollY` while firing NO trusted wheel
 *     event, so they look exactly like a broken lock and will happily
 *     report a false failure - or a false pass.
 *
 * So this guard drives a real Chrome over CDP, sends a real wheel, and
 * asserts `event.isTrusted` fired on every phase before it believes any
 * scrollY reading. If no trusted wheel arrives, the run is void and the
 * guard fails rather than reporting a verdict it did not earn.
 *
 * The defect it protects against, originally diagnosed for the counsel
 * nav drawer in 8253a33 and swept across the app afterwards: every
 * overlay used to lock scrolling with `document.body.style.overflow =
 * 'hidden'` alone. app/globals.css puts `overflow-x: clip` on both
 * `html` and `body`, and per the CSS overflow spec the body's overflow
 * is only propagated to the viewport when the ROOT element's overflow
 * is `visible`. `clip visible` is not `visible`, so the propagation
 * never happened and the body-only lock reached nothing at all. Phase B
 * below reproduces that, and it is deliberately asserted to STILL
 * SCROLL - if a future stylesheet change ever made the body-only lock
 * start working, phase B fails and this comment needs revisiting.
 *
 * Phase D is not decoration. The cleanup has to restore the previous
 * INLINE value on both elements; writing back a literal `visible` or
 * `auto` would permanently defeat the stylesheet's `overflow-x: clip`
 * and let horizontal scroll back in on mobile.
 *
 * Phase C loads the shipped lib/scroll-lock.ts itself, transpiled from
 * source, rather than a copy - so what passes here is what ships.
 *
 * NOT part of `npm run test:audit-guards`: unlike the other guards in
 * this directory it needs a browser and a running server, so it stays
 * opt-in.
 *
 *   npm run dev                       # in one shell
 *   npm run test:scroll-lock          # in another
 *
 * APP_URL overrides the target (default http://localhost:3000).
 * CHROME_PATH overrides the browser binary.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP_URL = process.env.APP_URL || 'http://localhost:3000/';

// Narrow, because this is where a page scrolling under a dialog is
// worst: on a phone the scrim covers the screen and the content sliding
// around behind it is the only thing you can see.
const VIEWPORT = { width: 390, height: 844 };
const WHEEL_DELTA = 600;

function die(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    die(
      'No Chrome binary found. Install Google Chrome, or point CHROME_PATH at one:\n' +
        '  CHROME_PATH=/path/to/chrome npm run test:scroll-lock',
    );
  }
  return found;
}

/** The real module, compiled with the repo's own typescript. */
function loadShippedLockScroll() {
  const ts = require('typescript');
  const src = readFileSync(join(REPO, 'lib', 'scroll-lock.ts'), 'utf8');
  const out = ts.transpileModule(src, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  return `var exports = {};\n${out}\nwindow.__lockScroll = exports.lockScroll;`;
}

const puppeteer = require('puppeteer-core');

const res = await fetch(APP_URL).catch(() => null);
if (!res || !res.ok) {
  die(
    `No app answering at ${APP_URL}.\n` +
      'Start one first:  npm run dev\n' +
      'Or point elsewhere:  APP_URL=http://localhost:3111/ npm run test:scroll-lock',
  );
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
});
const results = [];

try {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.goto(APP_URL, { waitUntil: 'networkidle2' });
  await page.addScriptTag({ content: loadShippedLockScroll() });

  if (!(await page.evaluate(() => typeof window.__lockScroll === 'function'))) {
    die('lib/scroll-lock.ts did not load into the page; aborting rather than reporting a bogus verdict.');
  }

  await page.evaluate(() => {
    window.__wheels = 0;
    window.addEventListener(
      'wheel',
      (e) => {
        if (e.isTrusted) window.__wheels++;
      },
      { passive: true, capture: true },
    );
  });

  /** Reset the page, arm a lock, send one real wheel, report what moved. */
  async function phase(name, arm, expectation) {
    await page.evaluate(() => {
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
      document.body.style.paddingRight = '';
      window.scrollTo(0, 0);
      window.__wheels = 0;
      window.__unlock = null;
    });
    await page.evaluate(arm);
    await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
    await page.mouse.wheel({ deltaY: WHEEL_DELTA });
    await new Promise((r) => setTimeout(r, 400));

    const seen = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      trustedWheels: window.__wheels,
      bodyInline: document.body.style.overflow || '(empty)',
      rootInline: document.documentElement.style.overflow || '(empty)',
      rootUsedOverflowX: getComputedStyle(document.documentElement).overflowX,
    }));

    // A phase with no trusted wheel is void, not passing: the gesture
    // never reached the page, so scrollY says nothing either way.
    const gestureLanded = seen.trustedWheels > 0;
    results.push({
      phase: name,
      ...seen,
      expected: expectation.label,
      pass: gestureLanded && expectation.holds(seen),
    });
  }

  const SCROLLS = {
    label: 'scrolls',
    holds: (s) => s.scrollY > 0,
  };
  const HELD_STILL = {
    label: 'HELD STILL',
    holds: (s) => s.scrollY === 0,
  };
  const RELEASED = {
    label: 'scrolls again, clip restored',
    holds: (s) =>
      s.scrollY > 0 &&
      s.rootUsedOverflowX === 'clip' &&
      s.bodyInline === '(empty)' &&
      s.rootInline === '(empty)',
  };

  await phase('A. control, no lock', () => {}, SCROLLS);
  await phase(
    'B. body-only lock (the old code)',
    () => {
      document.body.style.overflow = 'hidden';
    },
    SCROLLS,
  );
  await phase(
    'C. lockScroll() from lib/scroll-lock.ts',
    () => {
      window.__unlock = window.__lockScroll();
    },
    HELD_STILL,
  );
  await phase(
    'D. after unlock()',
    () => {
      window.__lockScroll()();
    },
    RELEASED,
  );
} finally {
  await browser.close();
}

console.table(results);

const failed = results.filter((r) => !r.pass);
if (failed.length) {
  const void_ = failed.filter((r) => r.trustedWheels === 0);
  if (void_.length) {
    console.error(
      '\nNo trusted wheel event reached the page, so these phases are void, ' +
        'not failing:\n  ' +
        void_.map((f) => f.phase).join('\n  '),
    );
  }
  die(`FAILED: ${failed.map((f) => f.phase).join(', ')}`);
}
console.log('\nAll phases pass: the page is held still behind an open overlay, and released after.');
