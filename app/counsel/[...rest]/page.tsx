import { notFound } from 'next/navigation';

/**
 * Catch-all for every /counsel/** URL that matches no real route.
 *
 * app/counsel/not-found.tsx only covers notFound() thrown from inside a
 * counsel segment. A path that matches nothing at all never enters the
 * counsel subtree, so it fell through to the global app/not-found.tsx:
 * full-bleed cream, no rail, no firm logo, none of the dark shell. A
 * mistyped or stale link therefore ejected a firm user from the
 * workspace, which is the same ejection L-B3 described for /counsel/
 * cases/new, just reached by a different door.
 *
 * This page exists only to fail. Rendering it calls notFound(), which is
 * caught by app/counsel/not-found.tsx one level up, so an unknown URL now
 * lands on the same in-shell 404 as an unknown matter id.
 *
 * It cannot shadow a real route: the App Router resolves static segments
 * before dynamic ones and dynamic before catch-all, and /counsel has no
 * other dynamic segment at this level. Deeper garbage (/counsel/cases/
 * <id>/nonsense) falls here too, which is what we want.
 */
export default function CounselCatchAll(): never {
  notFound();
}
