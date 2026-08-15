/**
 * Hide everything behind a full-screen overlay from the keyboard AND from the
 * accessibility tree, not just from the eye.
 *
 * THE ONE THIS EXISTS FOR. Safe Witness has a discreet mode: the recording
 * continues and the screen goes black, so that somebody the user is hiding it
 * from sees nothing. It is drawn as `fixed inset-0 z-[95] bg-black` through
 * PopupPortal, which appends to document.body and touches nothing else.
 *
 * Covering pixels is not concealment. Under that black rectangle the site
 * header, the mobile nav, the footer and the whole Safe Witness panel were
 * still in the document, still in the tab order, and still in the
 * accessibility tree. Two things followed, and both defeat the feature at the
 * moment it matters most:
 *
 *   - A Tab press moves focus into the hidden UI. The browser scrolls to and
 *     ring-highlights whatever it lands on, THROUGH the overlay, because a
 *     focus ring is painted by the UA and does not care about z-index in the
 *     way a person hoping for a blank screen would need it to.
 *   - A screen reader reads it out. Somebody using VoiceOver sees a black
 *     screen and hears "Advottic", "Safe Witness", "Stop recording". The
 *     concealment is visual only, and a blind user gets none of it.
 *
 * components/Dialog.tsx already reasoned this out for ordinary modals and
 * traps Tab inside its panel. This is the same problem one step further: the
 * overlay is not a panel to trap focus WITHIN, it is a blank surface, so the
 * answer is to make everything else inert rather than to cycle focus around
 * it.
 *
 * WHY `inert` AND NOT `aria-hidden`. aria-hidden removes an element from the
 * accessibility tree but leaves it focusable, which produces the worst
 * outcome of the two: focus lands somewhere a screen reader now refuses to
 * describe. `inert` does both at once and is what the platform provides for
 * exactly this. Where it is unsupported the elements simply stay reachable,
 * which is today's behaviour, so this never makes anything worse.
 */

/**
 * Which of a container's children to make inert, given the one to keep live.
 *
 * Pure and DOM-free so the decision can be tested without a browser: vitest
 * runs in the node environment here and always has. Everything this returns
 * is a member of `children`, so a caller cannot be handed a node it did not
 * supply.
 *
 * `keep` is matched by identity. A null or absent `keep` means nothing is
 * spared, which is deliberate: a caller that has lost track of its own
 * overlay must not silently fall back to sparing everything, because that is
 * the failure this module exists to prevent and it would be invisible.
 */
export function nodesToInert<T>(children: readonly T[], keep: T | null): T[] {
  return children.filter((child) => child !== keep);
}

/** The attribute, named once so the applier and its test cannot disagree. */
export const INERT_ATTR = 'inert';

/**
 * Mark every sibling of `keep` inert, and return the undo.
 *
 * The undo restores only what this call changed. An element that was ALREADY
 * inert when we arrived stays inert afterwards: it was somebody else's
 * decision and unsetting it would be this function reaching outside its own
 * change. That matters here because two overlays can be up at once (the
 * consent modal, say, over the Safe Witness page) and the inner one must not
 * un-hide the page when it closes.
 */
export function inertBackground(keep: Element | null): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const parent = keep?.parentElement ?? document.body;
  if (!parent) return () => undefined;
  const changed: Element[] = [];
  for (const el of nodesToInert(Array.from(parent.children), keep)) {
    if (el.hasAttribute(INERT_ATTR)) continue;
    el.setAttribute(INERT_ATTR, '');
    changed.push(el);
  }
  return () => {
    for (const el of changed) el.removeAttribute(INERT_ATTR);
  };
}
