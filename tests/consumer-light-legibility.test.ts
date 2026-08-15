import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import defaultColors from 'tailwindcss/colors';
import tailwindConfig from '../tailwind.config';
import { AA_SMALL_TEXT, ACCENT_TEXT_SURFACES, contrastRatio } from '../lib/accent-text';

/**
 * THE CONSUMER SURFACE, IN THE LIGHT THEME.
 *
 * tests/light-mode-legibility.test.ts sweeps app/counsel, app/portal and
 * components/counsel. It has never reached the consumer tree, and on
 * 2026-08-10 a rendered audit of 32 public consumer routes found 331 runs
 * of text under WCAG AA on a light ground: `text-ink-400` at 2.54:1 on
 * real body copy, the gold ramp between 1.77:1 and 4.42:1 on every
 * section eyebrow, `text-emerald-600` at 3.70:1 down the pricing tiers.
 *
 * WHAT THIS GUARD CAN HONESTLY SEE, AND WHAT IT CANNOT.
 *
 * A class sweep knows an element's own class list and nothing else. It
 * does not know what its ANCESTORS paint, so for a bare `text-cream-100`
 * it cannot tell "cream on a dark panel", which is right, from "cream on
 * the white page", which is invisible. Guessing either way produces a
 * number that looks measured and is not, and this repo has already
 * shipped a guard that passed while the component it covered was
 * invisible in a browser.
 *
 * So it does not guess. It measures exactly the occurrences whose ground
 * the SOURCE states, and lists the rest:
 *
 *   MEASURED  the element carries a `dark:text-*` twin. That twin is the
 *             author saying, in the class list itself, "the other one is
 *             my LIGHT value" - which is only true if the element is on a
 *             light ground in the light theme. Every defect fixed on
 *             2026-08-10 was of exactly this shape
 *             (`text-ink-400 dark:text-cream-100/45`,
 *             `text-gold-700 dark:text-gold-300`).
 *   LISTED    everything else, bucketed by why, with the buckets sized so
 *             one cannot quietly swallow the measured set. These are not
 *             passes. They are the half of the tree only a rendered audit
 *             can judge, and scripts/ has no browser.
 *
 * The ground is the element's own `bg-*` when it declares one, composited
 * over `#ffffff` - the colour `html, body` actually declares - and the
 * page itself otherwise. A cream card fill inherited from an ancestor is
 * out of reach and is stated as such rather than assumed away.
 */

const root = new URL('..', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');
const globalsCss = read('app/globals.css');

/* ------------------------------------------------------------------ */
/* Reading the stylesheet                                              */
/* ------------------------------------------------------------------ */

/**
 * Split a selector list on TOP-LEVEL commas only.
 *
 * `:is(.a, .b)` and `:not(.x, .y)` carry commas of their own, and a plain
 * `split(',')` tears them into fragments. `.text-cream-100` fell out of
 * one such `:is()` list, lost the `.dark` ancestor that qualified it, and
 * made every cream utility in the tree resolve to the dark-wrapper value.
 */
function splitTop(sel: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const c of sel) {
    if (c === '(') depth += 1;
    else if (c === ')') depth -= 1;
    if (c === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

type Rule = { selectors: string[]; body: string; at: string[] };

/**
 * Every rule in the sheet, with the at-rules it sits inside.
 *
 * Brace-aware rather than `([^{}]+)\{([^{}]*)\}`, which glues everything
 * since the previous `}` onto the selector: the FIRST rule in this file
 * carries the `@tailwind` preamble, so `selectors.includes(':root')` was
 * false for it and the whole forest ramp read as undeclared.
 */
function readRules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const at: string[] = [];
  let i = 0;
  let buf = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) {
        at.push(prelude);
        i += 1;
        continue;
      }
      let depth = 1;
      let j = i + 1;
      for (; j < src.length && depth > 0; j += 1) {
        if (src[j] === '{') depth += 1;
        else if (src[j] === '}') depth -= 1;
      }
      out.push({ selectors: splitTop(prelude), body: src.slice(i + 1, j - 1), at: at.slice() });
      i = j;
      continue;
    }
    if (c === '}') {
      at.pop();
      buf = '';
      i += 1;
      continue;
    }
    if (c === ';') {
      buf = '';
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  return out;
}

const RULES = readRules(globalsCss).filter(
  (r) => !r.at.some((a) => /print|prefers-reduced-motion|keyframes/.test(a)),
);

/**
 * Does this selector paint on the consumer light surface?
 *
 * `:not()` contents are stripped BEFORE the test. `html:not(.dark)` is
 * the light scope itself, and a substring check for `.dark` throws away
 * every rule in the layer it is supposed to be reading - which silently
 * reported the whole fix as absent.
 */
function lightScope(sel: string): boolean {
  const s = sel.replace(/:not\([^()]*\)/g, '');
  return !/\.dark|counsel-shell|hq-shell|enterprise-shell|surface-hq|surface-counsel/.test(s);
}

type Paint = { hex: string; alpha: number };

function parseColour(value: string): Paint | null {
  const v = value.trim();
  const six = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (six) return { hex: `#${six[1].toLowerCase()}`, alpha: 1 };
  const three = /^#([0-9a-fA-F]{3})$/.exec(v);
  if (three) {
    return {
      hex: `#${three[1]
        .split('')
        .map((c) => c + c)
        .join('')
        .toLowerCase()}`,
      alpha: 1,
    };
  }
  const rgba = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(v);
  if (!rgba) return null;
  const to2 = (n: string) => Number(n).toString(16).padStart(2, '0');
  return {
    hex: `#${to2(rgba[1])}${to2(rgba[2])}${to2(rgba[3])}`,
    alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}

/**
 * A custom property's value on the consumer light surface.
 *
 * The `@supports (color: oklch(from ...))` refinement is skipped on
 * purpose: its four numbers are the ones lib/accent-text.ts derives and
 * tests/accent-text.test.ts proves for every customer hex. What is read
 * here is the STATIC fallback, which is what a browser without relative
 * colour syntax paints, and which has to clear the floor on its own.
 */
function varValue(name: string): Paint | null {
  let found: Paint | null = null;
  for (const r of RULES) {
    if (!r.selectors.some((s) => s === ':root' || s === 'html' || s === 'body')) continue;
    if (r.at.some((a) => a.startsWith('@supports'))) continue;
    const m = new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+)`).exec(r.body);
    if (m) found = parseColour(m[1]) ?? found;
  }
  return found;
}

function declaredColour(value: string): Paint | null {
  const direct = parseColour(value);
  if (direct) return direct;
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value.trim());
  return ref ? varValue(ref[1]) : null;
}

/* The forest ramp, from the channels `:root` declares. */
const FOREST: Record<string, string> = {};
for (const r of RULES) {
  if (!r.selectors.includes(':root')) continue;
  for (const m of r.body.matchAll(/--forest-(\d+):\s*([\d\s]+)/g)) {
    FOREST[`forest-${m[1]}`] =
      '#' +
      m[2]
        .trim()
        .split(/\s+/)
        .map((v) => Number(v).toString(16).padStart(2, '0'))
        .join('');
  }
}

/* The palette, from the real config and Tailwind's own defaults. */
const PALETTE: Record<string, string> = {};
{
  const flatten = (family: string, value: unknown) => {
    if (typeof value === 'string') {
      const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
      if (!m) return;
      const digits =
        m[1].length === 3
          ? m[1]
              .split('')
              .map((c) => c + c)
              .join('')
          : m[1];
      if (!(family in PALETTE)) PALETTE[family] = `#${digits}`.toLowerCase();
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [stop, v] of Object.entries(value as Record<string, unknown>)) {
      flatten(stop === 'DEFAULT' ? family : `${family}-${stop}`, v);
    }
  };
  for (const [family, value] of Object.entries(
    (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, unknown>,
  )) {
    flatten(family, value);
  }
  for (const [family, value] of Object.entries(
    defaultColors as unknown as Record<string, unknown>,
  )) {
    if (['lightBlue', 'warmGray', 'trueGray', 'coolGray', 'blueGray'].includes(family)) continue;
    if (family === 'forest') continue;
    flatten(family, value);
  }
}

const TOKEN_VAR: Record<string, string> = {
  muted: '--muted',
  foreground: '--foreground',
  background: '--background',
  surface: '--surface',
  'surface-2': '--surface-2',
  'accent-text': '--accent-text',
  'accent-on': '--accent-on',
  'warn-text': '--warn-text',
  'danger-text': '--danger-text',
  'info-text': '--info-text',
  'code-fg': '--code-fg',
  'code-bg': '--code-bg',
  accent: '--accent',
  'accent-2': '--accent-2',
  edge: '--border',
  'edge-bright': '--border-bright',
};

/**
 * The consumer light surface may only be reached through a scope root.
 * A rule with any other ancestor is CONDITIONAL on structure this sweep
 * cannot see - globals.css writes its contrast guards as
 * `html:not(.dark) .bg-white > .text-cream-200`, and treating one of
 * those as unconditional resolved every cream utility in the tree to the
 * rescue value and reported cream-on-forest chips at 1.00:1.
 */
const SCOPE_ROOTS = ['html:not(.dark)', 'html', ':root', ''];

function repaint(cls: string, prop: 'color' | 'background-color', worn: string[]): Paint | null {
  // The class name AS THE STYLESHEET SPELLS IT: a variant utility is
  // escaped in the CSS (`.hover\:text-gold-700:hover`), so the needle
  // carries a real backslash and must be searched for literally. A regex
  // built from the same string reads `\:` as a plain colon, matches
  // nothing, and reports every hover and placeholder spelling as
  // unrepainted.
  const escaped = cls.replace(/([:/])/g, '\\$1');
  let found: Paint | null = null;
  for (const r of RULES) {
    const hit = r.selectors.some((sel) => {
      if (!lightScope(sel)) return false;
      const at = sel.indexOf(`.${escaped}`);
      if (at === -1) return false;
      const before = at === 0 ? ' ' : sel[at - 1];
      if (!/[\s>+~(]/.test(before)) return false;
      const after = sel.slice(at + escaped.length + 1);
      if (/^[\w\\/-]/.test(after)) return false;
      const head = sel.slice(0, at).trim().replace(/>$/, '').trim();
      if (!SCOPE_ROOTS.includes(head) && !/^(html:not\(\.dark\) )?\.group:hover$/.test(head)) {
        return false;
      }
      if (after && !/^(::?[\w-]+(\([^()]*\))?)+$/.test(after)) return false;
      for (const n of after.matchAll(/:not\(\.([^)]+)\)/g)) {
        if (worn.includes(n[1].replace(/\\/g, ''))) return false;
      }
      return true;
    });
    if (!hit) continue;
    const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`).exec(r.body);
    if (m) found = declaredColour(m[1].replace('!important', '').trim()) ?? found;
  }
  return found;
}

function resolve(cls: string, worn: string[], prop: 'color' | 'background-color'): Paint | null {
  const bare = cls.replace(/^(?:[a-z0-9-]+(?:\/[a-z0-9-]+)?:)*/, '');
  const body = bare.replace(/^(?:text|bg)-/, '');
  const arbitrary = /^\[(#[0-9a-fA-F]{6})\]$/.exec(body);
  if (arbitrary) return { hex: arbitrary[1].toLowerCase(), alpha: 1 };
  const [name, alphaPart] = body.split('/');
  // `/[0.03]` is an ARBITRARY alpha and already a fraction; `/5` is a
  // percentage. Reading the bracketed form as a percentage produced NaN,
  // which propagated through the compositor and turned a 3%-tint chip
  // into a ground that failed 132 call sites at 2.72:1.
  const alpha =
    alphaPart === undefined
      ? 1
      : /^\[[\d.]+\]$/.test(alphaPart)
        ? Number(alphaPart.slice(1, -1))
        : Number(alphaPart) / 100;
  if (!Number.isFinite(alpha)) return null;
  const painted = repaint(cls, prop, worn);
  if (painted) return painted;
  if (TOKEN_VAR[name]) {
    const v = varValue(TOKEN_VAR[name]);
    return v && { ...v, alpha: v.alpha * alpha };
  }
  if (FOREST[name]) return { hex: FOREST[name], alpha };
  if (PALETTE[name]) return { hex: PALETTE[name], alpha };
  return null;
}

const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const composite = (paint: Paint, ground: string): string => {
  if (paint.alpha >= 0.999) return paint.hex;
  const f = channels(paint.hex);
  const g = channels(ground);
  return (
    '#' +
    f
      .map((v, i) =>
        Math.round(v * paint.alpha + g[i] * (1 - paint.alpha))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};

/* ------------------------------------------------------------------ */
/* Reading the tree                                                    */
/* ------------------------------------------------------------------ */

/**
 * Every tracked `.tsx` under `app/` and `components/` that is NOT the
 * counsel or portal surface and does not render a shell of its own.
 *
 * DIRECTORIES, not globs: `git ls-files 'components/**\/*.tsx'` wants a
 * path component on each side of a `**` and matches only SUBdirectories,
 * which is how the counsel sweep once measured 2 files of 49 and stayed
 * green. The shell filter reads the files rather than listing routes, so
 * a new always-dark surface removes itself the day it is added.
 */
function tracked(dirs: string[]): string[] {
  return execFileSync('git', ['ls-files', '--', ...dirs], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  })
    .split('\n')
    .filter((f) => f && f.endsWith('.tsx'));
}

const SHELL = /counselShellClass|counsel-shell|hq-shell|enterprise-shell/;
const FILES = tracked(['app', 'components'])
  .filter((f) => !/^app\/counsel\/|^app\/portal\/|^components\/counsel\//.test(f))
  .filter((f) => !SHELL.test(read(f)));

/**
 * The component classes that paint a DARK fill with no `bg-*` utility at
 * the call site, read out of globals.css rather than restated here. That
 * file keeps the list in the exemption clause of its contrast guards and
 * says so: "this list is the whole mechanism, there is no automatic
 * detection."
 */
const DARK_COMPONENTS = [
  ...new Set(
    [...globalsCss.matchAll(/:not\(\.(brand-mark|hero-bg|btn-primary|card-ai)\)/g)].map(
      (m) => m[1],
    ),
  ),
];

const TEXT_CLASS =
  /(?<![\w:-])((?:[a-z0-9-]+(?:\/[a-z0-9-]+)?:)*)text-(\[[^\]]+\]|[a-z0-9]+(?:-[a-z0-9]+)*(?:\/(?:\d+|\[[\d.]+\]))?)(?![\w/[-])/g;
const NOT_A_COLOUR =
  /^(?:xs|sm|base|lg|xl|\d?xl|left|right|center|justify|start|end|balance|pretty|wrap|nowrap|ellipsis|clip|top|bottom|middle|opacity|normalize|only|flow|banner|align)$/;

function runAround(src: string, index: number): string {
  const DELIM = /['"`]/;
  let start = index;
  while (start > 0 && !DELIM.test(src[start - 1])) start -= 1;
  let end = index;
  while (end < src.length && !DELIM.test(src[end])) end += 1;
  return src.slice(start, end);
}

type Occurrence = { rel: string; cls: string; chain: string; name: string; worn: string[] };

const MEASURED: Occurrence[] = [];
const LISTED: { o: Occurrence; why: string }[] = [];

for (const rel of FILES) {
  const src = read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  for (const m of src.matchAll(TEXT_CLASS)) {
    const [chain, name] = [m[1], m[2]];
    if (NOT_A_COLOUR.test(name)) continue;
    if (name.startsWith('[') && !name.startsWith('[#')) continue;
    if (chain.split(':').includes('dark')) continue;
    const run = runAround(src, m.index ?? 0);
    const worn = run.trim().split(/\s+/);
    const o: Occurrence = { rel, cls: `${chain}text-${name}`, chain, name: name.split('/')[0], worn };
    if (['transparent', 'current', 'inherit'].includes(o.name)) continue;
    if (DARK_COMPONENTS.some((c) => worn.includes(c))) {
      LISTED.push({ o, why: 'the element wears a component class that paints its own dark fill' });
      continue;
    }
    if (!/(?<![\w:-])dark:(?:[a-z0-9-]+:)*text-/.test(run)) {
      LISTED.push({ o, why: 'no `dark:` twin, so the source does not say this is the light value' });
      continue;
    }
    MEASURED.push(o);
  }
}

/** The colour `html, body` actually declares for the consumer page. */
const PAGE = (() => {
  for (const r of RULES) {
    if (!r.selectors.includes('html') || !r.selectors.includes('body')) continue;
    const m = /(?:^|[;\s])background-color:\s*(#[0-9a-fA-F]{6})/.exec(r.body);
    if (m) return m[1].toLowerCase();
  }
  return null;
})();

/**
 * The ground an occurrence sits on, from its OWN class list.
 *
 * The variant chain has to match: `file:text-white` is painted on the
 * button `file:bg-forest-900` paints, not on the page, and reading only
 * unprefixed `bg-*` reported white-on-dark as white-on-white. A variant
 * background paints NOTHING at rest, so `dark:bg-gold-600` is not this
 * element's ground either - reading it as one put white text on gold at
 * 2.34:1 in seven files that render no such thing in light mode.
 */
function groundsFor(o: Occurrence): Record<string, string> {
  const own: Record<string, string> = {};
  const want = [o.chain, ''];
  for (const w of o.worn) {
    const m = /^((?:[a-z0-9-]+(?:\/[a-z0-9-]+)?:)*)bg-(.+)$/.exec(w);
    if (!m) continue;
    if (!want.includes(m[1])) continue;
    if (
      /^(gradient|clip|blend|origin|repeat|no-repeat|fixed|local|scroll|center|top|bottom|left|right|cover|contain|auto|none|\[)/.test(
        m[2],
      )
    ) {
      continue;
    }
    const bg = resolve(w, o.worn, 'background-color');
    if (!bg) continue;
    own[w] = composite(bg, PAGE!);
  }
  return Object.keys(own).length ? own : { 'the page': PAGE! };
}

/**
 * Every measured class that is still under the floor, and why it is not
 * being fixed here. Keyed by class so a new call site of a known-bad
 * class is covered, but a NEW bad class is not.
 *
 * Each ratio is what this sweep computes today. The test below asserts
 * the entry is still live AND still below the floor, so a fix retires
 * its own exemption rather than leaving a standing one.
 *
 * None of these is on the public marketing surface, which the rendered
 * audit of 2026-08-10 measured at zero failures. They are in the
 * signed-in consumer app, which that audit could not reach, and none was
 * verified in a browser - which is exactly why they are recorded rather
 * than guessed at.
 */
const KNOWN_BELOW: Record<string, string> = {
  'text-cream-100/70':
    'components/PresenceIndicator.tsx; cream at 70% with a cream `dark:` twin, so the light ground is whatever chip encloses it and only a render can say',
  'text-forest-300':
    "app/share/[token]/human-check.tsx; 2.13:1 if it is on the page, and this sweep cannot see whether the share viewer's panel is behind it",
  'text-forest-400': 'app/share/[token]/human-check.tsx, same panel, 3.89:1',
  'text-forest-900/40':
    'the timeline empty-state icons, 2.33:1 on their own 5% tint; icons rather than words, so the floor that applies is 3:1 and they miss that too',
  'text-forest-900/50': 'the same icons one stop up, 3.01:1',
  'text-white':
    'the timeline day-count badge on bg-gold-600, 2.34:1; white on a mid-gold fill needs the fill to darken or the label to go dark',
  'text-amber-600': 'app/admin/users/trial-controls.tsx, 3.19:1; --warn-text is 6.12:1 and is the token for this',
  'text-amber-700/70': 'app/cases/[id]/timeline/admin-preview-toggle.tsx, 2.95:1',
  'text-amber-700/80': 'the same toggle, 3.54:1',
  'text-amber-900/55': 'components/CallALawyerCallout.tsx, 2.90:1',
  'text-amber-900/65': 'the same callout, 3.68:1',
  'text-rose-600':
    '9 files, 3.85:1 on a bg-rose-500/15 tint; --danger-text is the token, but rose-600 is also used as an icon fill where 3:1 applies',
  'text-rose-900/65': 'components/SafetyAdvisory.tsx, 4.13:1',
  'text-ink-500':
    '156 files, 4.40:1 and only on a bg-ink-100 chip; 4.83:1 on the page itself, and the rendered audit found no instance of it under the floor',
};

/* ------------------------------------------------------------------ */

describe('the consumer light surface', () => {
  it('finds the tree at all, so an empty sweep cannot pass', () => {
    // Floors set just under what the sweep actually reaches. A LOOSE
    // floor is how the counsel sweep went quiet: a broken pathspec cut it
    // to two files, every assertion passed, and nine defects sat behind
    // it. A mutation found that, not a green run.
    expect(FILES.length).toBeGreaterThanOrEqual(330);
    expect(FILES.filter((f) => /^app\/[^/]+\.tsx$/.test(f)).length).toBeGreaterThanOrEqual(3);
    expect(FILES.filter((f) => /^components\/[^/]+\.tsx$/.test(f)).length).toBeGreaterThanOrEqual(
      80,
    );
    expect(MEASURED.length).toBeGreaterThanOrEqual(2200);
    expect(LISTED.length).toBeGreaterThanOrEqual(1400);
    // And the two halves together are the whole sweep, so neither can
    // grow by eating the other unnoticed.
    expect(MEASURED.length + LISTED.length).toBeGreaterThanOrEqual(3700);

    // The stylesheet is reachable, in the bare and the escaped spelling.
    expect(PAGE).toBe('#ffffff');
    expect(repaint('text-ink-400', 'color', [])?.hex).toBe('#6b6b75');
    expect(repaint('hover:text-gold-700', 'color', [])?.hex).toBe('#6a5521');
    expect(repaint('group-hover:text-gold-700', 'color', [])?.hex).toBe('#6a5521');
    expect(Object.keys(FOREST).length).toBeGreaterThanOrEqual(11);
    expect(DARK_COMPONENTS.sort()).toEqual(['brand-mark', 'btn-primary', 'card-ai', 'hero-bg']);
  });

  it('knows what every measured class paints', () => {
    // The arm that keeps this from going quiet: a class the resolver
    // cannot place is a failure, not a skip.
    const unresolved = new Set<string>();
    for (const o of MEASURED) {
      if (!resolve(o.cls, o.worn, 'color')) unresolved.add(`${o.rel}: ${o.cls}`);
    }
    expect(
      [...unresolved],
      'these classes resolve to no colour; add the family to PALETTE rather than letting them fall out of the sweep',
    ).toEqual([]);
  });

  it(`holds every one to ${AA_SMALL_TEXT}:1 on the ground its own class list states`, () => {
    const failures: string[] = [];
    for (const o of MEASURED) {
      if (KNOWN_BELOW[o.cls]) continue;
      const paint = resolve(o.cls, o.worn, 'color');
      if (!paint) continue;
      for (const [where, ground] of Object.entries(groundsFor(o))) {
        const ink = composite(paint, ground);
        const ratio = contrastRatio(ink, ground);
        if (ratio < AA_SMALL_TEXT) {
          failures.push(
            `${o.rel}: \`${o.cls}\` paints ${ink} on ${where} (${ground}) and measures ${ratio.toFixed(3)}:1`,
          );
        }
      }
    }
    expect(failures, [...new Set(failures)].join('\n')).toEqual([]);
  });

  it('keeps the known-below list exact, so it can neither go stale nor grow', () => {
    const live = new Set(MEASURED.map((o) => o.cls));
    for (const [cls, why] of Object.entries(KNOWN_BELOW)) {
      expect(
        live.has(cls),
        `no measured call site paints ${cls} any more; drop it from KNOWN_BELOW rather than leaving a standing exemption: ${why}`,
      ).toBe(true);
      const worst = Math.min(
        ...MEASURED.filter((o) => o.cls === cls).flatMap((o) => {
          const paint = resolve(o.cls, o.worn, 'color');
          if (!paint) return [Infinity];
          return Object.values(groundsFor(o)).map((g) =>
            contrastRatio(composite(paint, g), g),
          );
        }),
      );
      expect(
        worst,
        `${cls} now measures ${worst.toFixed(3)}:1 and clears the floor, so its entry is dead: ${why}`,
      ).toBeLessThan(AA_SMALL_TEXT);
    }
  });

  it('says why every listed occurrence is listed, and nothing else', () => {
    // The buckets are the whole contract: an occurrence is either
    // measured or it is here under one of exactly these two reasons.
    const reasons = new Map<string, number>();
    for (const { why } of LISTED) reasons.set(why, (reasons.get(why) ?? 0) + 1);
    expect([...reasons.keys()].sort()).toEqual([
      'no `dark:` twin, so the source does not say this is the light value',
      'the element wears a component class that paints its own dark fill',
    ]);
    for (const [, n] of reasons) expect(n).toBeGreaterThan(0);
  });
});

describe('the layer that made the consumer light surface legible', () => {
  it('still repaints the two ramps that were failing', () => {
    // Stated as arithmetic so the fix cannot be reverted quietly. These
    // are the raw Tailwind values, and what the light layer puts in
    // their place, against the tightest surface each can land on.
    const surfaces = Object.entries(ACCENT_TEXT_SURFACES.light)
      .filter(([k]) => !k.startsWith('light counsel'))
      .map(([, v]) => v);
    const worst = (hex: string) => Math.min(...surfaces.map((g) => contrastRatio(hex, g)));

    expect(surfaces).toContain('#ffffff');
    expect(surfaces.length).toBeGreaterThanOrEqual(4);

    // As shipped, on the consumer light page.
    expect(worst('#a1a1aa')).toBeLessThan(3); // text-ink-400, measured 2.54:1
    expect(worst('#a38a55')).toBeLessThan(3.5); // text-gold-700, measured 1.81:1
    expect(worst('#d5bb7e')).toBeLessThan(2); // text-gold-500
    expect(worst('#c2a66a')).toBeLessThan(2.5); // text-gold-600
    expect(worst('#059669')).toBeLessThan(AA_SMALL_TEXT); // text-emerald-600
    expect(worst('#6ee7b7')).toBeLessThan(2); // text-emerald-300
    // And what replaced each.
    for (const fixed of ['#6b6b75', '#6a5521', '#047857', '#0369a1']) {
      expect(worst(fixed), `${fixed} no longer clears AA on every consumer light surface`)
        .toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });

  it('keeps the dark half of --ink-quiet on the value the dark block paints', () => {
    /*
     * The one place this layer duplicates a literal. `--ink-quiet` is
     * declared per theme so a `.dark` panel inside a light page reads the
     * dark value by inheritance instead of taking near-black ink on
     * near-black; that dark value has to stay the same colour
     * `.dark .text-ink-400` paints, or the two drift and the panel goes a
     * shade off. Read from the sheet on both sides rather than restated.
     */
    const declaredOn = (selector: string, prop: string) => {
      let found: string | null = null;
      for (const r of RULES) {
        if (!r.selectors.includes(selector)) continue;
        const m = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`).exec(r.body);
        if (m) found = m[1].trim();
      }
      return found;
    };
    const fromDarkBlock = declaredOn('.dark .text-ink-400', 'color');
    const fromToken = declaredOn('.dark', '--ink-quiet');
    expect(fromDarkBlock, 'the dark per-class block no longer paints .text-ink-400').not.toBeNull();
    expect(fromToken, '.dark no longer declares --ink-quiet').not.toBeNull();
    expect(fromToken).toBe(fromDarkBlock);
  });

  it('holds every gradient that paints TEXT to the floor, at every stop', () => {
    /*
     * GRADIENT GROUNDS, AND GRADIENT INK.
     *
     * `bg-<key> bg-clip-text` makes the gradient the ink, so `color` is
     * `transparent` and says nothing - no class sweep can see these at
     * all. The contrast question has to be asked of every STOP, because
     * every stop is part of a letter.
     *
     * The stops are read out of the config, and only keys that a consumer
     * call site actually pairs with `bg-clip-text` are held to the floor:
     * `gold-metal` and `forest-gradient` are fills behind other people's
     * words, and their contrast is a question about what is written ON
     * them, which is a different test.
     */
    const images = (tailwindConfig.theme?.extend?.backgroundImage ?? {}) as Record<string, string>;
    expect(Object.keys(images).length).toBeGreaterThanOrEqual(4);

    const clipped = new Set<string>();
    for (const rel of FILES) {
      const src = read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      for (const m of src.matchAll(/class(?:Name)?=\{?["'`]([^"'`]*)["'`]/g)) {
        const worn = m[1].trim().split(/\s+/);
        if (!worn.includes('bg-clip-text')) continue;
        for (const w of worn) {
          const key = /^bg-([a-z-]+)$/.exec(w)?.[1];
          if (key && key in images) clipped.add(key);
        }
      }
    }
    // The sweep has to actually find them, or this passes on nothing.
    expect([...clipped].sort()).toContain('gold-shine-ink');

    const surfaces = Object.entries(ACCENT_TEXT_SURFACES.light)
      .filter(([k]) => !k.startsWith('light counsel'))
      .map(([, v]) => v);
    const failures: string[] = [];
    for (const key of clipped) {
      // A key paired with `dark:` at every call site paints only on the
      // dark ground, which this file does not judge. `gold-shine` is that
      // case; it is reached here only as the dark half of a pair.
      if (key === 'gold-shine') continue;
      const stops = [...images[key].matchAll(/#[0-9a-fA-F]{6}/g)].map((s) => s[0].toLowerCase());
      expect(stops.length, `${key} declares no literal colour stops`).toBeGreaterThanOrEqual(2);
      for (const stop of stops) {
        for (const g of surfaces) {
          const ratio = contrastRatio(stop, g);
          if (ratio < AA_SMALL_TEXT) {
            failures.push(`bg-${key} stop ${stop} measures ${ratio.toFixed(3)}:1 on ${g}`);
          }
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
