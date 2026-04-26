// Capture the landing-hero product screenshot in both light and dark
// variants. Pre-seeds localStorage so the cookie banner stays hidden,
// uses Playwright's colorScheme option so prefers-color-scheme: dark
// triggers the proper Advottic dark-mode CSS instead of Chrome's force-
// dark heuristic.
//
// Usage: node scripts/capture-hero.mjs <port>
// Defaults to http://localhost:3000 if no port is supplied.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const port = process.argv[2] || '3000';
const url = `http://localhost:${port}/example`;
const outDir = path.resolve('public/marketing');
await mkdir(outDir, { recursive: true });

async function capture(scheme) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
  await context.addInitScript(() => {
    try {
      // Hide the cookie banner. Same key used by components/CookieBanner.tsx.
      localStorage.setItem(
        'co-cookie-ack',
        JSON.stringify({ accepted: true, when: Date.now() }),
      );
    } catch {
      /* ignore */
    }
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  // Belt + suspenders: if the banner did render, wait briefly for it
  // to clear, then force-remove via DOM in case the storage check
  // races the first paint.
  await page.evaluate(() => {
    const el = document.querySelector('[role="dialog"][aria-label*="cookie" i]');
    if (el) el.remove();
    document.querySelectorAll('[data-cookie-banner]').forEach((n) => n.remove());
  }).catch(() => {});
  // Give animations a beat to settle.
  await page.waitForTimeout(800);

  const file = scheme === 'dark' ? 'case-detail-hero-dark.png' : 'case-detail-hero.png';
  const target = path.join(outDir, file);
  await page.screenshot({ path: target, fullPage: false });
  console.log(`saved ${target}`);
  await browser.close();
}

await capture('light');
await capture('dark');
console.log('done.');
