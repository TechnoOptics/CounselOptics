/**
 * Height bookkeeping for the Advottic Review section carousel
 * (app/cases/[id]/review-panel.tsx).
 *
 * The carousel lays its four sections out side by side in a single horizontal
 * scroll track, so the track's natural height is the height of the TALLEST
 * section rather than the one on screen. The track is therefore pinned to the
 * measured height of the active section.
 *
 * Reading that measurement is the fragile part. components/Tabs.tsx mounts
 * every tab's content at once and hides the inactive ones with the `hidden`
 * attribute, and nothing inside a display:none subtree has a layout box, so
 * every offsetHeight in it reads 0. A 0 is not "this section is empty", it is
 * "this section has not been laid out yet", and treating the two the same is
 * what left a short section sitting in a tall card.
 */
export function usableSlideHeight(measured: number): number | null {
  if (!Number.isFinite(measured) || measured <= 0) return null;
  return measured;
}
