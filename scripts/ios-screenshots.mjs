/**
 * Generate App Store screenshots (1284x2778, iPhone 6.5"/6.7" class)
 * by rendering advottic.com pages in a phone-sized headless Chrome
 * viewport.
 *
 * The iOS app is a remote-URL Capacitor WebView of advottic.com, so
 * mobile-viewport captures of the live site ARE the app experience -
 * these are accurate App Store screenshots, not mockups.
 *
 * Output: store-assets/ios-screenshots/NN-slug.png at exactly
 * 1284x2778 (428x926 CSS px at deviceScaleFactor 3).
 *
 * Run: node scripts/ios-screenshots.mjs
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'store-assets', 'ios-screenshots');
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
  // Separate profile so we don't disturb the user's running Chrome.
  args: ['--no-first-run', '--no-default-browser-check'],
});

try {
  const page = await browser.newPage();
  // 428x926 CSS px @3x = exactly 1284x2778 device px.
  await page.setViewport({
    width: 428,
    height: 926,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await page.setUserAgent(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  );

  // Pre-set the consent cookie so the banner never renders. The
  // site stores its choice in localStorage; seed it before the
  // first paint of each page.
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
    // Allow webfonts + fade-up animations to settle.
    await new Promise((r) => setTimeout(r, 2500));
    // Belt-and-suspenders: dismiss the cookie banner if it still
    // rendered (click "Got it" / "Essential only" / "Decline" / X).
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
    await page.screenshot({ path: file, type: 'png' });
    console.log(`saved ${file}`);
  }
} finally {
  await browser.close();
}
