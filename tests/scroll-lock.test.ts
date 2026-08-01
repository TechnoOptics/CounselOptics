import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { lockScroll } from '../lib/scroll-lock';

/**
 * The page behind an open dialog kept scrolling on a real wheel or touch
 * gesture. Every overlay in the app locked `document.body` only, and
 * app/globals.css puts `overflow-x: clip` on BOTH `html` and `body`: per
 * the CSS overflow spec the body's overflow only propagates to the
 * viewport when the root element's overflow is `visible`, so a body-only
 * lock did nothing at all. Diagnosed for the counsel nav drawer in
 * 8253a33 and swept across the rest of the app here.
 *
 * lockScroll touches only document.body, document.documentElement and
 * window.innerWidth, so a couple of plain objects stand in for the DOM
 * and these stay in the fast node-environment suite.
 */

type StyleStub = { overflow: string; paddingRight: string };

const originals = {
  document: (globalThis as Record<string, unknown>).document,
  window: (globalThis as Record<string, unknown>).window,
};

function fakeDom({ scrollbar = 0 }: { scrollbar?: number } = {}) {
  const body = { style: { overflow: '', paddingRight: '' } as StyleStub };
  // The stylesheet's `overflow-x: clip` is a computed value, not an inline
  // one, so the inline overflow starts empty - which is exactly what the
  // cleanup has to restore for the clip to come back.
  const root = {
    style: { overflow: '', paddingRight: '' } as StyleStub,
    clientWidth: 1024 - scrollbar,
  };
  (globalThis as Record<string, unknown>).document = { body, documentElement: root };
  (globalThis as Record<string, unknown>).window = { innerWidth: 1024 };
  return { body, root };
}

afterEach(() => {
  (globalThis as Record<string, unknown>).document = originals.document;
  (globalThis as Record<string, unknown>).window = originals.window;
});

describe('lockScroll holds the page still behind an overlay', () => {
  it('sets overflow on the root element, not just the body', () => {
    const { body, root } = fakeDom();
    lockScroll();
    expect(body.style.overflow).toBe('hidden');
    // The one that was missing everywhere. Without it the body-only lock
    // never reaches the viewport and the page scrolls under the dialog.
    expect(root.style.overflow).toBe('hidden');
  });

  it('restores the previous inline values, not a hard-coded one', () => {
    const { body, root } = fakeDom();
    const unlock = lockScroll();
    unlock();
    // Empty, so the stylesheet's `overflow-x: clip` governs again. Writing
    // back a literal `visible`/`auto` would permanently defeat it and let
    // horizontal scroll back in on mobile.
    expect(body.style.overflow).toBe('');
    expect(root.style.overflow).toBe('');
  });

  it('nests: an inner overlay closing leaves the outer lock intact', () => {
    const { body, root } = fakeDom();
    const unlockOuter = lockScroll();
    const unlockInner = lockScroll();
    unlockInner();
    expect(body.style.overflow).toBe('hidden');
    expect(root.style.overflow).toBe('hidden');
    unlockOuter();
    expect(body.style.overflow).toBe('');
    expect(root.style.overflow).toBe('');
  });

  it('compensates for the scrollbar it removes, and undoes that', () => {
    const { body } = fakeDom({ scrollbar: 15 });
    const unlock = lockScroll();
    expect(body.style.paddingRight).toBe('15px');
    unlock();
    expect(body.style.paddingRight).toBe('');
  });

  it('leaves padding alone when there is no scrollbar to replace', () => {
    const { body } = fakeDom({ scrollbar: 0 });
    lockScroll();
    expect(body.style.paddingRight).toBe('');
  });
});

describe('no overlay goes back to locking the body on its own', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('routes every scroll lock through lib/scroll-lock.ts', () => {
    const root = join(__dirname, '..');
    const offenders = ['app', 'components', 'lib']
      .flatMap((d) => walk(join(root, d)))
      .filter((f) => f !== join(root, 'lib', 'scroll-lock.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('body.style.overflow'))
      .map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });
});
