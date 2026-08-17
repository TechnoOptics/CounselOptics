/**
 * Whether a pointer at the left of the window means "bring the collapsed nav
 * rail back".
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES INSIDE THE EFFECT THAT USES IT.
 * It started inside the effect, and every rule below was pinned only by
 * reading the source for the words `armed` and `buttons`. That is not a test
 * of anything: a real defect went out under twenty-five green ones, because
 * `document` fires `pointerleave` CONTINUOUSLY at clientX 5 under the counsel
 * shell, which is inside this zone, and the cancel wired to it killed the
 * dwell on the frame it started.
 *
 * The browser could not settle it either. Driven through an automation
 * harness the tab reports `visibilityState: 'hidden'`, and Chrome freezes a
 * hidden tab's timers: a 140ms dwell never fires, so the feature reads as
 * broken no matter what the code says. A decision with no timer in it has
 * nothing to freeze, and tests/ticket-workspace.test.ts exercises every rule
 * directly.
 *
 * The component keeps what genuinely needs the browser: the media query, the
 * listeners, the timer, and the `armed` flag it carries between samples.
 */

/** How wide the edge zone is, in CSS pixels from the left of the window. */
export const EDGE_ZONE_PX = 6;

/** How long the pointer must rest in the zone before the rail returns. */
export const EDGE_DWELL_MS = 140;

/** One pointer sample, reduced to the four facts the decision turns on. */
export type EdgeSample = {
  /** clientX, in CSS pixels. */
  x: number;
  /** The PointerEvent `buttons` bitmask. Non-zero means a drag is in flight. */
  buttons: number;
  /** True when a non-collapsed text selection exists. */
  hasSelection: boolean;
};

export type EdgeDecision = {
  /** The armed flag to carry into the next sample. */
  armed: boolean;
  /**
   * - `arm` is unused as a distinct outcome; leaving the zone always cancels
   *   any pending dwell as well, so that case returns `cancel` with
   *   `armed: true`.
   * - `start` begins (or leaves running) the dwell.
   * - `cancel` drops any pending dwell.
   * - `hold` changes nothing: the pointer is in the zone but the zone has
   *   never been armed, so there is nothing to cancel and nothing to start.
   */
  action: 'start' | 'cancel' | 'hold';
};

/**
 * The rules, in the order they matter.
 *
 * OUTSIDE THE ZONE ARMS IT. This is the whole defence against the spring-back
 * the page-keeper tab documents: the rail can be collapsed by a keyboard, by a
 * route, or by a button that sits under the cursor, and a zone that fires on
 * whatever it sees first would reopen instantly. The pointer has to be
 * somewhere else at least once.
 *
 * A HELD BUTTON MEANS A DRAG. Something is being dragged towards the left of
 * the window and the nav sliding out from under it is a surprise in the middle
 * of a gesture the person is committed to.
 *
 * A LIVE SELECTION MEANS A SWEEP. Selecting leftwards through the matter
 * summary ends with the pointer past the edge of the text, and the selection
 * is live at that moment even between drags, so `buttons` alone does not cover
 * it.
 *
 * Neither refusal disarms. The pointer has not left the zone, so requiring it
 * to make the whole trip again before a second attempt would mean letting go
 * of a drag at the edge permanently disables the gesture until you walk away.
 */
export function edgeRevealDecision(
  sample: EdgeSample,
  armed: boolean,
): EdgeDecision {
  if (sample.x > EDGE_ZONE_PX) return { armed: true, action: 'cancel' };
  if (!armed) return { armed, action: 'hold' };
  if (sample.buttons !== 0 || sample.hasSelection) {
    return { armed, action: 'cancel' };
  }
  return { armed, action: 'start' };
}

/* ------------------------------------------------------------------ *
 * Leaving the rail alone, which is the other half of the same feature.
 * ------------------------------------------------------------------ */

/**
 * How long the rail may sit untouched before it hides itself.
 *
 * Five seconds, which is the figure the owner asked for, and it is named here
 * rather than spelled at the call site because it is exactly the kind of number
 * somebody comes back to tune. Two things it is balanced against, so a future
 * reader knows what moving it costs. Shorter and the panel leaves while a
 * person is still reading the nav to decide where to go, which reads as the
 * product being twitchy. Longer and it never fires during the short gaps that
 * are the whole point, so the rail may as well be pinned open.
 *
 * It is measured from the last interaction with the PANEL, not with the page.
 * A timer any activity anywhere reset would never fire while somebody worked in
 * the content column, which is precisely when the extra width is wanted.
 */
export const IDLE_HIDE_MS = 5_000;

/** The state of the panel at the moment its idle deadline comes up. */
export type IdleSample = {
  /** True when focus is inside the panel. */
  focusWithin: boolean;
  /** True when the pointer is over the panel. */
  pointerOver: boolean;
  /** The PointerEvent `buttons` bitmask. Non-zero means a drag is in flight. */
  buttons: number;
  /** True while a menu or popover inside the panel is open. */
  menuOpen: boolean;
  /** True when a non-collapsed text selection exists. */
  hasSelection: boolean;
};

/** Why the panel must not hide right now. */
export type IdleBlocker = 'focus' | 'pointer' | 'drag' | 'menu' | 'selection';

/**
 * Why the panel must not hide right now, or null when it may.
 *
 * FOCUS IS FIRST AND IS NOT NEGOTIABLE. The panel unmounts its children when it
 * collapses, so a keyboard user tabbing through the nav would not merely lose
 * the panel: the focus ring would land on `<body>` in the middle of their
 * navigation. Hover is the same rule for a mouse, one step less severe.
 *
 * THE OTHER THREE ARE ONE IDEA. A held button is a drag heading for the rail,
 * an open menu is a decision in progress inside it, and a live selection is a
 * sweep that has not finished. Each is a commitment the person has already
 * made, and the panel leaving from under it is the same surprise the edge
 * zone's own refusals exist to prevent.
 *
 * A single ordered answer rather than a set, so a caller (and a test) has one
 * value to compare. The order is severity: the reader would be most surprised
 * to see focus overruled.
 *
 * WHAT THE CALLER MUST DO WITH A BLOCKER. Schedule another deadline, never give
 * up. `edgeRevealDecision` says the same thing about its own refusals: if a
 * blocked deadline cancelled instead, letting go of a drag over the rail would
 * disable the auto-hide until the next time somebody touched the panel.
 */
export function idleHideBlocker(sample: IdleSample): IdleBlocker | null {
  if (sample.focusWithin) return 'focus';
  if (sample.pointerOver) return 'pointer';
  if (sample.buttons !== 0) return 'drag';
  if (sample.menuOpen) return 'menu';
  if (sample.hasSelection) return 'selection';
  return null;
}

/**
 * What counts as a menu or popover being open inside the panel.
 *
 * QUALIFIED BY `aria-haspopup` ON PURPOSE, and this is a defect that only
 * rendering the page found. A bare `[aria-expanded="true"]` also matches a
 * DISCLOSURE control, and the panel contains one: its own Collapse button
 * carries `aria-expanded` because it reports the state of the panel itself. So
 * the unqualified selector matched on every tick, the menu blocker was
 * permanently true, and the rail never hid once. Every unit test was green over
 * it, because the decision is handed a boolean and the boolean is arrived at
 * here.
 *
 * `[data-state="open"]` is the headless-UI convention and `details[open]` is
 * the platform's own. Neither can be satisfied by a control that merely
 * describes the panel it sits in.
 */
export const OPEN_OVERLAY_SELECTOR =
  '[aria-haspopup][aria-expanded="true"],[data-state="open"],details[open]';

/**
 * Whether the idle watch should run at all.
 *
 * A FINE POINTER ONLY, and this is the touch answer rather than an oversight.
 * The auto-hide and the edge reveal are one feature: the panel goes away
 * quietly because there is a fast way back, and that way back is a 6px strip at
 * the left of the window. On a touch device that strip is unaimable and it
 * competes with the browser's own back-swipe, so a thumb would be left with a
 * panel that hides itself and only the page-keeper tab to recover it. That is
 * worse than a panel that stays. Below 768px the rail is not rendered at all
 * (`hidden md:block`) and a separate mobile nav is in play, but a tablet above
 * that width is real and this is what covers it.
 *
 * NOT WHILE ALREADY COLLAPSED. There is nothing to hide, and a timer over a
 * collapsed rail could only fight the edge reveal trying to bring it back.
 */
export function shouldWatchForIdle(input: {
  finePointer: boolean;
  collapsed: boolean;
}): boolean {
  return input.finePointer && !input.collapsed;
}
