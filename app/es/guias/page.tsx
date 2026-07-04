import type { Metadata } from 'next';
import Link from 'next/link';
import { ES_GUIDES } from '@/lib/es-guides';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: { absolute: 'Guías legales en español · Advottic' },
  description:
    'Respuestas claras a preguntas legales específicas: qué hacer si tu arrendador te quiere desalojar, o si alguien te está haciendo daño. Gratis, sin necesidad de cuenta.',
  alternates: {
    canonical: '/es/guias',
    languages: { 'en-US': '/guides', 'es-US': '/es/guias', 'x-default': '/guides' },
  },
  openGraph: {
    title: 'Guías legales de Advottic en español',
    description:
      'Respuestas claras a preguntas legales específicas, con pasos a seguir y las líneas de ayuda correctas.',
    url: '/es/guias',
    type: 'article',
  },
};

export default function EsGuidesIndexPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': 'https://advottic.com/es/guias#page',
    name: 'Guías legales de Advottic en español',
    url: 'https://advottic.com/es/guias',
    inLanguage: 'es',
    hasPart: ES_GUIDES.map((g) => ({
      '@type': 'Article',
      '@id': `https://advottic.com/es/guias/${g.slug}#article`,
      headline: g.title,
      description: g.oneLine,
      url: `https://advottic.com/es/guias/${g.slug}`,
      datePublished: g.lastReviewed,
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
        <p className="eyebrow">Guías en español</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Preguntas específicas, respuestas claras.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl">
          Cada guía es una lista tranquila de pasos para un momento
          legal específico: qué hacer hoy, qué hacer esta semana, y a
          qué líneas de ayuda llamar si es urgente. Esto no es
          asesoría legal.
        </p>
      </header>

      <ul className="space-y-5">
        {ES_GUIDES.map((g) => (
          <li key={g.slug} className="border-l-2 border-gold-metal/40 pl-5 py-1">
            <p className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55 font-semibold mb-1">
              {g.category}
            </p>
            <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100 mb-1">
              <Link href={`/es/guias/${g.slug}`} className="hover:underline">
                {g.title}
              </Link>
            </h2>
            <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
              {g.oneLine}{' '}
              <Link
                href={`/es/guias/${g.slug}`}
                className="underline text-forest-900 dark:text-cream-100 font-medium"
              >
                Leer la guía &rarr;
              </Link>
            </p>
          </li>
        ))}
      </ul>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[13px] text-ink-600 dark:text-cream-100/65">
        <p>
          Estas guías son solo informativas y no constituyen
          asesoría legal. Consulta a un abogado con licencia en tu
          jurisdicción antes de actuar según lo aquí descrito.
        </p>
        <p className="mt-2">
          Read in English:{' '}
          <Link href="/guides" className="underline">
            advottic.com/guides
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
