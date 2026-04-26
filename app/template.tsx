'use client';

/**
 * Route-level template that runs on every navigation. Wrapping all pages
 * in this client template gives us a brief opacity + lift transition
 * between routes, so navigating from /cases to /cases/[id] (or anywhere
 * else) doesn't feel like a hard reload. The animation runs on `key`
 * change driven by the route, courtesy of Next's App Router.
 *
 * The `route-fade` class lives in globals.css with a reduced-motion
 * carve-out, so users who opt out get no animation at all.
 */
export default function RouteTransitionTemplate({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="route-fade">{children}</div>;
}
