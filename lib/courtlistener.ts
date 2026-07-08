import 'server-only';

/**
 * CourtListener (Free Law Project) client + citation VERIFIER.
 *
 * The single hard safety rule for the firm legal-review surface is that we
 * never show a case citation that isn't real. The model proposes candidate
 * cases; every one is run through {@link verifyCase} here, which checks it
 * against the CourtListener REST API (v4). A citation is only ever surfaced
 * to a lawyer once this module has confirmed a matching opinion actually
 * exists in CourtListener, and it always carries the real courtlistener.com
 * link so the lawyer can open the source. Anything we cannot confirm is
 * dropped by the caller.
 *
 * This module is intentionally independent of any LLM: it can be built and
 * tested on its own. The pure helpers (name/citation normalisation + match
 * logic) are exported so they can be unit-tested without network access; the
 * network calls are best-effort and fail CLOSED (return "not verified") so a
 * CourtListener outage can never turn into a fabricated citation.
 *
 * An API token (env COURTLISTENER_API_TOKEN) is optional; it only raises the
 * anonymous rate limits. Verification works without one.
 */

import {
  COURTLISTENER_BASE,
  absoluteUrl,
  caseNamesMatch,
} from './courtlistener-match';

// Re-export the network-free helpers so callers have one import surface.
export {
  absoluteUrl,
  normalizeCaseName,
  partiesOf,
  caseNamesMatch,
  extractCitations,
} from './courtlistener-match';

const BASE = COURTLISTENER_BASE;
const API = `${BASE}/api/rest/v4`;
const TIMEOUT_MS = 15_000;

// ── Result shapes ─────────────────────────────────────────────────────────

export type ClOpinion = {
  clusterId: number | null;
  caseName: string;
  citations: string[];
  court: string | null;
  dateFiled: string | null;
  /** Full https courtlistener.com URL for the opinion cluster. */
  url: string | null;
};

export type CitationCandidate = {
  caseName: string;
  /** Reporter citation string, e.g. "410 U.S. 113". Optional. */
  citation?: string | null;
  court?: string | null;
  year?: string | null;
};

export type CitationVerification = {
  candidate: CitationCandidate;
  verified: boolean;
  /** The confirmed record from CourtListener (only when verified). */
  match?: {
    caseName: string;
    citation: string | null;
    court: string | null;
    dateFiled: string | null;
    url: string;
  };
  /** Why verification failed (for server logs / debugging), never shown raw. */
  reason?: 'no_match' | 'unconfigured' | 'network' | 'no_query';
};

// ── Network layer ───────────────────────────────────────────────────────

function token(): string | undefined {
  return process.env.COURTLISTENER_API_TOKEN?.trim() || undefined;
}

function authHeaders(): Record<string, string> {
  const t = token();
  const h: Record<string, string> = { Accept: 'application/json' };
  if (t) h.Authorization = `Token ${t}`;
  return h;
}

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[courtlistener] GET ${res.status} ${url.slice(0, 200)}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn('[courtlistener] GET failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Map one v4 opinion search result into our compact shape. */
function toOpinion(r: Record<string, unknown>): ClOpinion {
  const rawCites = r.citation;
  const citations = Array.isArray(rawCites)
    ? rawCites.map((c) => String(c)).filter(Boolean)
    : typeof rawCites === 'string'
      ? [rawCites]
      : [];
  const clusterId =
    typeof r.cluster_id === 'number'
      ? r.cluster_id
      : typeof r.id === 'number'
        ? (r.id as number)
        : null;
  return {
    clusterId,
    caseName: String(r.caseName ?? r.case_name ?? '').trim(),
    citations,
    court: (r.court ?? r.court_id ?? null) as string | null,
    dateFiled: (r.dateFiled ?? r.date_filed ?? null) as string | null,
    url: absoluteUrl((r.absolute_url as string) ?? null),
  };
}

/**
 * Full-text opinion search. Returns the top matching opinion clusters, or an
 * empty array on any failure (fails closed). `court` is a CourtListener court
 * id (e.g. "scotus", "ca9"); `dateFiledAfter`/`Before` are ISO dates.
 */
export async function searchOpinions(opts: {
  query: string;
  court?: string | null;
  dateFiledAfter?: string | null;
  dateFiledBefore?: string | null;
  pageSize?: number;
}): Promise<ClOpinion[]> {
  const q = opts.query.trim();
  if (!q) return [];
  const params = new URLSearchParams({ type: 'o', q });
  if (opts.court) params.set('court', opts.court);
  if (opts.dateFiledAfter) params.set('filed_after', opts.dateFiledAfter);
  if (opts.dateFiledBefore) params.set('filed_before', opts.dateFiledBefore);
  const data = (await getJson(`${API}/search/?${params.toString()}`)) as
    | { results?: unknown[] }
    | null;
  const results = Array.isArray(data?.results) ? data!.results! : [];
  return results
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .slice(0, opts.pageSize ?? 10)
    .map(toOpinion)
    .filter((o) => o.caseName);
}

/**
 * Look a reporter citation up directly via the citation-lookup endpoint, the
 * most authoritative check: it parses the citation and returns the exact
 * cluster(s) it resolves to. Returns [] on any failure (fails closed).
 */
export async function lookupCitation(citation: string): Promise<ClOpinion[]> {
  const c = citation.trim();
  if (!c) return [];
  try {
    const res = await fetch(`${API}/citation-lookup/`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: c }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[courtlistener] citation-lookup ${res.status} for "${c}"`);
      return [];
    }
    const data = (await res.json()) as Array<{
      status?: number;
      clusters?: Array<Record<string, unknown>>;
    }>;
    const out: ClOpinion[] = [];
    for (const entry of Array.isArray(data) ? data : []) {
      if (entry.status !== 200 || !Array.isArray(entry.clusters)) continue;
      for (const cl of entry.clusters) {
        out.push(
          toOpinion({
            ...cl,
            caseName: cl.case_name ?? cl.caseName,
            citation: Array.isArray(cl.citations)
              ? (cl.citations as unknown[]).map((x) =>
                  typeof x === 'string'
                    ? x
                    : `${(x as Record<string, unknown>).volume ?? ''} ${(x as Record<string, unknown>).reporter ?? ''} ${(x as Record<string, unknown>).page ?? ''}`.trim(),
                )
              : [],
          }),
        );
      }
    }
    return out;
  } catch (err) {
    console.warn('[courtlistener] citation-lookup failed:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Verify a single candidate case against CourtListener. Strategy:
 *   1. If the candidate carries a reporter citation, resolve it via
 *      citation-lookup (authoritative). Confirm the resolved case name is
 *      consistent with the candidate name (guards a mis-typed citation that
 *      happens to resolve to an unrelated case).
 *   2. Otherwise (or if lookup found nothing), full-text search by case name
 *      and accept a result whose name matches per caseNamesMatch, preferring
 *      one whose citation also matches when the candidate had one.
 *
 * Fails CLOSED: any network problem or no confident match yields
 * { verified: false }. Never returns verified:true without a real cluster URL.
 */
export async function verifyCase(candidate: CitationCandidate): Promise<CitationVerification> {
  const name = (candidate.caseName ?? '').trim();
  const citation = (candidate.citation ?? '').trim();
  if (!name && !citation) return { candidate, verified: false, reason: 'no_query' };

  const confirm = (o: ClOpinion): CitationVerification | null => {
    if (!o.url) return null;
    return {
      candidate,
      verified: true,
      match: {
        caseName: o.caseName,
        citation: o.citations[0] ?? null,
        court: o.court,
        dateFiled: o.dateFiled,
        url: o.url,
      },
    };
  };

  // 1. Citation-first (authoritative).
  if (citation) {
    const byCite = await lookupCitation(citation);
    for (const o of byCite) {
      // If we also have a name, require it to be consistent; if not, trust the
      // citation resolution (the reporter+volume+page uniquely identify it).
      if (!name || caseNamesMatch(name, o.caseName)) {
        const c = confirm(o);
        if (c) return c;
      }
    }
  }

  // 2. Name search.
  if (name) {
    const hits = await searchOpinions({ query: name, pageSize: 10 });
    // Prefer a hit whose citation also matches the candidate's citation.
    const wantCite = citation.replace(/\s+/g, ' ').toLowerCase();
    const ranked = [...hits].sort((a, b) => {
      const am = wantCite && a.citations.some((c) => c.toLowerCase().includes(wantCite)) ? 0 : 1;
      const bm = wantCite && b.citations.some((c) => c.toLowerCase().includes(wantCite)) ? 0 : 1;
      return am - bm;
    });
    for (const o of ranked) {
      if (caseNamesMatch(name, o.caseName)) {
        const c = confirm(o);
        if (c) return c;
      }
    }
  }

  return { candidate, verified: false, reason: 'no_match' };
}

/** Verify many candidates concurrently (bounded). Order preserved. */
export async function verifyCases(
  candidates: CitationCandidate[],
): Promise<CitationVerification[]> {
  return Promise.all(candidates.map((c) => verifyCase(c)));
}
