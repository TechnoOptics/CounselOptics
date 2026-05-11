import Link from 'next/link';
import { COMPARISONS } from '@/lib/comparisons';
import { BreadcrumbJsonLd } from '@/components/seo/JsonLd';

export const metadata = {
  title: 'Advottic compared to every major legal-tech tool',
  description:
    'Honest side-by-side comparisons of Advottic against Clio, Spellbook, MyCase, Smokeball, DocuSign, Harvey, and Casetext CoCounsel. Real pricing, real features, where each tool wins.',
  alternates: { canonical: '/compare' },
  openGraph: {
    title: 'Advottic compared - honest legal-tech comparisons',
    description:
      'Honest side-by-side comparisons of Advottic against the major legal-tech tools.',
    type: 'website',
    url: '/compare',
  },
};

/**
 * Comparison hub. Lists every `/compare/[slug]` page for the
 * highest-commercial-intent SEO surface in legal-tech: brand-vs
 * search. Drives traffic from "[Competitor] alternatives" and
 * "[Competitor] vs Advottic" queries.
 *
 * Adding a new comparison: append to COMPARISONS in lib/comparisons.ts
 * and this hub auto-discovers it.
 */
export default function CompareHubPage() {
  const grouped = new Map<string, typeof COMPARISONS>();
  for (const c of COMPARISONS) {
    const list = grouped.get(c.category) ?? [];
    list.push(c);
    grouped.set(c.category, list);
  }

  return (
    <div className="space-y-16 sm:space-y-20 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Compare', href: '/compare' },
        ]}
      />
      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4 sm:pt-8 px-4">
        <p className="eyebrow justify-center">Comparisons</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Honest, side-by-side comparisons.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Real pricing. Real features. Where each tool wins, and where it
          loses. We name the competitor in the title because that&rsquo;s
          what you searched for.
        </p>
      </header>
      {Array.from(grouped.entries()).map(([category, items]) => (
        <section
          key={category}
          className="max-w-5xl mx-auto px-4 sm:px-6 space-y-5"
        >
          <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
            {category}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((c) => (
              <li key={c.slug}>
                <Link
                  href={`/compare/${c.slug}`}
                  className="block rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 hover:-translate-y-0.5 hover:shadow-md transition-all space-y-2"
                >
                  <p className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
                    Advottic vs
                  </p>
                  <p className="font-display text-xl text-forest-900 dark:text-cream-100 leading-tight">
                    {c.competitorName}
                  </p>
                  <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
                    {c.description}
                  </p>
                  <p className="text-[12px] font-medium text-forest-700 dark:text-cream-100/85">
                    Read comparison &rarr;
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Want a comparison we have not written yet?
        </h2>
        <p className="text-[14px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Email sales@advottic.com with the tool name and we will publish
          an honest side-by-side within the week.
        </p>
        <div className="pt-3">
          <Link href="/sign-in?next=/cases" className="btn-primary">
            Or just try Advottic free
          </Link>
        </div>
      </section>
    </div>
  );
}
