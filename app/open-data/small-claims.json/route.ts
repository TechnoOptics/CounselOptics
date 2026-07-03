import { NextResponse } from 'next/server';
import {
  STATES_SMALL_CLAIMS,
  SMALL_CLAIMS_REVIEWED_AT,
} from '@/lib/state-small-claims';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

/**
 * GET /open-data/small-claims.json
 *
 * Downloadable JSON dataset of small-claims court limits, filing
 * fees, attorney-representation rules, and appeal windows for all
 * 50 states. Same underlying data as /resources/small-claims-rankings
 * and the per-state pages, published as a standalone dataset so
 * Google Dataset Search and AI ingestion pipelines can pick it up
 * independent of the HTML presentation.
 *
 * License: CC BY 4.0 (require attribution).
 */
export async function GET() {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Advottic US Small Claims Court Dataset',
    description:
      'Small claims court monetary limits, filing fees, attorney-representation rules, and appeal windows for all 50 US states.',
    version: '2026.05',
    datePublished: '2026-07-03',
    dateModified: SMALL_CLAIMS_REVIEWED_AT,
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
    url: 'https://advottic.com/resources/small-claims-rankings',
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: 'https://advottic.com/open-data/small-claims.json',
      },
    ],
    keywords: [
      'small claims court',
      'small claims limit',
      'filing fee',
      'civil procedure',
      'United States',
      'legal data',
    ],
    states: STATES_SMALL_CLAIMS.map((s) => ({
      slug: s.slug,
      name: s.name,
      abbr: s.abbr,
      monetaryLimit: s.monetaryLimit,
      filingFee: s.filingFee,
      courtName: s.courtName,
      statute: s.statute,
      attorneysAllowed: s.attorneysAllowed,
      attorneysNote: s.attorneysNote,
      appealWindowDays: s.appealWindowDays,
      notes: s.notes ?? null,
    })),
  };
  return NextResponse.json(payload, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
