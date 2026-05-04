/**
 * Tiny Vercel API client for adding/removing project domains
 * programmatically. Used by the Phase 2 white-label flow so HQ admins
 * can provision a tenant subdomain (<slug>.advottic.com) with one
 * click instead of clicking through the Vercel dashboard.
 *
 * Env vars (set in Vercel project Settings -> Environment Variables):
 *
 *   VERCEL_API_TOKEN  - Personal token from Vercel -> Settings ->
 *                       Tokens. Scope it to the counsel-optics project
 *                       only - the token has permission to add/remove
 *                       domains and we want least-privilege.
 *   VERCEL_PROJECT_ID - The Vercel project ID for counsel-optics. Find
 *                       it in Project Settings -> General -> Project ID.
 *   VERCEL_TEAM_ID    - Optional. Set if the project lives under a
 *                       team rather than your personal account. We
 *                       have one (technooptics-projects) so this is
 *                       set in production.
 *
 * Server-only - never import from a 'use client' module. The token
 * must never reach the browser.
 */

const VERCEL_API = 'https://api.vercel.com';

function getCreds(): {
  token: string;
  projectId: string;
  teamId: string | null;
} | null {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  const teamId = process.env.VERCEL_TEAM_ID?.trim() || null;
  if (!token || !projectId) return null;
  return { token, projectId, teamId };
}

function withTeam(url: URL, teamId: string | null) {
  if (teamId) url.searchParams.set('teamId', teamId);
  return url;
}

export type VercelDomainResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

/**
 * Add a domain to the configured Vercel project. Idempotent: if the
 * domain is already attached to this project, returns ok. If it's
 * attached to a different project (would 409 conflict), the error is
 * surfaced verbatim so the operator can investigate.
 */
export async function addProjectDomain(
  domain: string,
): Promise<VercelDomainResult> {
  const creds = getCreds();
  if (!creds) {
    return {
      ok: false,
      error:
        'Vercel API not configured. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID in Vercel env.',
    };
  }
  const url = withTeam(
    new URL(`${VERCEL_API}/v10/projects/${creds.projectId}/domains`),
    creds.teamId,
  );
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
      // Edge-friendly fetch settings; this runs from a server action
      // not the edge runtime so the cache directive is just hygiene.
      cache: 'no-store',
    });
    if (res.ok) return { ok: true };
    // 409 means "already attached to this project" or "attached to
    // another project". Read the body to disambiguate.
    const body = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    };
    const code = body.error?.code ?? '';
    const msg = body.error?.message ?? `Vercel returned ${res.status}.`;
    if (
      res.status === 409 &&
      (code === 'domain_already_in_use_by_this_project' ||
        /already.*this project/i.test(msg))
    ) {
      return { ok: true };
    }
    return { ok: false, error: msg, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Vercel API request failed.',
    };
  }
}

/**
 * Detach a domain from the configured Vercel project. Idempotent: if
 * the domain isn't attached, returns ok. Used when an HQ admin revokes
 * a firm's tenant subdomain.
 */
export async function removeProjectDomain(
  domain: string,
): Promise<VercelDomainResult> {
  const creds = getCreds();
  if (!creds) {
    return {
      ok: false,
      error:
        'Vercel API not configured. Set VERCEL_API_TOKEN and VERCEL_PROJECT_ID in Vercel env.',
    };
  }
  const url = withTeam(
    new URL(
      `${VERCEL_API}/v9/projects/${creds.projectId}/domains/${encodeURIComponent(domain)}`,
    ),
    creds.teamId,
  );
  try {
    const res = await fetch(url.toString(), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${creds.token}` },
      cache: 'no-store',
    });
    if (res.ok || res.status === 404) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    return {
      ok: false,
      error: body.error?.message ?? `Vercel returned ${res.status}.`,
      status: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Vercel API request failed.',
    };
  }
}

/** True when the Vercel API token + project ID are both present. */
export function isVercelApiConfigured(): boolean {
  return getCreds() !== null;
}
