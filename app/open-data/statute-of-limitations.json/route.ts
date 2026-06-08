import { NextResponse } from 'next/server';
import {
  STATES_SOL,
  CLAIM_TYPES,
} from '@/lib/statute-of-limitations';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

/**
 * GET /open-data/statute-of-limitations.json
 *
 * Downloadable JSON dataset of every state's statute of
 * limitations across 9 claim types. Served as application/json
 * with permissive CORS so anyone can fetch it from a notebook,
 * a static site, or an LLM tool call.
 *
 * Why this exists: Google Dataset Search and AI ingestion
 * pipelines (Common Crawl, GPT, Claude training) both prefer
 * canonical JSON downloads with explicit license metadata over
 * scraped HTML. Publishing the data as a citeable dataset adds
 * a different category of authoritative backlink and citation
 * than the HTML pages alone produce.
 *
 * License: CC BY 4.0 (require attribution). Recorded in the
 * payload so downstream tools know they may reuse with credit.
 */
export async function GET() {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Advottic US Statute of Limitations Dataset',
    description:
      'Statute of limitations by US state and DC across nine claim categories. Each entry includes the controlling time window in years and a caveat (discovery rule, statute of repose).',
    version: '2026.06',
    datePublished: '2026-06-08',
    dateModified: '2026-06-08',
    license: 'https://creativecommons.org/licenses/by/4.0/',
    creator: {
      '@type': 'Organization',
      name: 'Advottic',
      url: 'https://advottic.com/',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Techno Optics LLC',
      url: 'https://advottic.com/about',
    },
    url: 'https://advottic.com/tools/statute-of-limitations',
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl:
          'https://advottic.com/open-data/statute-of-limitations.json',
      },
    ],
    keywords: [
      'statute of limitations',
      'legal deadlines',
      'tort law',
      'contract law',
      'United States',
      'legal data',
    ],
    // The actual data, in a shape that's stable + machine-friendly.
    // Use string IDs throughout so consumers don't need to maintain
    // a separate type table.
    claimTypes: CLAIM_TYPES.map((c) => ({
      id: c.id,
      label: c.label,
      description: c.description.replace(/&[a-z#0-9]+;/gi, ''),
    })),
    states: STATES_SOL.map((s) => ({
      slug: s.slug,
      name: s.name,
      abbr: s.abbr,
      limits: s.limits,
    })),
  };
  return NextResponse.json(payload, {
    headers: {
      // Permissive CORS so notebooks + LLM-tool calls can fetch
      // without preflight pain. Public dataset, no auth.
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      // Long cache - the dataset only changes when we re-review.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
