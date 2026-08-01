/**
 * Freeze the page behind an open overlay.
 *
 * Setting `overflow: hidden` on `document.body` alone does NOT work in
 * this app, and the failure is silent. globals.css puts `overflow-x:
 * clip` on both `html` and `body` (to stop a stray oversized child
 * introducing a horizontal scrollbar). Per the CSS overflow spec, the
 * body's overflow is only propagated to the viewport when the ROOT
 * element's overflow is `visible`; because `html` here is `clip`, the
 * propagation never happens and a body-only lock leaves the page
 * scrolling freely under the overlay. So we set both.
 *
 * Diagnosed for the counsel mobile nav drawer in 8253a33.
 *
 * Both previous INLINE values are captured and restored, never
 * hard-coded back to `visible` or `auto` - restoring the inline value
 * (usually the empty string) is what lets the stylesheet's
 * `overflow-x: clip` take effect again. Restoring a literal would
 * permanently defeat it and reintroduce horizontal scroll on mobile.
 *
 * Nesting is safe as long as callers unlock in reverse order, which
 * effect cleanup gives you for free: an inner overlay captures the
 * outer one's `hidden` and puts it back.
 *
 * Returns the unlock function; call it from effect cleanup.
 *
 * NOTE for anyone verifying this: `window.scrollTo` is programmatic and
 * is not blocked by `overflow: hidden`, so a scrollTo that "works" does
 * not mean the lock is broken. Test with a real wheel or touch gesture.
 */
export function lockScroll(): () => void {
  const body = document.body;
  const root = document.documentElement;

  const prevBodyOverflow = body.style.overflow;
  const prevRootOverflow = root.style.overflow;
  const prevPaddingRight = body.style.paddingRight;

  // Compensate for the disappearing scrollbar so content doesn't shift
  // on desktop. Measured before the lock, while the scrollbar is still
  // laid out; a nested lock measures 0 here and leaves padding alone.
  const scrollbarWidth = window.innerWidth - root.clientWidth;

  body.style.overflow = 'hidden';
  root.style.overflow = 'hidden';
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }

  return () => {
    body.style.overflow = prevBodyOverflow;
    root.style.overflow = prevRootOverflow;
    body.style.paddingRight = prevPaddingRight;
  };
}
