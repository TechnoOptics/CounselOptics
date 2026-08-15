#!/usr/bin/env node
/**
 * What contrast does a reader actually get, on the pixels the compositor
 * actually painted?
 *
 * A class sweep cannot answer that. It sees an element's own class list
 * and nothing else, so for a bare `text-cream-100` it cannot tell "cream
 * on a dark panel", which is right, from "cream on the white page",
 * which is invisible. And a `background-image: linear-gradient()` has no
 * resolved `backgroundColor` at all, so walking the ancestor chain for a
 * ground reads `rgba(0,0,0,0)` and keeps walking past the very thing
 * that is painting.
 *
 * Modelling the gradient stops instead is no better. `.hero-bg` is four
 * translucent cream and gold washes over an opaque forest gradient, so
 * its lightest literal stop `rgba(245,237,214,0.32)` is not a ground at
 * all, and reading it as one turns a dark hero into a near-cream surface
 * and reports every cream heading on it at 1.08:1.
 *
 * THE METHOD. Render each page twice at the same layout:
 *
 *   1. as shipped, to read each text run's ink, size, weight and rects;
 *   2. with every glyph made transparent - `color`,
 *      `-webkit-text-fill-color`, `text-shadow`, and `background-image`
 *      on `bg-clip-text` elements - so the second render IS the ground.
 *
 * Screenshot the second at a viewport sized to the whole document, then
 * sample the pixels under each run's OWN glyph rects (per-line rects
 * from `Range.getClientRects()`, not the element's bounding box, so a
 * wrapped paragraph is not measured against the empty gutter beside its
 * last line).
 *
 * Both tails of the ground are kept: the 2nd and 98th percentile of
 * sampled luminance. On a gradient or under a blurred orb the ground is
 * not one colour, and the reader has to be able to read the letters at
 * both ends of it, so the reported ratio is the WORSE of the two.
 *
 * INK. A translucent ink is composited over each ground sample before
 * being measured, because that is what the compositor does -
 * `text-cream-100/45` is not a colour until it has a ground. For
 * `bg-clip-text` the GRADIENT is the ink and `color` is `transparent`
 * and carries no contrast information, so the floor is asked of every
 * stop and the worst stop is the answer.
 *
 * FLOOR. WCAG 2.2 AA: 3:1 for large text (>=24px, or >=18.66px at weight
 * >=700), 4.5:1 otherwise.
 *
 * Animations are stopped and the caret disabled so the two renders are
 * the same picture. The cookie dialog is removed from the DOM; it is an
 * overlay that would otherwise be the measured ground for the whole page
 * behind it.
 *
 * NOT part of `npm run test:audit-guards`: it needs a browser and a
 * running server, so it stays opt-in.
 *
 *   npm run dev                        # in one shell
 *   node scripts/test/rendered-contrast-audit.mjs      # in another
 *
 * APP_URL      overrides the target (default http://localhost:3000).
 * CHROME_PATH  overrides the browser binary.
 * ROUTES       comma-separated path list, overrides the default sweep.
 * ONLY         substring filter on the sample text, for re-measuring one
 *              finding without re-rendering the whole tree.
 * JSON         write the full run to this path.
 */

import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import { decodePng } from './lib/png-reader.mjs';

const require = createRequire(import.meta.url);
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const ONLY = process.env.ONLY || '';
const WIDTH = 1280;

/** The public consumer surface. Signed-in routes are out of reach here. */
const DEFAULT_ROUTES = [
  '/',
  '/enterprise',
  '/features',
  '/pricing',
  '/example',
  '/welcome',
  '/about',
  '/security',
  '/changelog',
  '/review-my-document',
  '/file-exhibits',
  '/public-defender',
  '/invite',
  '/safe',
];

const ROUTES = process.env.ROUTES
  ? process.env.ROUTES.split(',').map((r) => r.trim()).filter(Boolean)
  : DEFAULT_ROUTES;

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
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) die('No Chrome binary found. Point CHROME_PATH at one.');
  return found;
}

// ---------------------------------------------------------------- colour

/** WCAG relative luminance from 0-255 channels. */
function luminance(r, g, b) {
  const chan = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function contrastFromLum(a, b) {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** `src` over `dst`, both [r,g,b,a] with a in 0..1. Returns opaque rgb. */
function over(src, dst) {
  const a = src[3];
  return [
    src[0] * a + dst[0] * (1 - a),
    src[1] * a + dst[1] * (1 - a),
    src[2] * a + dst[2] * (1 - a),
  ];
}

function parseCssColor(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

/** Every colour stop in a `linear-gradient(...)`, as [r,g,b,a]. */
function gradientStops(image) {
  const out = [];
  const re = /rgba?\([^)]+\)|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi;
  let m;
  while ((m = re.exec(image))) {
    const tok = m[0];
    if (tok.startsWith('#')) {
      const h = tok.slice(1);
      const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
      out.push([
        parseInt(full.slice(0, 2), 16),
        parseInt(full.slice(2, 4), 16),
        parseInt(full.slice(4, 6), 16),
        1,
      ]);
    } else {
      const c = parseCssColor(tok);
      // A fully transparent stop paints nothing and is not ink.
      if (c && c[3] > 0.02) out.push(c);
    }
  }
  return out;
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

// ------------------------------------------------------- in-page harvest

/**
 * Runs of text, with the rects of their own lines. Kept as a string and
 * injected, so the logic lives next to the sampling that consumes it.
 */
const HARVEST = `(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TITLE','SVG','PATH','HEAD']);

  function isDisabled(el) {
    return !!el.closest(
      ':disabled, [aria-disabled="true"], [data-disabled="true"], fieldset:disabled',
    );
  }

  function isVisuallyHidden(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflow !== 'visible' && (n.offsetWidth <= 1 || n.offsetHeight <= 1)) return true;
      if (s.clipPath === 'inset(50%)') return true;
      if (s.clip === 'rect(0px, 0px, 0px, 0px)') return true;
    }
    return false;
  }

  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n, id = 0;
  while ((n = walker.nextNode())) {
    const text = n.nodeValue.replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || SKIP.has(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    // A screen-reader-only run has no pixels a sighted reader could fail
    // to read, and measuring it reports the colour of whatever it was
    // tucked behind. It cannot be spotted from the run's own rects:
    // \`clip\`/\`clip-path\` are PAINT-time, so the Range still reports a
    // full line box for text clipped to nothing. The giveaway is an
    // ancestor that is 1px or smaller with its overflow hidden, which is
    // what every spelling of the sr-only idiom comes down to.
    if (isVisuallyHidden(el)) continue;
    // WCAG 1.4.3 exempts text that is part of an INACTIVE control, and
    // measuring one is not just pedantry - \`disabled:opacity-60\` fades
    // the fill and the label together, so the ground render shows the
    // faded fill while \`color\` still reads at full strength and the
    // ratio comes out wrong in both directions.
    if (isDisabled(el)) continue;
    // An ancestor's opacity fades ink and ground together. The ground
    // render already shows the faded ground; the ink has to be faded to
    // match, or a 60%-opacity panel reports its text at full strength.
    let fade = 1;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const o = parseFloat(getComputedStyle(n).opacity);
      if (!Number.isNaN(o) && o < 1) fade *= o;
    }
    const rects = [...range.getClientRects()]
      .filter((r) => r.width >= 1 && r.height >= 1)
      .map((r) => ({
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
        w: r.width,
        h: r.height,
      }));
    if (!rects.length) continue;
    // Is anything painting ON TOP of this run? A page that renders its
    // chrome under a full-screen panel produces text nobody can see, at
    // a ratio that looks like a catastrophic contrast bug and is really
    // a "why is this in the DOM at all" bug. The two need separating,
    // because the fix is completely different.
    //
    // The viewport is sized to the whole document and the page is at
    // scroll 0, so page coordinates and client coordinates agree.
    // Decorative washes (the hero orbs) are pointer-events:none and are
    // deliberately NOT counted: they really do lighten the ground and a
    // reader really does have to read through them.
    let covered = 0;
    for (const r of rects) {
      const hit = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) covered++;
    }
    const occluded = covered === rects.length;
    // bg-clip-text makes the background-image the ink.
    const clipped =
      cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text';
    out.push({
      id: id++,
      text: text.slice(0, 90),
      color: cs.color,
      fill: cs.webkitTextFillColor,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: cs.fontWeight,
      clipped,
      occluded,
      fade,
      image: clipped ? cs.backgroundImage : '',
      cls: (el.getAttribute('class') || '').slice(0, 160),
      tag: el.tagName.toLowerCase(),
      rects,
    });
  }
  return out;
})()`;

/** Make every glyph transparent so what remains is the ground. */
const BLANK_INK = `(() => {
  const s = document.createElement('style');
  s.id = '__ground__';
  s.textContent = \`
    *, *::before, *::after {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-shadow: none !important;
      text-decoration-color: transparent !important;
      caret-color: transparent !important;
    }
  \`;
  document.head.appendChild(s);
  // bg-clip-text paints the background AS the glyphs, so it has to go
  // too - otherwise the letters stay visible in the ground render and
  // get sampled as their own ground.
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.webkitBackgroundClip === 'text' || cs.backgroundClip === 'text') {
      el.style.setProperty('background-image', 'none', 'important');
    }
  }
  return true;
})()`;

/** Stop motion and drop overlays that would be the measured ground. */
const SETTLE = `(() => {
  const s = document.createElement('style');
  // NOT \`animation: none\`. A scroll-reveal starts from \`opacity: 0\` and
  // animates up, so switching the animation off strands it at zero and
  // the page reports text nobody could read - which is the harness's
  // fault, not the page's. Running every animation to completion in 1ms
  // and holding the last frame is just as deterministic and lands on
  // the state a reader actually sees.
  s.textContent = \`
    *, *::before, *::after {
      animation-duration: 1ms !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      animation-fill-mode: forwards !important;
      transition-duration: 1ms !important;
      transition-delay: 0s !important;
    }
  \`;
  document.head.appendChild(s);
  window.scrollTo(0, 0);
  return true;
})()`;

/**
 * Drop the cookie dialog.
 *
 * Run AFTER the settle wait, not with it: CookieBanner is a client
 * component that mounts on hydration, so a removal fired the moment
 * `networkidle2` resolves happens before the dialog exists and the
 * dialog is back by the time anything is measured. That is not a
 * cosmetic problem - it covers the page it is asking about, so every
 * run behind it reads the scrim as its ground and is reported at ~1:1,
 * or is written off as occluded and silently stops being measured at
 * all. Both are wrong answers that look like answers.
 */
const DROP_OVERLAYS = `(() => {
  let n = 0;
  for (const sel of [
    '[data-cookie-dialog]',
    '[aria-label*="ookie"]',
    '[class*="cookie" i]',
  ]) {
    for (const el of document.querySelectorAll(sel)) { el.remove(); n++; }
  }
  return n;
})()`;

/**
 * Anything still painting over most of the viewport once the cookie
 * dialog is gone. A route that reports one is not measurable, and the
 * run says so rather than quietly reporting the scrim.
 */
const REMAINING_OVERLAY = `(() => {
  const vw = window.innerWidth, vh = Math.min(window.innerHeight, 2000);
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    if (cs.pointerEvents === 'none' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width >= vw * 0.9 && r.height >= vh * 0.9 && r.top < 50) {
      return el.tagName + '.' + String(el.className || '').slice(0, 60);
    }
  }
  return null;
})()`;

// ------------------------------------------------------------------ main

const puppeteer = require('puppeteer-core');

const probe = await fetch(APP_URL + '/').catch(() => null);
if (!probe || !probe.ok) die(`No app answering at ${APP_URL}. Start one:  npm run dev`);

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--force-device-scale-factor=1', '--hide-scrollbars'],
});

const findings = [];
/** Below the floor, but painted under something opaque. A different bug. */
const occlusions = [];
let measured = 0;

try {
  // Warm every route first. `next dev` compiles on demand, and a cold
  // route hydrates late enough that a client-rendered overlay can be
  // absent from the capture on one run and present on the next - which
  // showed up as /welcome reporting 2 findings warm and 44 cold.
  {
    const warm = await browser.newPage();
    await warm.setViewport({ width: WIDTH, height: 900 });
    for (const route of ROUTES) {
      await warm.goto(APP_URL + route, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    }
    await warm.close();
  }

  for (const route of ROUTES) {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 1 });
    try {
      await page.goto(APP_URL + route, { waitUntil: 'networkidle2', timeout: 45000 });
    } catch {
      console.error(`  ! ${route} did not settle; skipped`);
      await page.close();
      continue;
    }
    await page.evaluate(SETTLE);
    // Let the layout settle after the overlay removal.
    await new Promise((r) => setTimeout(r, 400));

    const docHeight = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    // Size the viewport to the whole document so one screenshot is the
    // whole page and every rect is in frame at its recorded coordinates.
    // Chrome will not composite past its max texture size, so a taller
    // page is reported rather than silently measured against black.
    const CAP = 15000;
    if (docHeight + 40 > CAP) {
      console.error(`  ! ${route} is ${docHeight}px tall, past the ${CAP}px capture cap; skipped`);
      await page.close();
      continue;
    }
    await page.setViewport({ width: WIDTH, height: docHeight + 40, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(DROP_OVERLAYS);
    await new Promise((r) => setTimeout(r, 150));

    // A page-covering panel that is NOT the route's own is a measurement
    // that cannot be trusted, so it is refused rather than reported.
    // /safe's own SafeWitness surface is the one legitimate case, and it
    // is what the occlusion section exists to describe.
    const overlay = await page.evaluate(REMAINING_OVERLAY);
    if (overlay && !route.startsWith('/safe')) {
      console.error(`  ! ${route} is covered by ${overlay}; not measurable, skipped`);
      await page.close();
      continue;
    }

    const runs = await page.evaluate(HARVEST);
    await page.evaluate(BLANK_INK);
    await new Promise((r) => setTimeout(r, 250));

    const shot = await page.screenshot({ type: 'png', fullPage: false });
    const png = await decodePng(shot);
    await page.close();

    for (const run of runs) {
      if (ONLY && !run.text.includes(ONLY)) continue;

      // Ground samples under this run's own glyph rects.
      const lums = [];
      const rgbs = [];
      for (const r of run.rects) {
        const x0 = Math.max(0, Math.floor(r.x));
        const y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(png.width - 1, Math.ceil(r.x + r.w));
        const y1 = Math.min(png.height - 1, Math.ceil(r.y + r.h));
        const stepX = Math.max(1, Math.floor((x1 - x0) / 60));
        const stepY = Math.max(1, Math.floor((y1 - y0) / 12));
        for (let y = y0; y <= y1; y += stepY) {
          for (let x = x0; x <= x1; x += stepX) {
            const px = png.at(x, y);
            if (!px) continue;
            lums.push(luminance(px[0], px[1], px[2]));
            rgbs.push(px);
          }
        }
      }
      if (lums.length < 8) continue;

      const order = lums.map((l, i) => i).sort((a, b) => lums[a] - lums[b]);
      const loIdx = order[Math.round(0.02 * (order.length - 1))];
      const hiIdx = order[Math.round(0.98 * (order.length - 1))];
      const grounds = [rgbs[loIdx], rgbs[hiIdx]];

      // Ink candidates.
      const inks = [];
      if (run.clipped) {
        for (const s of gradientStops(run.image)) inks.push(s);
      } else {
        const c = parseCssColor(run.fill && run.fill !== 'currentcolor' ? run.fill : run.color);
        if (c) inks.push(c);
      }
      if (!inks.length) continue;
      // Ancestor opacity fades the ink; the ground render already shows
      // the ground faded by the same amount.
      if (run.fade < 1) for (const ink of inks) ink[3] *= run.fade;
      // A fully transparent ink with no gradient paints nothing.
      if (inks.every((i) => i[3] <= 0.02)) continue;

      let worst = Infinity;
      let worstGround = null;
      for (const g of grounds) {
        const gl = luminance(g[0], g[1], g[2]);
        for (const ink of inks) {
          const solid = over(ink, g);
          const ratio = contrastFromLum(luminance(...solid), gl);
          if (ratio < worst) {
            worst = ratio;
            worstGround = g;
          }
        }
      }

      const weight = parseInt(run.fontWeight, 10) || 400;
      const large = run.fontSize >= 24 || (run.fontSize >= 18.66 && weight >= 700);
      const floor = large ? 3 : 4.5;
      measured += 1;
      if (worst < floor - 0.005) {
        (run.occluded ? occlusions : findings).push({
          route,
          text: run.text,
          ratio: +worst.toFixed(2),
          floor,
          fontSize: +run.fontSize.toFixed(1),
          weight,
          clipped: run.clipped,
          color: run.clipped ? '(gradient)' : run.color,
          ground: `rgb(${worstGround.slice(0, 3).map(Math.round).join(',')})`,
          cls: run.cls,
        });
      }
    }
    const onRoute = findings.filter((f) => f.route === route).length;
    console.log(`  ${route.padEnd(22)} ${String(runs.length).padStart(5)} runs  ${onRoute} below floor`);
  }
} finally {
  await browser.close();
}

// ---------------------------------------------------------------- report

console.log(`\n${measured} runs measured, ${findings.length} below the AA floor.\n`);

// Group by the thing a fix would touch: the ratio and the class list.
const groups = new Map();
for (const f of findings) {
  const key = `${f.color}|${f.cls}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(f);
}
const ordered = [...groups.values()].sort(
  (a, b) => Math.min(...a.map((x) => x.ratio)) - Math.min(...b.map((x) => x.ratio)),
);
for (const g of ordered) {
  const worst = Math.min(...g.map((x) => x.ratio));
  const routes = [...new Set(g.map((x) => x.route))].join(' ');
  console.log(
    `${String(worst).padStart(5)}:1  floor ${g[0].floor}  x${String(g.length).padStart(3)}  ` +
      `${g[0].fontSize}px/${g[0].weight}  ${g[0].color}`,
  );
  console.log(`         ${routes}`);
  console.log(`         "${g[0].text.slice(0, 74)}"`);
  console.log(`         ${g[0].cls.slice(0, 96)}`);
  console.log(`         ground ${g[0].ground}\n`);
}

if (occlusions.length) {
  const byRoute = new Map();
  for (const o of occlusions) byRoute.set(o.route, (byRoute.get(o.route) || 0) + 1);
  console.log(
    `Separately, ${occlusions.length} runs are below the floor but are painted\n` +
      `UNDER something opaque, so no reader ever sees them. That is not a\n` +
      `contrast bug - it is chrome being rendered beneath a full-screen panel:\n`,
  );
  for (const [r, n] of [...byRoute].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${r}`);
  }
  console.log();
}

if (process.env.JSON) {
  writeFileSync(process.env.JSON, JSON.stringify({ measured, findings, occlusions }, null, 2));
  console.log(`wrote ${process.env.JSON}`);
}
