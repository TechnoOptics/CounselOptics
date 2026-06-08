import { headers } from 'next/headers';
import { CHANGELOG } from '@/lib/changelog';

const SITE_URL = 'https://advottic.com';

/**
 * /atom.xml - Atom 1.0 feed counterpart to /feed.xml. Same payload,
 * different schema. Atom is the format Mastodon, modern feed
 * aggregators, and a chunk of the academic-research tooling prefer
 * over RSS - shipping both maximizes reach with very little code.
 *
 * Host-aware: only served on the apex.
 */
export async function GET() {
  const host = headers().get('host') ?? '';
  const isApex =
    host === 'advottic.com' || host === 'www.advottic.com' || host === '';
  if (!isApex) {
    return new Response('Not found', { status: 404 });
  }

  function escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  const latest = CHANGELOG[0]?.date ?? new Date().toISOString().slice(0, 10);
  const updated = new Date(`${latest}T12:00:00Z`).toISOString();

  const entries = CHANGELOG.map((entry) => {
    const link = entry.link
      ? `${SITE_URL}${entry.link}`
      : `${SITE_URL}/changelog#${entry.slug}`;
    const published = new Date(`${entry.date}T12:00:00Z`).toISOString();
    return `  <entry>
    <title>${escape(entry.title)}</title>
    <link href="${link}" />
    <id>tag:advottic.com,2026:changelog/${entry.slug}</id>
    <updated>${published}</updated>
    <published>${published}</published>
    <category term="${escape(entry.category)}" />
    <summary>${escape(entry.summary)}</summary>
  </entry>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Advottic changelog</title>
  <link href="${SITE_URL}/changelog" rel="alternate" type="text/html" />
  <link href="${SITE_URL}/atom.xml" rel="self" type="application/atom+xml" />
  <id>tag:advottic.com,2026:changelog</id>
  <updated>${updated}</updated>
  <author>
    <name>Advottic</name>
    <email>contact@advottic.com</email>
    <uri>${SITE_URL}</uri>
  </author>
  <subtitle>Everything we've shipped on Advottic, in chronological order.</subtitle>
  <rights>Techno Optics LLC</rights>
${entries}
</feed>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/atom+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
