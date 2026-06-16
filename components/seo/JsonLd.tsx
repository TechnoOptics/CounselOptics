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
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://advottic.com');

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
 *
 * We emit THREE shapes:
 *   1. Organization - covers "what is Advottic" + brand SERP knowledge
 *      panel, founding date, employees, social links, contact tree.
 *   2. WebSite - registers the sitelinks search box and the canonical
 *      site URL so Google understands the apex is the brand home.
 *   3. ProfessionalService - tells Google this is a legal-tech SaaS,
 *      not a generic productivity app. Combined with the offers in
 *      AppJsonLd, this is what unlocks the price + category snippet.
 */
export function SiteJsonLd() {
  return (
    <>
      {emit({
        '@context': 'https://schema.org',
        '@type': 'Organization',
        '@id': `${SITE_URL}#organization`,
        name: 'Advottic',
        alternateName: ['Advottic Inc', 'Techno Optics LLC'],
        legalName: 'Techno Optics LLC',
        url: SITE_URL,
        // Google Knowledge Panel + AI crawlers use this as the brand
        // logo. It must be a roughly SQUARE image with truthful
        // dimensions - a wide wordmark gets ignored. Point at the
        // 512x512 gold-mark tile (same icon the app stores + PWA use).
        logo: {
          '@type': 'ImageObject',
          url: `${SITE_URL}/icon-512.png`,
          width: 512,
          height: 512,
        },
        image: `${SITE_URL}/opengraph-image`,
        description:
          'AI-powered legal platform. Personal users handle their own matters with Bella, an always-on AI legal assistant. Law firms run their entire practice on Advottic Counsel.',
        foundingDate: '2025',
        founder: {
          '@type': 'Person',
          name: 'Abel Muchai',
          jobTitle: 'Founder & CEO',
        },
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Minneapolis',
          addressRegion: 'MN',
          addressCountry: 'US',
        },
        sameAs: [
          'https://www.wikidata.org/wiki/Q140132010',
          'https://github.com/TechnoOptics',
          'https://github.com/TechnoOptics/legal-data',
          'https://twitter.com/advottic',
          'https://www.linkedin.com/company/advottic',
        ],
        contactPoint: [
          {
            '@type': 'ContactPoint',
            contactType: 'customer support',
            email: 'support@advottic.com',
            availableLanguage: ['English'],
            areaServed: 'US',
          },
          {
            '@type': 'ContactPoint',
            contactType: 'sales',
            email: 'sales@advottic.com',
            availableLanguage: ['English'],
            areaServed: 'US',
          },
          {
            '@type': 'ContactPoint',
            contactType: 'security',
            email: 'security@advottic.com',
            availableLanguage: ['English'],
            areaServed: 'Worldwide',
          },
          {
            '@type': 'ContactPoint',
            contactType: 'privacy',
            email: 'privacy@advottic.com',
            availableLanguage: ['English'],
          },
        ],
      })}
      {emit({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': `${SITE_URL}#website`,
        name: 'Advottic',
        alternateName: 'Advottic - Build your case',
        url: SITE_URL,
        inLanguage: 'en-US',
        publisher: { '@id': `${SITE_URL}#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/resources?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      })}
      {emit({
        '@context': 'https://schema.org',
        '@type': 'ProfessionalService',
        '@id': `${SITE_URL}#service`,
        name: 'Advottic - Legal case preparation platform',
        description:
          'AI-assisted case organization, evidence management, hearing preparation, and document review for self-represented individuals and law firms.',
        url: SITE_URL,
        image: `${SITE_URL}/opengraph-image`,
        priceRange: '$0 - $1,800 / month',
        areaServed: { '@type': 'Country', name: 'United States' },
        provider: { '@id': `${SITE_URL}#organization` },
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
    image: `${SITE_URL}/icon-512.png`,
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
    image: imageUrl ? [imageUrl] : [`${SITE_URL}/opengraph-image`],
    datePublished: publishedAt,
    dateModified: updatedAt ?? publishedAt,
    author: { '@type': 'Person', name: authorName },
    publisher: {
      '@type': 'Organization',
      name: 'Advottic',
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/icon-512.png`,
        width: 512,
        height: 512,
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

/**
 * ItemList schema for hub / index pages (e.g. /resources,
 * /resources/states, /compare). Tells Google "this page is a curated
 * list of N items" which unlocks the carousel SERP treatment for
 * navigational queries.
 */
export function ItemListJsonLd({
  items,
  listName,
}: {
  items: Array<{ name: string; href: string }>;
  listName?: string;
}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    ...(listName ? { name: listName } : {}),
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      url: it.href.startsWith('http') ? it.href : `${SITE_URL}${it.href}`,
    })),
  });
}

/**
 * Product schema for the /pricing page. Combined with offers, gives
 * the SERP the price + currency snippet on commercial queries like
 * "advottic pricing" or "legal case software cost".
 */
export function PricingProductJsonLd({
  ratingValue,
  ratingCount,
}: {
  ratingValue?: string;
  ratingCount?: number;
} = {}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Advottic',
    description:
      'AI-powered case organization and contract review for individuals and law firms. Six tiers from $19/month personal to $1,800/month enterprise.',
    brand: { '@type': 'Brand', name: 'Advottic' },
    category: 'Legal Software',
    image: `${SITE_URL}/opengraph-image`,
    url: `${SITE_URL}/pricing`,
    offers: {
      '@type': 'AggregateOffer',
      offerCount: 6,
      lowPrice: '0',
      highPrice: '1800',
      priceCurrency: 'USD',
      url: `${SITE_URL}/pricing`,
    },
    ...(ratingValue && ratingCount
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue,
            ratingCount,
            bestRating: '5',
            worstRating: '1',
          },
        }
      : {}),
  });
}

/**
 * Comparison schema for /compare/<competitor> pages. Marks the page
 * as a comparison resource between two named entities so Google can
 * surface it for "advottic vs <competitor>" intent.
 */
export function ComparisonJsonLd({
  competitorName,
  competitorUrl,
  slug,
}: {
  competitorName: string;
  competitorUrl?: string;
  slug: string;
}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Advottic vs ${competitorName}`,
    description: `Side-by-side comparison of Advottic and ${competitorName} for legal-tech buyers. Pricing, features, security posture, and use-case fit.`,
    url: `${SITE_URL}/compare/${slug}`,
    isPartOf: { '@id': `${SITE_URL}#website` },
    primaryImageOfPage: { '@type': 'ImageObject', url: `${SITE_URL}/opengraph-image` },
    about: [
      { '@type': 'Brand', name: 'Advottic' },
      {
        '@type': 'Brand',
        name: competitorName,
        ...(competitorUrl ? { url: competitorUrl } : {}),
      },
    ],
  });
}

/**
 * LegalService schema for state small-claims pages
 * (/resources/states/<state>/small-claims). Each state page becomes a
 * jurisdiction-specific service node so Google's local SERP can surface
 * it for "small claims [state]" queries with the proper region tag.
 */
export function LegalServiceStateJsonLd({
  stateName,
  stateSlug,
  filingFeeRange,
  monetaryCap,
}: {
  stateName: string;
  stateSlug: string;
  filingFeeRange?: string;
  monetaryCap?: string;
}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'LegalService',
    name: `Small Claims Court Preparation - ${stateName}`,
    description: `${stateName} small claims court filing guide: jurisdictional cap${monetaryCap ? ` ($${monetaryCap})` : ''}, filing fees${filingFeeRange ? ` (${filingFeeRange})` : ''}, evidence prep, and hearing checklist.`,
    url: `${SITE_URL}/resources/states/${stateSlug}/small-claims`,
    areaServed: {
      '@type': 'AdministrativeArea',
      name: stateName,
      containedInPlace: { '@type': 'Country', name: 'United States' },
    },
    provider: { '@id': `${SITE_URL}#organization` },
    serviceType: 'Self-represented litigant preparation',
    audience: { '@type': 'Audience', audienceType: 'Pro se litigants' },
  });
}

/**
 * HowTo schema for resource articles that walk through a procedural
 * task (e.g. "How to file an NDA", "How to respond to an eviction
 * notice"). Drives the rich expandable "steps" treatment in SERPs.
 */
export function HowToJsonLd({
  title,
  description,
  totalTime,
  steps,
  slug,
}: {
  title: string;
  description: string;
  totalTime?: string;
  steps: Array<{ name: string; text: string }>;
  slug: string;
}) {
  return emit({
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: title,
    description,
    ...(totalTime ? { totalTime } : {}),
    url: `${SITE_URL}/resources/${slug}`,
    step: steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
    })),
  });
}
