/**
 * The decisions behind "should this background refresh happen, and what
 * should it be allowed to disturb".
 *
 * They live here, apart from the components that use them, for one
 * reason: each one is a guard whose failure is invisible in review and
 * expensive in production (a caret lost mid-sentence, a PDF viewer
 * yanked back to page 1), and the unit suite runs in a node environment
 * with no DOM. Kept as pure functions over the two or three facts that
 * actually matter, they are testable without one.
 */

/** The minimum an element has to tell us to decide the questions below. */
export type FocusTarget = {
  tagName?: string | null;
  isContentEditable?: boolean;
} | null | undefined;

/**
 * Is the user mid-entry in a field?
 *
 * A background freshness check is never worth the text someone was
 * typing, so when this is true the refresh is skipped and the next
 * focus, visibility change or version poll picks it up once they have
 * moved on.
 */
export function isEditingTarget(el: FocusTarget): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Did the window hand focus to something embedded in the SAME page?
 *
 * On any page carrying a document preview, clicking into the preview
 * blurs the window and clicking back out focuses it again, with the tab
 * never once leaving the foreground. Treating that as a return from the
 * background refreshed the route in the middle of someone filling in the
 * form beside the preview.
 */
export function focusHeldByEmbed(tagName: string | null | undefined): boolean {
  const tag = (tagName ?? '').toUpperCase();
  return tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT';
}

/**
 * Which URL an embedded document frame should render, given the one it
 * is already showing and the one the latest server render produced.
 *
 * Signed storage URLs are minted fresh on every render, and the pages
 * that embed them are force-dynamic, so each router.refresh() handed the
 * iframe a different `src`. Reassigning `src` navigates the frame: the
 * browser's PDF viewer reloads, drops back to page 1 and takes focus,
 * which is what the owner saw as the signer form "losing what I typed"
 * (no React remount was ever involved). So the first URL that works is
 * the one we keep. A later URL is adopted only when there is nothing to
 * disturb, i.e. the frame has not shown a document yet.
 *
 * The trade, stated plainly: the retained URL is a time-limited
 * signature (getFirmDocumentSignedUrl mints ten minutes, see
 * lib/firm-storage.ts), and the behaviour this replaced renewed it on
 * every focus event, so the URL sitting in the DOM was almost never
 * close to expiry. Pinning one for the life of the mount is genuinely
 * shorter-lived: anything that re-requests the resource more than ten
 * minutes in (a discarded tab, a bfcache restore, a range request into
 * a very large PDF) can be refused, and the recovery is a page reload.
 * We take that over reloading the viewer under the reader on every
 * refresh. Renewal on a timer is NOT the cheap middle ground it looks
 * like: renewing means assigning `src`, which is the navigation this
 * exists to prevent.
 */
export function stableFrameSrc(
  retained: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  return retained || incoming || null;
}

/** What a mounted frame shows, one render at a time. */
export type FrameSrcRetainer = (incoming: string | null | undefined) => string | null;

/**
 * The mount-scoped half of the rule above: what one frame shows across a
 * SEQUENCE of renders.
 *
 * `stableFrameSrc` decides a single render, and on its own it is not the
 * fix: a decision with no memory would let the next freshly minted
 * signed URL through and navigate the frame again. The retention is what
 * carries it, so it lives here, as a closure over the URL already on
 * screen, callable from the node test environment. The component is then
 * one call per render.
 *
 * Idempotent for a repeated argument, so a render that runs twice
 * (StrictMode) or is thrown away (a discarded concurrent render) cannot
 * change the answer.
 */
export function createFrameSrcRetainer(): FrameSrcRetainer {
  let retained: string | null = null;
  return (incoming) => {
    retained = stableFrameSrc(retained, incoming);
    return retained;
  };
}
