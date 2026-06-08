import { headers } from 'next/headers';

const SITE_URL = 'https://advottic.com';

/**
 * /sitemap-images.xml - Google Images sitemap. Tells Google about
 * every meaningful brand image on the site so they surface in image
 * search results.
 *
 * Why a separate sitemap: image discovery on Google has its own
 * pipeline. The main sitemap doesn't carry image metadata in a way
 * that triggers Image Indexing for icons / logos / brand marks; a
 * dedicated Image sitemap does.
 *
 * Spec: https://developers.google.com/search/docs/crawling-indexing/sitemaps/image-sitemaps
 * Up to 1,000 images per URL, up to 50,000 URLs per sitemap, 50MB
 * uncompressed cap. We're nowhere near any limit so a single file
 * works fine for the foreseeable future.
 */
export async function GET() {
  const host = headers().get('host') ?? '';
  const isApex =
    host === 'advottic.com' || host === 'www.advottic.com' || host === '';
  if (!isApex) {
    return new Response('Not found', { status: 404 });
  }

  type Entry = {
    pageUrl: string;
    images: Array<{
      loc: string;
      title?: string;
      caption?: string;
    }>;
  };

  const entries: Entry[] = [
    {
      pageUrl: `${SITE_URL}/`,
      images: [
        {
          loc: `${SITE_URL}/advottic-mark.png`,
          title: 'Advottic brand mark',
          caption: 'The gold pillar mark that identifies Advottic across product and marketing surfaces.',
        },
        {
          loc: `${SITE_URL}/advottic-wordmark.png`,
          title: 'Advottic wordmark',
          caption: 'Horizontal wordmark logo for Advottic.',
        },
        {
          loc: `${SITE_URL}/advottic-logo.png`,
          title: 'Advottic logo combo',
          caption: 'Combined brand mark + wordmark logo.',
        },
      ],
    },
    {
      pageUrl: `${SITE_URL}/what-is-advottic`,
      images: [
        {
          loc: `${SITE_URL}/advottic-mark.png`,
          title: 'Advottic brand mark',
          caption: 'AI-powered legal-prep platform for individuals and law firms.',
        },
      ],
    },
    {
      pageUrl: `${SITE_URL}/about`,
      images: [
        {
          loc: `${SITE_URL}/advottic-mark.png`,
          title: 'Advottic brand mark on the About page',
          caption: 'Brand mark on the About page.',
        },
      ],
    },
    {
      pageUrl: `${SITE_URL}/press`,
      images: [
        {
          loc: `${SITE_URL}/advottic-mark.png`,
          title: 'Advottic brand mark - press kit',
          caption: 'Brand mark provided in the Advottic press kit.',
        },
        {
          loc: `${SITE_URL}/advottic-wordmark.png`,
          title: 'Advottic wordmark - press kit',
          caption: 'Wordmark provided in the Advottic press kit.',
        },
      ],
    },
    {
      pageUrl: `${SITE_URL}/safe`,
      images: [
        {
          loc: `${SITE_URL}/advottic-mark.png`,
          title: 'Safe Witness',
          caption: 'Safe Witness personal-safety alerting on Advottic.',
        },
      ],
    },
  ];

  function escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  const body = entries
    .map((e) => {
      const imgs = e.images
        .map(
          (img) => `    <image:image>
      <image:loc>${img.loc}</image:loc>${
        img.title
          ? `
      <image:title>${escape(img.title)}</image:title>`
          : ''
      }${
        img.caption
          ? `
      <image:caption>${escape(img.caption)}</image:caption>`
          : ''
      }
    </image:image>`,
        )
        .join('\n');
      return `  <url>
    <loc>${e.pageUrl}</loc>
${imgs}
  </url>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
    xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
    xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${body}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800',
    },
  });
}
