import type { Metadata } from 'next';
import Link from 'next/link';
import { ES_TEMPLATES } from '@/lib/es-templates';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: 'Plantillas legales gratis en español · Advottic' },
  description:
    'Plantillas legales gratuitas en español, revisadas por abogados: carta de demanda y más. Sin registro, sin dar tu correo electrónico.',
  alternates: {
    canonical: '/es/plantillas',
    languages: { 'en-US': '/templates', 'es-US': '/es/plantillas' },
  },
  openGraph: {
    title: 'Plantillas legales gratis de Advottic en español',
    description:
      'Plantillas listas para copiar y editar, revisadas por abogados. Sin registro.',
    url: '/es/plantillas',
    type: 'article',
  },
};

export default function EsTemplatesIndexPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': 'https://advottic.com/es/plantillas#page',
    name: 'Plantillas legales gratis de Advottic en español',
    url: 'https://advottic.com/es/plantillas',
    inLanguage: 'es',
    hasPart: ES_TEMPLATES.map((t) => ({
      '@type': 'Article',
      '@id': `https://advottic.com/es/plantillas/${t.slug}#article`,
      headline: t.title,
      description: t.oneLine,
      url: `https://advottic.com/es/plantillas/${t.slug}`,
      datePublished: t.lastReviewed,
      inLanguage: 'es',
    })),
  };
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-8 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="space-y-2">
        <p className="eyebrow">Plantillas en español</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Plantillas legales gratis. Sin dar tu correo.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl">
          Cada plantilla está revisada por abogados, lista para
          copiar y editar, e incluye las advertencias que importan.
        </p>
      </header>

      <ul className="space-y-5">
        {ES_TEMPLATES.map((t) => (
          <li key={t.slug} className="border-l-2 border-gold-metal/40 pl-5 py-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55 font-semibold mb-1">
              {t.category}
            </p>
            <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-1">
              <Link href={`/es/plantillas/${t.slug}`} className="hover:underline">
                {t.title}
              </Link>
            </h2>
            <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
              {t.oneLine}{' '}
              <Link
                href={`/es/plantillas/${t.slug}`}
                className="underline text-forest-900 dark:text-cream-100 font-medium"
              >
                Ver la plantilla &rarr;
              </Link>
            </p>
          </li>
        ))}
      </ul>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[13px] text-ink-600 dark:text-cream-100/65">
        <p>
          Estas plantillas son solo informativas y no constituyen
          asesoría legal. Consulta a un abogado con licencia en tu
          jurisdicción antes de enviar algo importante.
        </p>
        <p className="mt-2">
          Read in English:{' '}
          <Link href="/templates" className="underline">
            advottic.com/templates
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
