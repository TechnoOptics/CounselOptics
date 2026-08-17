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
