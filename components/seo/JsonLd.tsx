/**
 * Schema.org JSON-LD components. Drop these into a server component
 * (mostly page.tsx files in app/) and they emit a <script
 * type="application/ld+json"> tag with the right shape for Google
 * to render rich results.
 *
 * What rich results buy you:
 *   - <Organization> + <WebSite> show your logo + sitelinks search
 *     box on brand SERPs.
 *   - <SoftwareApplication> + <Product> + <Offer> qualify a page
 *     for the price + rating snippet on category SERPs.
 *   - <FAQPage> renders the expandable Q+A directly in search
 *     results, dramatically lifting CTR.
 *   - <BreadcrumbList> shows the breadcrumb path in the SERP
 *     snippet instead of a raw URL.
 *   - <Article> with author + datePublished qualifies for the
 *     "Top stories" + "Web Results" carousels.
 *
 * Always keep the structured data IN SYNC with the visible page.
 * Google penalizes mismatches; eg. don't claim a price in JSON-LD
 * that doesn't appear on the page.
 */

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://www.advottic.com');

function emit(payload: unknown) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify is safe; no user input flows in here.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(payload) }}
    />
  );
}

/**
 * Site-wide Organization + WebSite schema. Mount once in
 * app/layout.tsx; surfaces on every page.
 */
export function SiteJsonLd() {
  return (
    <>
      {emit({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Advottic',
        legalName: 'Techno Optics LLC',
        url: SITE_URL,
        logo: `${SITE_URL}/advottic-wordmark.png`,
        description:
          'AI-powered legal platform. Personal users handle their own matters with Bella, an always-on AI legal assistant. Law firms run their entire practice on Advottic Counsel.',
        sameAs: [
          'https://twitter.com/advottic',
          'https://www.linkedin.com/company/advottic',
        ],
        contactPoint: [
          {
            '@type': 'ContactPoint',
            contactType: 'customer support',
            email: 'support@advottic.com',
            availableLanguage: ['English'],
          },
          {
            '@type': 'ContactPoint',
            contactType: 'sales',
            email: 'sales@advottic.com',
            availableLanguage: ['English'],
          },
          {
            '@type': 'ContactPoint',
            contactType: 'security',
            email: 'security@advottic.com',
            availableLanguage: ['English'],
          },
        ],
      })}
      {emit({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Advottic',
        url: SITE_URL,
        potentialAction: {
          '@type': 'SearchAction',
          target: `${SITE_URL}/resources?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      })}
    </>
  );
}

/**
 * SoftwareApplication + offers for the Advottic platform. Mount on
 * the home page so the SERP listing for "Advottic" shows the price
 * range + rating + category.
 */
export function AppJsonLd({
  ratingValue,
  ratingCount,
}: {
  ratingValue?: string;
  ratingCount?: number;
} = {}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Advottic',
    operatingSystem: 'Web, iOS, Android',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'LegalSoftware',
    description:
      'AI-powered legal platform with case management, contract review, e-signature, and document drafting for individuals and law firms.',
    url: SITE_URL,
    image: `${SITE_URL}/advottic-wordmark.png`,
    offers: [
      {
        '@type': 'Offer',
        name: 'Personal Pro',
        price: '19',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '19',
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        url: `${SITE_URL}/pricing`,
      },
      {
        '@type': 'Offer',
        name: 'Personal Plus',
        price: '39',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '39',
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        url: `${SITE_URL}/pricing`,
      },
      {
        '@type': 'Offer',
        name: 'Counsel Solo',
        price: '59',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '59',
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        url: `${SITE_URL}/pricing`,
      },
      {
        '@type': 'Offer',
        name: 'Counsel Small Firm',
        price: '99',
        priceCurrency: 'USD',
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price: '99',
          priceCurrency: 'USD',
          unitText: 'MONTH',
        },
        url: `${SITE_URL}/pricing`,
      },
    ],
    ...(ratingValue && ratingCount
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue,
            ratingCount,
          },
        }
      : {}),
  });
}

/**
 * FAQ schema. Renders as the expandable Q+A directly in Google
 * SERP for product / pricing pages.
 */
export function FaqJsonLd({
  questions,
}: {
  questions: Array<{ q: string; a: string }>;
}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((qa) => ({
      '@type': 'Question',
      name: qa.q,
      acceptedAnswer: { '@type': 'Answer', text: qa.a },
    })),
  });
}

/**
 * BreadcrumbList for nested pages. Shows the path in SERPs instead
 * of a long URL string.
 */
export function BreadcrumbJsonLd({
  items,
}: {
  items: Array<{ name: string; href: string }>;
}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.href.startsWith('http') ? it.href : `${SITE_URL}${it.href}`,
    })),
  });
}

/**
 * Article schema for blog / resource posts. Drives "Top stories"
 * + carousel placements when the article performs.
 */
export function ArticleJsonLd({
  title,
  description,
  slug,
  publishedAt,
  updatedAt,
  authorName = 'Advottic Editorial',
  imageUrl,
}: {
  title: string;
  description: string;
  slug: string;
  publishedAt: string;
  updatedAt?: string;
  authorName?: string;
  imageUrl?: string;
}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    image: imageUrl ? [imageUrl] : [`${SITE_URL}/advottic-wordmark.png`],
    datePublished: publishedAt,
    dateModified: updatedAt ?? publishedAt,
    author: { '@type': 'Person', name: authorName },
    publisher: {
      '@type': 'Organization',
      name: 'Advottic',
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/advottic-wordmark.png`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/resources/${slug}`,
    },
  });
}

/**
 * Service schema. Use on /find-counsel and similar routes that
 * describe a service offering.
 */
export function ServiceJsonLd({
  name,
  description,
  serviceType,
  area = 'United States',
}: {
  name: string;
  description: string;
  serviceType: string;
  area?: string;
}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name,
    description,
    serviceType,
    provider: { '@type': 'Organization', name: 'Advottic' },
    areaServed: { '@type': 'Country', name: area },
    url: SITE_URL,
  });
}
