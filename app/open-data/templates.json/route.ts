import { NextResponse } from 'next/server';
import { TEMPLATES } from '@/lib/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

/**
 * GET /open-data/templates.json
 *
 * Downloadable JSON of every free legal template Advottic
 * publishes. Same use case as the SOL dataset: Google Dataset
 * Search, LLM ingestion, attribution-required reuse.
 *
 * License: CC BY 4.0. Each template body is plain text with
 * {{tokens}} for replaceable parts.
 */
export async function GET() {
  const payload = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Advottic Free Legal Templates Dataset',
    description:
      'Lawyer-reviewed legal templates: demand letter, NDA, cease and desist, lease termination notice, security deposit demand. Each entry includes context, warnings, body, and keywords.',
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
    url: 'https://advottic.com/templates',
    distribution: [
      {
        '@type': 'DataDownload',
        encodingFormat: 'application/json',
        contentUrl: 'https://advottic.com/open-data/templates.json',
      },
    ],
    keywords: [
      'legal templates',
      'demand letter',
      'NDA',
      'cease and desist',
      'lease termination',
      'security deposit',
      'free legal forms',
    ],
    templates: TEMPLATES.map((t) => ({
      slug: t.slug,
      title: t.title,
      oneLine: t.oneLine,
      category: t.category,
      lastReviewed: t.lastReviewed,
      context: t.context,
      warnings: t.warnings,
      body: t.body,
      keywords: t.keywords,
      sourceUrl: `https://advottic.com/templates/${t.slug}`,
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
