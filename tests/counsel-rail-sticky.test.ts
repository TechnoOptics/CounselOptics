import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The counsel rail is a `position: sticky` panel, and the two things that
 * silently break such a panel are both invisible to every other test in this
 * suite: neither one throws, neither one changes any rendered string, and
 * both look completely fine until somebody scrolls.
 *
 * 1. THE CONTAINING BLOCK. A sticky box may never be painted outside its
 *    containing block. The rail's containing block is the flex row inside
 *    <SidebarCollapseProvider>. While the shell's <footer> was a SIBLING that
 *    followed that row, the row stopped one footer-height above the bottom of
 *    the document, so the last stretch of every counsel page dragged the whole
 *    rail upwards by exactly that much - its top slid under the sticky header,
 *    taking the firm name and the collapse control with it, and an equal band
 *    of dead space opened at its foot. Measured in a real browser with real
 *    wheel events: -54px at 1280x900 and -54px at 1280x620. Keeping the footer
 *    INSIDE the row is the whole fix, and moving it back out is a one-line
 *    edit that reintroduces the bug with no other symptom.
 *
 * 2. THE HEADER MEASUREMENT. SidebarFocus sizes and offsets the rail from the
 *    header's measured height via `.counsel-shell > header`. That is a DIRECT
 *    CHILD selector, so it depends on CounselHeader returning a bare <header>
 *    as its root. Wrap that root in anything and the query returns null, the
 *    effect gives up, the offset silently keeps its 64px placeholder against a
 *    real header of ~54px, and the rail sits ten pixels low forever.
 *
 * These are source-shape assertions on purpose. The behaviour they protect
 * only exists in a layout engine, so there is nothing to import and call; what
 * CAN be pinned is the structure the layout engine is being handed.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

describe('the counsel rail keeps its sticky containing block', () => {
  const layout = read('app/counsel/layout.tsx');

  const open = layout.indexOf('<SidebarCollapseProvider>');
  const close = layout.indexOf('</SidebarCollapseProvider>');

  it('still has the provider that wraps the rail and the page', () => {
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
  });

  it('mounts the rail inside that provider', () => {
    expect(layout.slice(open, close)).toContain('<CounselSidebarShell>');
  });

  it('keeps the shell footer inside the rail row, not after it', () => {
    // Inside: the row now runs to the end of the document, so the rail is
    // never clamped and never moves.
    expect(layout.slice(open, close)).toContain('<footer');
  });

  it('leaves no footer after the row, which is where it used to sit', () => {
    // The guest shell earlier in the file has its own footer and no rail, so
    // only the region AFTER the member shell's row is asserted empty.
    expect(layout.slice(close)).not.toContain('<footer');
  });
});

describe('the counsel rail can still measure the header it hangs from', () => {
  const focus = read('components/counsel/SidebarFocus.tsx');
  const header = read('components/counsel/CounselHeader.tsx');

  // Comments in this file discuss stickiness, and the collapsed page-keeper
  // tab carries its own `self-start`, so a bare file-wide search for either
  // word passes even after the rail stops being sticky. Everything below is
  // asserted against the rail wrapper's OWN class string, with comments
  // stripped first.
  const focusCode = focus.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const railClass = (focusCode.match(/className="([^"]*\bmd:block\b[^"]*)"/) ??
    [])[1];

  it('still positions the rail with sticky, pinned to its own top edge', () => {
    // `self-start` is load-bearing: without it the flex row stretches the rail
    // to the row's full height and the sticky offset has nothing to do.
    expect(railClass).toBeDefined();
    expect(railClass?.split(/\s+/)).toContain('sticky');
    expect(railClass?.split(/\s+/)).toContain('self-start');
  });

  it('measures the header with the direct-child selector', () => {
    expect(focusCode).toContain(".counsel-shell > header");
  });

  it('and CounselHeader still returns a bare header as its root', () => {
    // Strip comments so a comment mentioning a tag cannot satisfy this.
    const body = header
      .slice(header.indexOf('return ('))
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');
    const firstTag = body.match(/<([A-Za-z][\w.]*)/);
    expect(firstTag?.[1]).toBe('header');
  });
});
