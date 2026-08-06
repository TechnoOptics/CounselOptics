import { describe, expect, it } from 'vitest';
import {
  createFrameSrcRetainer,
  focusHeldByEmbed,
  isEditingTarget,
  stableFrameSrc,
} from '../lib/refresh-guards';

/**
 * The three decisions that keep a background refresh from disturbing the
 * person using the page. Each one is invisible when it regresses: the
 * page still works, it just throws away what someone was in the middle
 * of. Asserted here as pure functions because the unit suite runs in a
 * node environment with no DOM.
 */

describe('isEditingTarget', () => {
  it('is true for every field a person can be typing into', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isEditingTarget({ tagName })).toBe(true);
    }
    expect(isEditingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for the page itself and for ordinary elements', () => {
    expect(isEditingTarget({ tagName: 'BODY' })).toBe(false);
    expect(isEditingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(isEditingTarget(null)).toBe(false);
    expect(isEditingTarget(undefined)).toBe(false);
  });

  it('does not depend on the case the tag name arrives in', () => {
    expect(isEditingTarget({ tagName: 'input' })).toBe(true);
  });
});

describe('focusHeldByEmbed', () => {
  it('recognises focus handed to something embedded in this page', () => {
    for (const tagName of ['IFRAME', 'EMBED', 'OBJECT', 'iframe']) {
      expect(focusHeldByEmbed(tagName)).toBe(true);
    }
  });

  it('treats a real blur, where nothing on the page took focus, as leaving', () => {
    // A window blur with BODY (or nothing) active is the tab actually
    // going to the background, which is exactly when a refresh is wanted.
    expect(focusHeldByEmbed('BODY')).toBe(false);
    expect(focusHeldByEmbed(undefined)).toBe(false);
    expect(focusHeldByEmbed(null)).toBe(false);
    expect(focusHeldByEmbed('INPUT')).toBe(false);
  });
});

describe('stableFrameSrc', () => {
  it('keeps the URL the frame is already showing when a new one is minted', () => {
    // Every render mints a new signed URL. Writing it through navigates
    // the frame, which reloads the PDF viewer to page 1 and takes focus
    // from whoever was filling in the form beside it.
    expect(stableFrameSrc('https://store/doc?sig=first', 'https://store/doc?sig=second')).toBe(
      'https://store/doc?sig=first',
    );
  });

  it('adopts the incoming URL while there is nothing on screen to disturb', () => {
    expect(stableFrameSrc(null, 'https://store/doc?sig=first')).toBe(
      'https://store/doc?sig=first',
    );
    expect(stableFrameSrc('', 'https://store/doc?sig=first')).toBe(
      'https://store/doc?sig=first',
    );
  });

  it('reports nothing to render rather than an empty src', () => {
    expect(stableFrameSrc(null, null)).toBeNull();
    expect(stableFrameSrc('', undefined)).toBeNull();
  });
});

describe('createFrameSrcRetainer', () => {
  /**
   * This is the half of the fix that carries it. A per-render decision
   * with no memory is not enough: the frame has to be handed the SAME
   * URL on the second render and the twentieth, or the next signed URL
   * navigates it and the reader is back on page 1. So the sequence is
   * asserted, not just one call.
   */
  it('keeps the first URL that worked for as long as the frame is mounted', () => {
    const retain = createFrameSrcRetainer();
    expect(retain('https://store/doc?sig=1')).toBe('https://store/doc?sig=1');
    // Every later render mints a fresh signature. None of them reach the
    // frame.
    expect(retain('https://store/doc?sig=2')).toBe('https://store/doc?sig=1');
    expect(retain('https://store/doc?sig=3')).toBe('https://store/doc?sig=1');
    expect(retain(null)).toBe('https://store/doc?sig=1');
  });

  it('adopts a URL that arrives while the frame is still empty, then holds that one', () => {
    // The first render can have nothing to show (no signed URL yet).
    // There is no document on screen to disturb, so the next URL is
    // taken, and from then on it is the one that is kept.
    const retain = createFrameSrcRetainer();
    expect(retain(null)).toBeNull();
    expect(retain('')).toBeNull();
    expect(retain('https://store/doc?sig=1')).toBe('https://store/doc?sig=1');
    expect(retain('https://store/doc?sig=2')).toBe('https://store/doc?sig=1');
  });

  it('answers the same when a render runs twice with the same URL', () => {
    // StrictMode double-invokes render, and a concurrent render can be
    // thrown away. Neither may change what the frame shows.
    const retain = createFrameSrcRetainer();
    expect(retain('https://store/doc?sig=1')).toBe('https://store/doc?sig=1');
    expect(retain('https://store/doc?sig=1')).toBe('https://store/doc?sig=1');
  });

  it('gives each frame its own retained URL', () => {
    const a = createFrameSrcRetainer();
    const b = createFrameSrcRetainer();
    expect(a('https://store/a')).toBe('https://store/a');
    expect(b('https://store/b')).toBe('https://store/b');
    expect(a('https://store/b')).toBe('https://store/a');
  });
});
