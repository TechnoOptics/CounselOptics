import { notFound } from 'next/navigation';

/**
 * Catch-all for every /portal/** URL that matches no real route, the Hub
 * twin of app/counsel/[...rest]/page.tsx.
 *
 * /portal/<anything> already resolved, because app/portal/[id] treats a
 * single unknown segment as an intake id and 404s on it. Anything deeper
 * (/portal/nonsense/more, /portal/forms/<id>/nonsense) matched nothing and
 * fell through to the global app/not-found.tsx, dropping the Hub rail and
 * the firm's brand.
 *
 * [id] still wins for single-segment paths: the App Router resolves plain
 * dynamic segments ahead of catch-alls, and the two are tracked separately
 * so they are not a slug-name conflict. This only picks up what [id] and
 * the static segments leave behind.
 */
export default function PortalCatchAll(): never {
  notFound();
}
