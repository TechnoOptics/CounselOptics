// scripts/design/render-marketing.cjs
// Renders every marketing page at 1440 and 390, light and dark, from a
// local `next start`, and writes PNGs plus a sideways-scroll report.
// Usage: node scripts/design/render-marketing.cjs http://localhost:3111 /tmp/shots
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const [base, out] = process.argv.slice(2);
const PATHS = ['/', '/pricing', '/features', '/enterprise', '/about', '/what-is-advottic', '/security', '/guides', '/glossary', '/compare', '/press', '/changelog', '/status', '/accessibility', '/terms', '/privacy', '/cookies', '/dmca'];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const report = [];
  for (const scheme of ['light', 'dark']) {
    for (const [name, w, h] of [['desk', 1440, 900], ['phone', 390, 844]]) {
      const page = await browser.newPage();
      await page.setViewport({ width: w, height: h });
      // Also emulate prefers-reduced-motion: reduce. The cover's one motion
      // (app/globals.css, "file-assemble"/"file-stamp") lands the gold stamp
      // opacity 0 -> 1 over a 640ms delay plus a 400ms animation, so a
      // screenshot taken right after navigation can race it and capture the
      // stamp mid-animation (opacity 0, so it reads as missing even though
      // stamps=1 in the DOM). The site's own CSS already turns the animation
      // off under reduced motion ("Reduced motion means none, not less"),
      // landing straight on the final, fully-visible state, so this makes
      // every capture deterministic instead of adding an arbitrary sleep.
      await page.emulateMediaFeatures([
        { name: 'prefers-color-scheme', value: scheme },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ]);
      // ThemeBoot (components/ThemeBoot.tsx) resolves an unauthenticated
      // visitor's theme as `stored || server || 'system'`, and the marketing
      // layout always passes a 'light' server default, so `stored` (the
      // 'advottic-theme' localStorage key) wins over prefers-color-scheme
      // every time. Without this, emulateMediaFeatures alone never produces
      // a dark render. Set it before each navigation so the two schemes are
      // actually different renders, not two light ones.
      await page.evaluateOnNewDocument((s) => {
        try { localStorage.setItem('advottic-theme', s); } catch (_) {}
      }, scheme);
      for (const p of PATHS) {
        await page.goto(base + p, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
        await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (/got it/i.test(b.textContent || '')) b.click(); }));
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        // Count only VISIBLE stamps: the pricing page renders two [data-stamp]
        // nodes in the DOM at once (one in the desk table container, one in
        // the phone sheet), mutually exclusive by breakpoint via
        // hidden/sm:block and sm:hidden. Counting all nodes would report
        // stamps=2 on pricing even though a reader only ever sees one, so
        // walk each node's ancestor chain and only count it when neither the
        // node nor any ancestor computes display:none.
        const stamps = await page.evaluate(() => {
          function isVisible(el) {
            let node = el;
            while (node) {
              if (getComputedStyle(node).display === 'none') return false;
              node = node.parentElement;
            }
            return true;
          }
          return Array.from(document.querySelectorAll('[data-stamp]')).filter(isVisible).length;
        });
        const file = `${out}/${scheme}-${name}${p === '/' ? '-home' : p.replace(/\//g, '-')}.png`;
        await page.screenshot({ path: file, fullPage: true });
        report.push(`${scheme} ${name} ${p} stamps=${stamps} ${sideways ? 'SIDEWAYS SCROLL' : 'ok'}`);
      }
      await page.close();
    }
  }
  await browser.close();
  fs.writeFileSync(`${out}/report.txt`, report.join('\n') + '\n');
  console.log(report.join('\n'));
})().catch((e) => { console.error(e.message); process.exit(1); });
