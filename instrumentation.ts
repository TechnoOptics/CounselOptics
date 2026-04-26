/**
 * Next.js instrumentation hook. Captures every uncaught server-side
 * exception during a request and writes it to public.crash_reports
 * via the service-role admin client, with the request URL + the
 * Next.js error digest so we can correlate against the "Application
 * error: Digest: <hash>" page the user sees.
 *
 * Vercel does not expose runtime logs over the REST API on lower
 * tiers, so this is our path to seeing the actual stack server-side.
 * Read the rows from /admin/health or query crash_reports directly.
 */

export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string; headers?: Record<string, string> },
  context: { routerKind?: string; routePath?: string; routeType?: string },
) {
  // Lazy-import so build-time bundling does not pull supabase server
  // helpers into the edge graph.
  try {
    const { recordCrashReport } = await import('./lib/storage');
    const error = err as { message?: string; stack?: string; digest?: string };
    const release =
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null;
    const ua = request.headers?.['user-agent'] ?? null;
    const path = request.path ?? context.routePath ?? null;
    await recordCrashReport({
      userId: null,
      url: path,
      userAgent: ua,
      message: `[server] ${error.message ?? 'unknown'} (digest=${error.digest ?? 'none'})`,
      stack: error.stack ?? null,
      componentStack: null,
      release,
    });
    // Always also surface in Vercel runtime logs (visible in dashboard
    // even when the API endpoint is gated).
    console.error('[onRequestError]', {
      digest: error.digest,
      message: error.message,
      path,
      routerKind: context.routerKind,
      routeType: context.routeType,
    });
  } catch {
    // never let the error reporter throw inside the error path
  }
}
