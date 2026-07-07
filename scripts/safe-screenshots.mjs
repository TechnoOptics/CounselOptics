/**
 * Capture the Safe Witness / Safe Alert flagship screen for the app
 * stores. /safe renders the SafeWitness component; seeding the
 * `safe:contact` localStorage entry puts it in the idle "press &
 * hold to send a Safe Alert" state (instead of the first-run setup
 * form), which is the recognizable safety visual we want on the
 * listings.
 *
 * Outputs Play (1080x1920) and App Store (1284x2778) sizes:
 *   store-assets/android-screenshots/07-safe-alert.png
 *   store-assets/ios-screenshots/07-safe-alert.png
 *
 * Run: node scripts/safe-screenshots.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TARGETS = [
  {
    dir: join(process.cwd(), 'store-assets', 'android-screenshots'),
    file: '07-safe-alert.png',
    width: 432,
    height: 768,
    dsf: 2.5,
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  },
  {
    dir: join(process.cwd(), 'store-assets', 'ios-screenshots'),
    file: '07-safe-alert.png',
    width: 428,
    height: 926,
    dsf: 3,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  },
];

const browser = await puppeteer.launch({
  channel: 'chrome',
  headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  for (const t of TARGETS) {
    mkdirSync(t.dir, { recursive: true });
    const page = await browser.newPage();
    await page.setViewport({
      width: t.width,
      height: t.height,
      deviceScaleFactor: t.dsf,
      isMobile: true,
      hasTouch: true,
    });
    await page.setUserAgent(t.ua);
    // Seed consent + a saved emergency contact so the page lands on
    // the armed "press & hold" idle state, not the setup form.
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('advottic-cookie-consent', 'essential');
        localStorage.setItem('cookie-consent', 'essential');
        localStorage.setItem('consent', 'declined');
        localStorage.setItem(
          'safe:contact',
          JSON.stringify({ name: 'Maria Lopez', email: 'maria@example.com' }),
        );
      } catch (e) {
        /* ignore */
      }
    });
    await page.goto('https://advottic.com/safe', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, a')];
      const hit =
        btns.find((b) => /essential only|decline|reject/i.test(b.textContent || '')) ||
        btns.find((b) => /got it/i.test(b.textContent || ''));
      if (hit) hit.click();
    });
    await new Promise((r) => setTimeout(r, 1000));
    const out = join(t.dir, t.file);
    await page.screenshot({ path: out, type: 'png' });
    console.log(`saved ${out}`);
    await page.close();
  }
} finally {
  await browser.close();
}
