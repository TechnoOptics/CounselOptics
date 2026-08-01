/**
 * Is this server render a build-time prerender rather than a real request?
 *
 * Routes that declare `dynamic = 'force-static'` (the guides, the Spanish
 * pages, the glossary, the tools, the templates) are rendered with the
 * dynamic APIs stubbed out: `cookies()` and `headers()` return nothing, so a
 * server component cannot read the session and the shared layout paints the
 * anonymous shell. A signed-in reader then looks up from a guide and sees a
 * "Sign in" button (live audit 2026-08-01, BR-L11).
 *
 * `lib/supabase/middleware.ts` sets `x-pathname` on every request it handles,
 * and its matcher covers every page route. So an absent `x-pathname` means
 * "there was no request" - the render is a prerender, the session is
 * unknowable here, and the answer has to be settled on the client instead.
 */
export function isPrerenderedRender(xPathnameHeader: string | null | undefined): boolean {
  return !xPathnameHeader;
}
