import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

/*
 * `window.confirm()` must not appear in any rendered surface.
 *
 * This is a correctness guard, not a style guard. Advottic ships as a
 * Capacitor WebView as well as a web page, and the WebView suppresses the
 * native confirm dialog. A suppressed `confirm()` does not throw and does not
 * log: it returns, and the branch runs. So `if (!confirm(...)) return;`
 * either drops the guard entirely or makes the button do nothing, and which
 * one you get depends on the engine. On the phone, nobody is ever asked the
 * question. Two files in this repo already said so in prose (the webhook
 * manager and the token revoke button) while eleven other call sites carried
 * on using it, which is exactly why the rule needs a test and not a comment.
 *
 * WHAT THIS CANNOT TELL YOU: that the replacement dialogs are reachable, or
 * that their copy is right. It only proves the broken mechanism is gone.
 *
 * Comments are stripped before matching. Without that, this file's own
 * subject matter would satisfy it: several of the converted call sites carry a
 * comment naming `window.confirm()` as the thing they replaced, and a guard a
 * comment can satisfy is not a guard.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const SCANNED = ['app', 'components'];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Remove block comments, then line comments. The line-comment rule requires a
 * line start or whitespace before the slashes so a `https://` inside a string
 * survives; a `//` after a colon is never a comment in this codebase.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/gm, '$1');
}

/*
 * Anchored on the CALL, with its opening paren, in each form that reaches the
 * native dialog: `window.confirm(`, `globalThis.confirm(`, `self.confirm(`,
 * and a bare `confirm(` that is not a property access and not a declaration of
 * something else called confirm (lib/courtlistener.ts has a local helper by
 * that name, which is why the bare form has to exclude declarations rather
 * than just banning the word).
 */
const CALL_FORMS = [
  /\b(?:window|globalThis|self)\s*\.\s*confirm\s*\(/,
  /(?<![.\w$]|function\s|const\s|let\s|var\s)confirm\s*\(/,
];

const files = SCANNED.flatMap((d) => walk(join(root, d)));

describe('no native confirm() in any rendered surface', () => {
  it('scans a real, non-empty set of files', () => {
    // Guards the guard: a walk that silently returns nothing would pass every
    // assertion below while proving nothing at all.
    expect(files.length).toBeGreaterThan(300);
  });

  it('finds no window.confirm() call anywhere in app/ or components/', () => {
    const hits: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const form of CALL_FORMS) {
        const m = code.match(form);
        if (m) {
          hits.push(`${relative(root, file)}: ${m[0].trim()}`);
          break;
        }
      }
    }
    expect(
      hits,
      'These reach the native confirm dialog, which the Capacitor WebView suppresses. Use components/ConfirmDialog.tsx, or the inline two-step confirm used by the webhook manager.',
    ).toEqual([]);
  });

  it('the replacement dialog is built on the shared Dialog, not a third overlay', () => {
    // The brief for this work was to use one of the two patterns this repo
    // already has. If ConfirmDialog ever grows its own `fixed inset-0`, it has
    // become the third, and it loses the scroll lock, the ESC key and the
    // visual-viewport tracking that Dialog carries.
    const src = stripComments(
      readFileSync(join(root, 'components/ConfirmDialog.tsx'), 'utf8'),
    );
    expect(src).toMatch(/import\s*\{\s*Dialog\s*\}\s*from\s*'@\/components\/Dialog'/);
    expect(src).toMatch(/<Dialog\b/);
    expect(src).not.toMatch(/fixed\s+inset-0/);
  });

  it('every converted call site actually renders a ConfirmDialog', () => {
    // The failure mode this catches is a "fix" that deletes the confirm and
    // stops there, leaving the destructive control ungated. Anchored on the
    // JSX element, so a bare import would not satisfy it.
    const sites = [
      'app/counsel/cases/[id]/evidence/evidence-intake.tsx',
      'app/counsel/cases/[id]/evidence/recurring-people.tsx',
      'app/counsel/cases/[id]/evidence/bulk-reanalyze.tsx',
      'app/counsel/cases/[id]/approach-builder.tsx',
      'app/counsel/team/member-row.tsx',
      'app/admin/invitations/grant-actions.tsx',
      'app/cases/[id]/timeline/timeline-builder.tsx',
      'app/cases/[id]/timeline/minimal-timeline.tsx',
    ];
    for (const site of sites) {
      const src = stripComments(readFileSync(join(root, site), 'utf8'));
      expect(src, `${site} should render <ConfirmDialog`).toMatch(/<ConfirmDialog\b/);
    }
  });
});
