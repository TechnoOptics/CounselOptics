import { headers } from 'next/headers';
import { CHANGELOG } from '@/lib/changelog';

const SITE_URL = 'https://advottic.com';

/**
 * /feed.xml - RSS 2.0 feed of the most recent changelog entries.
 *
 * Why ship this when /sitemap.xml + JSON-LD already cover indexing:
 * RSS readers (Feedly, Inoreader, NewsBlur), AI ingestion pipelines
 * (some Common Crawl spinoffs, certain LLM training datasets), and
 * tech-press monitoring tools all watch RSS feeds first. A live RSS
 * feed gives them a single subscribable surface for "what's new at
 * Advottic" without having to scrape the changelog page.
 *
 * Host-aware: only served on the apex. Tenant subdomains get 404 so
 * subscription clients always land on the canonical brand feed.
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
  const items = CHANGELOG.map((entry) => {
    const link = entry.link
      ? `${SITE_URL}${entry.link}`
      : `${SITE_URL}/changelog#${entry.slug}`;
    // RSS pubDate must be RFC-822. We anchor the date at noon UTC so
    // the same entry doesn't sort-jump across reader timezones.
    const pubDate = new Date(`${entry.date}T12:00:00Z`).toUTCString();
    return `    <item>
      <title>${escape(entry.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="false">advottic-changelog-${entry.slug}</guid>
      <pubDate>${pubDate}</pubDate>
      <category>${escape(entry.category)}</category>
      <description>${escape(entry.summary)}</description>
    </item>`;
  }).join('\n');

  const lastBuildDate = new Date(`${latest}T12:00:00Z`).toUTCString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Advottic changelog</title>
    <link>${SITE_URL}/changelog</link>
    <atom:link href="${SITE_URL}/feed.xml" rel="self" type="application/rss+xml" />
    <description>Everything we've shipped on Advottic, in chronological order. Personal-safety features, AI updates, firm-side launches.</description>
    <language>en-us</language>
    <copyright>Techno Optics LLC</copyright>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <generator>Advottic</generator>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
