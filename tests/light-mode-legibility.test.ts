import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import defaultColors from 'tailwindcss/colors';
import tailwindConfig from '../tailwind.config';
import {
  AA_SMALL_TEXT,
  LIGHT_SURFACE_GROUPS,
  contrastRatio,
} from '../lib/accent-text';
import {
  htmlSurfaceClass,
  shellForcesDark,
  shellOwnsHtmlTheme,
} from '../lib/counsel-theme-values';

/**
 * LIGHT MODE, WHERE THE WORDS AND THE SURFACE ARE THE SAME COLOUR.
 *
 * WHAT THIS GUARDS THAT THE OTHER SWEEPS DO NOT.
 * tests/accent-text.test.ts proves the DERIVED tokens on every surface,
 * and holds three shared primitive files to the floor. It cannot see the
 * two things that actually shipped:
 *
 *   1. A palette class written at a counsel or portal call site that the
 *      light counsel repaint layer never named. Those keep their raw
 *      Tailwind value, which is authored for a near-black ground.
 *      `text-ink-400` was 2.21:1 on the light counsel chip across 89 call
 *      sites and `text-gold-300` was 1.34:1.
 *   2. `<html>` carrying `.dark` while the shell under it is painted
 *      light. Nothing in a stylesheet can be measured against that,
 *      because the failure is which RULES apply rather than which values
 *      they carry: every `--surface` token inherits down, the whole
 *      `.dark .text-ink-*` block keeps matching, and 1152 `dark:`
 *      utilities at call sites fire. Rendered, the section subtitle
 *      measured 1.05:1 and a button label 1.03:1.
 *
 * Both lists are read out of the repo rather than written here. The file
 * list is `git ls-files`, the classes are whatever those files contain,
 * the colours are whatever app/globals.css declares, and the shell
 * routes are whichever files actually render a shell. A new counsel page
 * is swept the day it is added; a new always-dark shell has to be
 * declared before it can ship.
 */

const root = new URL('..', import.meta.url);
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');
const globalsCss = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every tracked file under `dirs` with one of `extensions`.
 *
 * DIRECTORIES, not globs, and that is the whole point. `git ls-files
 * 'components/counsel/**' + '/*.tsx'` matches only files in a SUBdirectory:
 * git's `**` wants a path component on each side, so the 47 files sitting
 * directly in components/counsel were silently skipped and this sweep
 * measured two of them. It reported green the whole time. A directory
 * pathspec matches everything beneath it, and the extension filter is
 * done here where it cannot mean two things.
 */
function tracked(dirs: string[], extensions = ['.tsx']): string[] {
  return execFileSync('git', ['ls-files', '--', ...dirs], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
    maxBuffer: 1 << 24,
  })
    .split('\n')
    .filter((f) => f && extensions.some((ext) => f.endsWith(ext)));
}

type Paint = { hex: string; alpha: number };

function parseColour(value: string): Paint | null {
  const v = value.trim();
  const hex = /^#([0-9a-fA-F]{6})$/.exec(v);
  if (hex) return { hex: `#${hex[1].toLowerCase()}`, alpha: 1 };
  const rgba =
    /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(v);
  if (!rgba) return null;
  const to2 = (n: string) => Number(n).toString(16).padStart(2, '0');
  return {
    hex: `#${to2(rgba[1])}${to2(rgba[2])}${to2(rgba[3])}`,
    alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}

type Rule = { selectors: string[]; body: string };
const RULES: Rule[] = [...globalsCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1].split(',').map((s) => s.trim()),
  body: m[2],
}));

const LIGHT_SHELL = '.counsel-shell:not(.dark)';

/** The last value a custom property gets on a light counsel shell. */
function varValue(name: string): Paint | null {
  let found: Paint | null = null;
  for (const rule of RULES) {
    if (!rule.selectors.some((s) => s === LIGHT_SHELL || s === ':root')) continue;
    const m = new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+);`).exec(rule.body);
    if (m) found = parseColour(m[1]) ?? found;
  }
  return found;
}

/**
 * A declared value, following one level of `var(--token)`.
 *
 * The light layer points the status stops at the tokens rather than at a
 * fifth copy of their hexes, so a resolver that stopped at the literal
 * would read those rules as "unknown" and quietly stop measuring the
 * ninety call sites they cover.
 */
function declaredColour(value: string): Paint | null {
  const direct = parseColour(value);
  if (direct) return direct;
  const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value.trim());
  return ref ? varValue(ref[1]) : null;
}

/* ------------------------------------------------------------------ */
/* Part A: what a counsel or portal call site paints on a light ground */
/* ------------------------------------------------------------------ */

describe('every text colour counsel and the portal paint is legible on the light shell', () => {
  const FILES = tracked(['app/counsel', 'app/portal', 'components/counsel']);

  /**
   * The raw value of every palette utility, read from the real config
   * and from Tailwind's own defaults rather than restated here.
   *
   * A hand-kept table is the thing this whole file exists to stop: it
   * would be right on the day it was written and quietly wrong the first
   * time somebody retunes a stop, and a class it did not know would fall
   * through to "unresolvable" instead of being measured. `forest-*` is
   * absent on purpose - it compiles to `rgb(var(--forest-900) / <alpha>)`
   * and is resolved from the shell's own channel remap further down.
   */
  const PALETTE: Record<string, string> = {};
  {
    const flatten = (family: string, value: unknown) => {
      if (typeof value === 'string') {
        const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
        if (m) {
          const digits = m[1];
          PALETTE[family] = `#${
            digits.length === 3
              ? digits
                  .split('')
                  .map((c) => c + c)
                  .join('')
              : digits
          }`.toLowerCase();
        }
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
    // The default palette the config extends rather than replaces, which
    // is where every rose / amber / emerald / sky status colour comes from.
    for (const [family, value] of Object.entries(
      defaultColors as unknown as Record<string, unknown>,
    )) {
      // The v2 aliases warn on ACCESS, and are the same values twice.
      if (['lightBlue', 'warmGray', 'trueGray', 'coolGray', 'blueGray'].includes(family)) continue;
      if (family in PALETTE || family === 'forest') continue;
      flatten(family, value);
    }
  }

  /** Neutral and semantic tokens, and the custom property each reads. */
  const TOKEN_VAR: Record<string, string> = {
    muted: '--muted', foreground: '--foreground', background: '--background',
    surface: '--surface', 'surface-2': '--surface-2',
    'accent-text': '--accent-text', 'accent-on': '--accent-on',
    'warn-text': '--warn-text', 'danger-text': '--danger-text',
    'info-text': '--info-text', 'code-fg': '--code-fg',
  };

  /**
   * Colours these files paint that this sweep does not measure, and
   * which proof covers each instead. Registered rather than skipped: an
   * unknown colour is a FAILURE below, so a new family has to be named
   * here or added to PALETTE before it can ship.
   */
  const ELSEWHERE: Record<string, string> = {
    'accent-text':
      'the per-firm derived accent, proved on every surface for every customer hex by tests/accent-text.test.ts',
    'danger-text':
      'a status token, proved on both grounds by tests/accent-text.test.ts',
    'warn-text':
      'a status token, proved on both grounds by tests/accent-text.test.ts',
    'info-text':
      'a status token, proved on both grounds by tests/accent-text.test.ts',
    transparent: 'paints nothing; the ground shows through by definition',
    current: 'inherits, so it is whatever the parent was already held to',
    inherit: 'inherits, so it is whatever the parent was already held to',
  };

  /**
   * Left below the floor on purpose, keyed by file AND class so an
   * exemption cannot quietly cover the next call site in the same file.
   */
  const ALLOWED = new Map<string, string>();

  /** Class fragments that are type or layout rather than colour. */
  const NOT_A_COLOUR =
    /^(?:xs|sm|base|lg|xl|\d?xl|left|right|center|justify|start|end|balance|pretty|wrap|nowrap|ellipsis|clip|top|bottom|middle|opacity|normalize|only|flow)$/;

  /**
   * The last value the light counsel layer gives `prop` for `.<cls>`.
   *
   * A variant class is escaped twice over and both escapes have to be
   * reproduced, which is the miss that once made every `hover:` spelling
   * resolve to its raw value. `:not(.x)` clauses are honoured against
   * the other classes on the same element, because this layer uses them
   * to exempt the fills it deliberately leaves dark.
   */
  function repaint(cls: string, prop: string, worn: string[]): Paint | null {
    const escaped = cls.replace(/([:/])/g, '\\$1');
    let found: Paint | null = null;
    for (const rule of RULES) {
      const hit = rule.selectors.some((sel) => {
        // The class need not be the second compound. A `group-hover:`
        // utility is repainted through `<shell> .group:hover .<class>`,
        // and matching only `<shell> .<class>` read those rules as absent
        // and reported four already-fixed labels as invisible.
        if (!sel.startsWith(`${LIGHT_SHELL} `)) return false;
        const at = sel.indexOf(` .${escaped}`);
        if (at === -1) return false;
        const after = sel.slice(at + escaped.length + 2);
        if (/^[\w\\/-]/.test(after)) return false;
        for (const n of after.matchAll(/:not\(\.([^)]+)\)/g)) {
          if (worn.includes(n[1].replace(/\\/g, ''))) return false;
        }
        return true;
      });
      if (!hit) continue;
      const wanted = new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`).exec(rule.body);
      if (wanted) found = declaredColour(wanted[1]) ?? found;
    }
    return found;
  }

  /** The forest ramp as the counsel shell remaps it. */
  const FOREST: Record<string, string> = {};
  for (const rule of RULES) {
    if (!rule.selectors.includes('.counsel-shell')) continue;
    for (const m of rule.body.matchAll(/--forest-(\d+):\s*([\d\s]+);/g)) {
      FOREST[`forest-${m[1]}`] =
        '#' +
        m[2]
          .trim()
          .split(/\s+/)
          .map((v) => Number(v).toString(16).padStart(2, '0'))
          .join('');
    }
  }

  /** What a utility paints on a light counsel shell, or null if unknown. */
  function resolve(cls: string, prop: 'color' | 'background-color', worn: string[]): Paint | null {
    const bare = cls.replace(/^(?:[a-z0-9-]+:)*/, '');
    const body = bare.replace(/^(?:text|bg)-/, '');
    const arbitrary = /^\[(#[0-9a-fA-F]{6})\]$/.exec(body);
    if (arbitrary) return { hex: arbitrary[1].toLowerCase(), alpha: 1 };
    const [name, alphaPart] = body.split('/');
    const alpha = alphaPart ? Number(alphaPart) / 100 : 1;
    const rule = repaint(cls, prop, worn);
    if (rule) return rule;
    if (TOKEN_VAR[name]) {
      const v = varValue(TOKEN_VAR[name]);
      return v && { ...v, alpha: v.alpha * alpha };
    }
    if (FOREST[name]) return { hex: FOREST[name], alpha };
    if (PALETTE[name]) return { hex: PALETTE[name], alpha };
    return null;
  }

  const composite = (paint: Paint, ground: string): string => {
    if (paint.alpha >= 1) return paint.hex;
    const ch = (h: string) => {
      const n = parseInt(h.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const f = ch(paint.hex);
    const g = ch(ground);
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

  // The variant chain may carry a NAMED group (`group-hover/row:`). A
  // chain pattern without the slash split that in half and reported the
  // class as `row:text-gold-700`, a spelling no stylesheet can ever
  // repaint, so the guard demanded a fix for a class that does not exist.
  const TEXT_CLASS =
    /(?<![\w:-])((?:[a-z0-9-]+(?:\/[a-z0-9-]+)?:)*)text-(\[[^\]]+\]|[a-z0-9]+(?:-[a-z0-9]+)*(?:\/\d+)?)(?![\w/[-])/g;
  const BG_CLASS =
    /(?<![\w:-])bg-([a-z0-9]+(?:-[a-z0-9]+)*(?:\/\d+)?)(?![\w/[-])/g;

  /** The quoted run a match sits in: one element's class list. */
  function runAround(src: string, index: number): [number, string] {
    const DELIM = /['"`]/;
    let start = index;
    while (start > 0 && !DELIM.test(src[start - 1])) start -= 1;
    let end = index;
    while (end < src.length && !DELIM.test(src[end])) end += 1;
    return [start, src.slice(start, end)];
  }

  type Occurrence = {
    rel: string;
    cls: string;
    name: string;
    chain: string;
    run: string;
    worn: string[];
  };

  const OCCURRENCES: Occurrence[] = [];
  for (const rel of FILES) {
    const src = read(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '');
    const seen = new Set<string>();
    for (const m of src.matchAll(TEXT_CLASS)) {
      const [chain, name] = [m[1], m[2]];
      if (NOT_A_COLOUR.test(name)) continue;
      if (name.startsWith('[') && !name.startsWith('[#')) continue;
      // A `dark:` spelling paints only under the dark shell, which the
      // dark half of tests/accent-text.test.ts already covers.
      if (chain.split(':').includes('dark')) continue;
      const [start, run] = runAround(src, m.index ?? 0);
      const cls = `${chain}text-${name}`;
      const key = `${start}|${cls}`;
      if (seen.has(key)) continue;
      seen.add(key);
      OCCURRENCES.push({
        rel,
        cls,
        chain,
        name: name.split('/')[0],
        run,
        worn: run.trim().split(/\s+/),
      });
    }
  }

  it('finds the surfaces at all, so an empty sweep cannot pass', () => {
    /*
     * The floors are set just under what the sweep actually reaches, not
     * at a comfortable round number, because a LOOSE floor is how this
     * went quiet once already: `git ls-files 'components/counsel/(star)(star)/(star).tsx'`
     * matched two files instead of forty-nine (git wants a path component
     * on each side of a `**`), the sweep measured 2 of them, every
     * assertion passed, and nine real defects sat behind it. A mutation
     * found that, not a green run.
     *
     * Per tree as well as in total: a tree that stops matching cannot
     * hide behind another tree growing.
     */
    expect(FILES.length).toBeGreaterThanOrEqual(240);
    const perTree: Record<string, number> = {
      'app/counsel/': 0,
      'app/portal/': 0,
      'components/counsel/': 0,
    };
    for (const o of OCCURRENCES) {
      for (const tree of Object.keys(perTree)) {
        if (o.rel.startsWith(tree)) perTree[tree] += 1;
      }
    }
    // components/counsel is the one that was skipped, and its floor is
    // the count of files sitting DIRECTLY in it rather than in a
    // subdirectory, which is exactly what the broken pathspec dropped.
    expect(perTree['components/counsel/']).toBeGreaterThanOrEqual(400);
    expect(perTree['app/counsel/']).toBeGreaterThanOrEqual(1500);
    expect(perTree['app/portal/']).toBeGreaterThanOrEqual(80);
    expect(
      FILES.filter((f) => /^components\/counsel\/[^/]+\.tsx$/.test(f)).length,
      'the sweep is back to seeing only the files in subdirectories of components/counsel',
    ).toBeGreaterThanOrEqual(40);
    // The light layer is reachable, in both the bare and variant escapes.
    expect(repaint('text-forest-900', 'color', [])?.hex).toBe('#17171b');
    expect(repaint('hover:text-cream-100', 'color', [])?.hex).toBe('#17171b');
    expect(varValue('--muted')?.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(Object.keys(FOREST).length).toBeGreaterThanOrEqual(11);
  });

  it('knows the paint behind every text colour it swept', () => {
    // The arm that keeps this from going quiet. A class the resolver
    // cannot place is a failure, not a skip.
    for (const o of OCCURRENCES) {
      if (ELSEWHERE[o.name]) continue;
      expect(
        resolve(o.cls, 'color', o.worn),
        `${o.rel} paints \`${o.cls}\`, which this guard cannot resolve; add it to PALETTE or name the proof that covers it in ELSEWHERE`,
      ).not.toBeNull();
    }
  });

  it(`holds every one to ${AA_SMALL_TEXT}:1 on the ground it sits on`, () => {
    const SHELL_GROUNDS = LIGHT_SURFACE_GROUPS.counselLight.surfaces as Record<
      string,
      string
    >;
    const failures: string[] = [];
    for (const o of OCCURRENCES) {
      if (ELSEWHERE[o.name]) continue;
      if (ALLOWED.has(`${o.rel}|${o.cls}`)) continue;
      const paint = resolve(o.cls, 'color', o.worn);
      if (!paint) continue;
      // The element's own fill when it paints one, because that is what
      // is behind the words. A TRANSLUCENT fill is composited over each
      // shell surface rather than discarded: `bg-black/60` on a white
      // card is a dark chip, and throwing it away reported every
      // `text-white` label on one as invisible.
      const own: Record<string, string> = {};
      for (const m of o.run.matchAll(BG_CLASS)) {
        const bg = resolve(`bg-${m[1]}`, 'background-color', o.worn);
        if (!bg) continue;
        if (bg.alpha >= 0.999) {
          own[`bg-${m[1]}`] = bg.hex;
          continue;
        }
        for (const [surface, hex] of Object.entries(SHELL_GROUNDS)) {
          own[`bg-${m[1]} over ${surface}`] = composite(bg, hex);
        }
      }
      const grounds = Object.keys(own).length ? own : SHELL_GROUNDS;
      for (const [where, ground] of Object.entries(grounds)) {
        const ratio = contrastRatio(composite(paint, ground), ground);
        if (ratio < AA_SMALL_TEXT) {
          failures.push(
            `${o.rel}: \`${o.cls}\` paints ${composite(paint, ground)} on ${where} (${ground}) and measures ${ratio.toFixed(3)}:1`,
          );
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('the exemption list stays honest', () => {
    for (const [key, why] of ALLOWED) {
      const [rel, cls] = key.split('|');
      expect(
        OCCURRENCES.some((o) => o.rel === rel && o.cls === cls),
        `${rel} no longer paints ${cls}, so its exemption is dead and would silently cover the next one: ${why}`,
      ).toBe(true);
    }
    for (const name of Object.keys(ELSEWHERE)) {
      if (['transparent', 'current', 'inherit'].includes(name)) continue;
      expect(
        OCCURRENCES.some((o) => o.name === name),
        `no swept file paints text-${name} any more; drop it from ELSEWHERE rather than leaving a standing exemption`,
      ).toBe(true);
    }
  });

  it('states the regressions this guard exists for, as arithmetic', () => {
    const grounds = Object.values(LIGHT_SURFACE_GROUPS.counselLight.surfaces);
    const worst = (hex: string) =>
      Math.min(...grounds.map((g) => contrastRatio(hex, g)));
    // As shipped: the raw Tailwind values on a near-white workspace.
    expect(worst('#71717a')).toBeLessThan(AA_SMALL_TEXT); // text-ink-500
    expect(worst('#a1a1aa')).toBeLessThan(3); // text-ink-400
    expect(worst('#e5ce93')).toBeLessThan(1.5); // text-gold-300
    expect(worst('#efe0b7')).toBeLessThan(1.2); // text-gold-200
    // And what the light layer puts in their place.
    for (const fixed of ['#17171b', '#2e2e35', '#45454e', '#5d5d68', '#6b6b75', '#6a5521']) {
      expect(worst(fixed)).toBeGreaterThanOrEqual(AA_SMALL_TEXT);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Part B: <html> says what the shell under it is actually painting    */
/* ------------------------------------------------------------------ */

describe('<html> carries the theme and the canvas of the shell it wraps', () => {
  /**
   * Every route file that renders a shell, found rather than listed.
   *
   * A shell root is a `page.tsx` or `layout.tsx` under app/ that names
   * one of the shell classes. Components are excluded on purpose: a
   * portalled overlay and a marketing MOCK both wear `counsel-shell`
   * without being a route, and neither reaches `<html>`.
   */
  const SHELL_ROUTES = tracked(['app'])
    .filter((rel) => /\/(page|layout)\.tsx$/.test(rel))
    .map((rel) => ({ rel, src: read(rel) }))
    .filter((f) => /counselShellClass|counsel-shell|hq-shell/.test(f.src))
    .map((f) => ({
      ...f,
      family: /hq-shell/.test(f.src) ? ('hq' as const) : ('counsel' as const),
      route:
        '/' +
        f.rel
          .replace(/^app\//, '')
          .replace(/\/(page|layout)\.tsx$/, '')
          .replace(/\/\([^/]+\)/g, '')
          .replace(/\/$/, ''),
    }));

  it('finds the shell routes at all, so an empty sweep cannot pass', () => {
    expect(SHELL_ROUTES.length).toBeGreaterThanOrEqual(9);
    expect(SHELL_ROUTES.map((r) => r.route)).toContain('/counsel');
    expect(SHELL_ROUTES.map((r) => r.route)).toContain('/portal');
    expect(SHELL_ROUTES.some((r) => r.family === 'hq')).toBe(true);
  });

  it('gives every shell route an <html> theme and canvas of its own', () => {
    for (const { rel, route, family } of SHELL_ROUTES) {
      if (family === 'hq') {
        expect(
          htmlSurfaceClass(route),
          `${rel} renders the HQ shell at ${route}, so <html> has to paint the HQ canvas behind it`,
        ).toBe('surface-hq');
        continue;
      }
      expect(
        shellOwnsHtmlTheme(route),
        `${rel} renders a counsel shell at ${route}, but <html> would still take the reader's CONSUMER theme there. That is the defect this guards: a light shell under html.dark inherits every dark token, keeps matching the whole \`.dark .text-ink-*\` block, and fires every \`dark:\` utility at the call sites, which measured 1.03:1 on a button label`,
      ).toBe(true);
      expect(
        htmlSurfaceClass(route),
        `${rel} renders a counsel shell at ${route}, so <html> has to paint the counsel canvas behind it or a drag past the end of the page shows the consumer ground`,
      ).toBe('surface-counsel');
    }
  });

  it('says so when a shell hard-codes its theme instead of reading the cookie', () => {
    // A route that renders `dark counsel-shell` as a literal is dark
    // whatever the cookie says. If shellForcesDark disagrees, <html> ends
    // up a shade away from the page on exactly the pre-auth screens an
    // outside firm sees first.
    for (const { rel, route, src, family } of SHELL_ROUTES) {
      if (family === 'hq') continue;
      const literalDark = /['"`]dark counsel-shell/.test(src);
      const readsCookie = /counselShellClass/.test(src);
      if (!literalDark || readsCookie) continue;
      expect(
        shellForcesDark(route),
        `${rel} renders a literal \`dark counsel-shell\` at ${route}, so shellForcesDark has to say so; otherwise <html> follows a cookie the page ignores`,
      ).toBe(true);
    }
  });

  it('leaves every other route to the reader', () => {
    for (const route of ['/', '/about', '/cases', '/features', '/enterprise', '/sign/abc']) {
      expect(shellOwnsHtmlTheme(route)).toBe(false);
      expect(htmlSurfaceClass(route)).toBeNull();
    }
  });

  it('wires the decision through the boot script and the canvas rules', () => {
    // The three places the answer has to actually land. Each has been
    // seen to exist while doing nothing, so each is checked for the
    // mechanism rather than for the mention.
    const boot = read('components/ThemeBoot.tsx');
    expect(
      boot,
      'ThemeBoot no longer prefers the surface theme, so the first painted frame goes back to the consumer answer',
    ).toMatch(/classList\.toggle\(\s*'dark',\s*surface\s*\?/);

    const sync = read('components/SurfaceThemeSync.tsx');
    expect(
      sync,
      'SurfaceThemeSync no longer re-decides on the path, so the answer goes stale on the first client-side navigation',
    ).toMatch(/usePathname/);

    for (const selector of [
      'html.surface-counsel',
      'html.surface-counsel.dark',
      'html.surface-hq',
    ]) {
      expect(
        globalsCss.includes(`${selector},`) || globalsCss.includes(`${selector} `),
        `app/globals.css declares no canvas for \`${selector}\`, so the area past the end of the page falls back to the consumer ground`,
      ).toBe(true);
    }
  });

  it('keeps the canvas on the same colours the shells paint', () => {
    // The canvas is only right while it agrees with the shell. These four
    // are read out of the stylesheet on both sides rather than restated.
    const declared = (selector: string) => {
      let found: string | null = null;
      for (const rule of RULES) {
        if (!rule.selectors.includes(selector)) continue;
        const m = /(?:^|[;\s])background-color:\s*(#[0-9a-fA-F]{6})/.exec(rule.body);
        if (m) found = m[1].toLowerCase();
      }
      return found;
    };
    for (const [canvas, shell] of [
      ['html.surface-counsel.dark', '.dark.counsel-shell'],
      ['html.surface-counsel', '.counsel-shell:not(.dark)'],
      ['html.surface-hq', '.hq-shell'],
    ]) {
      const behind = declared(canvas);
      expect(behind, `no canvas declared for \`${canvas}\``).not.toBeNull();
      expect(
        behind,
        `the canvas on \`${canvas}\` and the fill on \`${shell}\` have drifted apart, so the strip past the end of the page is a different colour from the page`,
      ).toBe(declared(shell));
    }
  });
});
