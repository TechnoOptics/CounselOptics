// scripts/design/render-marketing.cjs
// Renders every marketing page at 1440 and 390, light and dark, from a
// local `next start`, and writes PNGs plus a report of sideways scroll,
// visible stamp count, contrast and stamp overlap.
// Usage: node scripts/design/render-marketing.cjs http://localhost:3111 /tmp/shots
//
// puppeteer-core plus the system Chrome on purpose: the browser MCP tools
// drive the page programmatically and will report a pass that a real
// browser would not give.
const puppeteer = require('puppeteer-core');
const fs = require('node:fs');
const [base, out] = process.argv.slice(2);
const PATHS = ['/', '/pricing', '/features', '/enterprise', '/about', '/what-is-advottic', '/security', '/guides', '/glossary', '/compare', '/press', '/changelog', '/status', '/accessibility', '/terms', '/privacy', '/cookies', '/dmca'];

/**
 * Everything the page is asked about, in one browser-side function so it
 * runs against the real cascade rather than against the source.
 *
 * The contrast probe is crude on purpose: for every h1, [data-stamp] and
 * [data-row], it takes each text-bearing element's computed colour, folds
 * in its own and its ancestors' `opacity`, composites it over the nearest
 * ancestor that actually paints a background, and reports anything under
 * 4.5:1. It exists because the enterprise cover shipped near-black ink on
 * a dark sheet at about 1.3:1 in a capture that was taken and not read.
 */
const PROBE = () => {
  const visible = (el) => {
    let n = el;
    while (n) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      n = n.parentElement;
    }
    return true;
  };
  // Resolve any CSS colour to rgba by painting it, rather than by parsing
  // the string: `text-accent-text` computes to `oklch(0.84 0.078 87.36)`,
  // and a regex that pulls three numbers out of that reads the stamp as
  // near-black and reports a 1.25:1 that is really 9:1.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const painted = (el) => {
    let n = el;
    while (n) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0.5) return [c[0], c[1], c[2]];
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const alphaTo = (el, stop) => {
    let a = 1;
    let n = el;
    while (n && n !== stop) {
      a *= Number(getComputedStyle(n).opacity || 1);
      n = n.parentElement;
    }
    return a;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  };
  const textLeaves = (root) => {
    const found = [];
    const walk = (el) => {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (own) found.push(el);
      for (const c of el.children) walk(c);
    };
    walk(root);
    return found;
  };

  const stamps = [...document.querySelectorAll('[data-stamp]')].filter(visible);
  const low = [];
  for (const root of [...document.querySelectorAll('h1, [data-stamp], [data-row]')].filter(visible)) {
    for (const el of textLeaves(root)) {
      const ground = painted(el);
      const fg = rgba(getComputedStyle(el).color);
      const a = fg[3] * alphaTo(el, null);
      const over = [0, 1, 2].map((i) => fg[i] * a + ground[i] * (1 - a));
      const r = ratio(lum(over), lum(ground));
      if (r < 4.5) {
        low.push(`${r.toFixed(2)}:1 ${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 40)}"`);
      }
    }
  }

  // The stamp is absolutely positioned over its Sheet and has landed on
  // the rows twice. Measure the text's own run rectangles with a Range,
  // not the element box: a block element's box runs the full column width,
  // so the pricing stamp read as covering "Pro" when it sits well right of
  // the word. The stamp's own box is still an axis-aligned box around a
  // rotated element, so it over-reports slightly, which is the safe side.
  const runs = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...r.getClientRects()];
  };
  const over = [];
  for (const st of stamps) {
    const sr = st.getBoundingClientRect();
    const sheet = st.closest('.relative') || st.parentElement;
    for (const el of textLeaves(sheet)) {
      if (st.contains(el)) continue;
      const hit = runs(el).some(
        (r) => r.right > sr.left && r.left < sr.right && r.bottom > sr.top && r.top < sr.bottom,
      );
      if (hit) over.push(el.textContent.trim().slice(0, 30));
    }
  }

  // Text the reader cannot see. A long filename must still never widen a
  // sheet, but SheetRow holds that with `min-w-0` and `overflow-wrap:
  // anywhere` rather than with `truncate`, so nothing on these pages is cut
  // on purpose any more and every hit here is a defect. It used to be a copy
  // length to weigh, and that reading is what let four exhibit names ship
  // cut to about three characters: a citation cut at "Electro-Craft Corp. v.
  // Con..." looked exactly like the deliberate ones until somebody read the
  // capture, and so did they.
  const cut = [];
  for (const el of [...document.querySelectorAll('[data-row] span, h1, h2')].filter(visible)) {
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis') {
      cut.push(el.textContent.trim().slice(0, 40));
    }
  }

  return {
    sideways: document.documentElement.scrollWidth > window.innerWidth,
    stamps: stamps.length,
    low,
    over,
    cut,
  };
};

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
      // off under reduced motion ("Reduced motion means none, not less"), so
      // this makes every capture deterministic instead of adding a sleep.
      // The trade-off: the audit never sees the animated state.
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
        // A swallowed navigation error used to leave whatever was on screen
        // from the previous path and report it as `stamps=0 ok`, which is
        // the expensive failure mode for an audit that is the only thing
        // looking at fourteen of these pages.
        let nav = null;
        let response = null;
        try {
          response = await page.goto(base + p, { waitUntil: 'networkidle2', timeout: 60000 });
        } catch (e) {
          nav = e.message;
        }
        if (nav) { report.push(`${scheme} ${name} ${p} NAV FAILED: ${nav}`); continue; }
        if (!response || !response.ok()) {
          report.push(`${scheme} ${name} ${p} NAV FAILED: HTTP ${response ? response.status() : 'no response'}`);
          continue;
        }
        await page.evaluate(() => document.querySelectorAll('button').forEach((b) => { if (/got it/i.test(b.textContent || '')) b.click(); }));
        const r = await page.evaluate(PROBE);
        const file = `${out}/${scheme}-${name}${p === '/' ? '-home' : p.replace(/\//g, '-')}.png`;
        await page.screenshot({ path: file, fullPage: true });
        const notes = [`stamps=${r.stamps}`, r.sideways ? 'SIDEWAYS SCROLL' : 'ok'];
        if (r.low.length) notes.push(`LOW CONTRAST: ${r.low.join(' | ')}`);
        if (r.over.length) notes.push(`STAMP OVER: ${r.over.join(' | ')}`);
        if (r.cut.length) notes.push(`TRUNCATED: ${r.cut.join(' | ')}`);
        report.push(`${scheme} ${name} ${p} ${notes.join(' ')}`);
      }
      await page.close();
    }
  }
  await browser.close();
  fs.writeFileSync(`${out}/report.txt`, report.join('\n') + '\n');
  console.log(report.join('\n'));
})().catch((e) => { console.error(e.message); process.exit(1); });
