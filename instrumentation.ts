/**
 * Next.js instrumentation hook. Captures every uncaught server-side
 * exception during a request and posts it to /api/crash so it ends
 * up in public.crash_reports.
 *
 * Edge-safe: this file is bundled for BOTH the nodejs and edge
 * runtimes, so it must not transitively import anything that uses
 * node: protocol modules. We POST to /api/crash via global fetch,
 * which works in both runtimes - the route handler itself runs on
 * nodejs and writes to Supabase.
 */

export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  const error = err as { message?: string; stack?: string; digest?: string };
  const path = request.path ?? context.routePath ?? null;
  // Always log so the dashboard "Logs" tab shows it.
  // eslint-disable-next-line no-console
  console.error('[onRequestError]', {
    digest: error.digest,
    message: error.message,
    path,
    routerKind: context.routerKind,
    routeType: context.routeType,
    stack: error.stack?.slice(0, 2000),
  });
  try {
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL || 'https://www.advottic.com';
    await fetch(`${origin}/api/crash`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `[server] ${error.message ?? 'unknown'} (digest=${error.digest ?? 'none'})`,
        stack: error.stack ?? null,
        url: path,
      }),
      cache: 'no-store',
    }).catch(() => {});
  } catch {
    // never let the error reporter throw inside the error path
  }
}
