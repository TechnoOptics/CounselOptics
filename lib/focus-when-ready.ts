'use client';

/**
 * Focus an element ref as soon as it exists, across a few animation
 * frames. Needed because pop-ups now render through a portal
 * (PopupPortal) whose SSR mount-guard delays the panel by a render -
 * a single requestAnimationFrame can fire before the portaled panel
 * is in the DOM, so the focus is lost. This retries for a handful of
 * frames until the ref is attached, then focuses once.
 */
export function focusWhenReady(
  ref: { current: HTMLElement | null },
  maxFrames = 12,
): void {
  let frames = 0;
  const tick = () => {
    if (ref.current) {
      ref.current.focus();
      return;
    }
    if (frames++ < maxFrames) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
