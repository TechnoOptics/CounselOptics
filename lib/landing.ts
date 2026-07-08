import 'server-only';
import { listMyFirms } from './firm-storage';

/**
 * The default post-sign-in landing path for the currently-signed-in
 * user.
 *
 * A user with a firm_members row (owner / admin / legal) belongs in the
 * Counsel workspace, not the consumer /cases app. Historically every
 * redirect chokepoint (root landing, sign-in auto-redirect, OAuth
 * callback, apex home redirect in middleware) hard-coded `/cases`, so a
 * firm owner who signed in was silently dropped into the consumer app
 * and had to hunt for the workspace switcher. This resolves the right
 * default from firm membership.
 *
 * Best-effort: any failure (transient DB hiccup, table not migrated)
 * falls back to `/cases` so a lookup problem can never block sign-in.
 *
 * Note: only meaningful in a context where the session cookies are
 * already readable via next/headers (server components / the sign-in
 * page). The OAuth callback and edge middleware hold their own Supabase
 * client with the freshly-minted session and query firm_members
 * directly instead of calling this.
 */
export async function resolveDefaultLanding(): Promise<'/counsel' | '/cases'> {
  try {
    const firms = await listMyFirms();
    return firms.length > 0 ? '/counsel' : '/cases';
  } catch {
    return '/cases';
  }
}

/**
 * True when the given post-sign-in destination is the generic consumer
 * dashboard default (`/cases`) rather than a deliberate deep link. Only
 * the bare default is eligible to be redirected to `/counsel` for firm
 * members — a specific consumer deep link (e.g. `/cases/<id>`, `/inbox`)
 * is always honoured.
 */
export function isDefaultConsumerLanding(next: string): boolean {
  return next === '/cases' || next === '/cases/';
}
