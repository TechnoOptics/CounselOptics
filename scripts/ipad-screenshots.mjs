/**
 * Generate App Store iPad screenshots (2048x2732, "13-inch iPad
 * display" slot) by rendering advottic.com in a tablet-sized headless
 * Chrome viewport.
 *
 * App Store Connect requires at least one 13-inch iPad screenshot when
 * the binary declares iPad support (UIDeviceFamily includes 2). The
 * iOS app is a remote-URL Capacitor WebView of advottic.com, so a
 * 1024px-logical tablet viewport capture IS the real iPad experience.
 *
 * 1024x1366 CSS px @ deviceScaleFactor 2 = exactly 2048x2732 device
 * px, which App Store Connect accepts for the 12.9"/13" iPad slot.
 *
 * Output: store-assets/ipad-screenshots/NN-slug.png
 *
 * Run: node scripts/ipad-screenshots.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'store-assets', 'ipad-screenshots');
mkdirSync(OUT_DIR, { recursive: true });

const PAGES = [
  { slug: 'home', url: 'https://advottic.com/' },
  { slug: 'sol-checker', url: 'https://advottic.com/tools/statute-of-limitations' },
  { slug: 'templates', url: 'https://advottic.com/templates' },
  { slug: 'deadline-calculator', url: 'https://advottic.com/tools/court-deadline-calculator' },
  { slug: 'deposit-checker', url: 'https://advottic.com/tools/security-deposit-deduction-checker' },
  { slug: 'guides', url: 'https://advottic.com/guides' },
];

const browser = await puppeteer.launch({
  channel: 'chrome',
  headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  const page = await browser.newPage();
  // 1024x1366 CSS px @2x = exactly 2048x2732 device px (iPad 13" slot).
  await page.setViewport({
    width: 1024,
    height: 1366,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.setUserAgent(
    'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  );

  // Pre-set the consent cookie so the banner never renders.
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('advottic-cookie-consent', 'essential');
      localStorage.setItem('cookie-consent', 'essential');
      localStorage.setItem('consent', 'declined');
    } catch (e) {
      /* ignore */
    }
  });

  let i = 0;
  for (const { slug, url } of PAGES) {
    i += 1;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2500));
    // Belt-and-suspenders: dismiss the cookie banner if it still rendered.
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, a')];
      const hit =
        btns.find((b) => /essential only|decline|reject/i.test(b.textContent || '')) ||
        btns.find((b) => /got it/i.test(b.textContent || '')) ||
        btns.find((b) => /accept/i.test(b.textContent || ''));
      if (hit) hit.click();
    });
    await new Promise((r) => setTimeout(r, 1000));
    const file = join(OUT_DIR, `${String(i).padStart(2, '0')}-${slug}.png`);
    // Clip to exactly the viewport so the PNG is 2048x2732, not a
    // full-page tall capture.
    await page.screenshot({
      path: file,
      type: 'png',
      clip: { x: 0, y: 0, width: 1024, height: 1366 },
    });
    console.log(`saved ${file}`);
  }
} finally {
  await browser.close();
}
