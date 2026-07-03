import type { Metadata } from 'next';
import Link from 'next/link';
import { BreadcrumbJsonLd } from '@/components/seo/JsonLd';

export const dynamic = 'force-static';

const TITLE = 'Advottic en español - preparación legal con IA';
const DESCRIPTION =
  'Advottic ayuda a personas hispanohablantes a organizar su caso, prepararse para audiencias y redactar documentos con Bella, una asistente de IA. Guías y plantillas gratis en español.';

export const metadata: Metadata = {
  title: { absolute: `${TITLE} · Advottic` },
  description: DESCRIPTION,
  alternates: {
    canonical: '/es',
    languages: { 'en-US': '/', 'es-US': '/es' },
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: '/es',
    type: 'website',
  },
};

/**
 * /es - Spanish-language hub. Not a mirrored, fully-translated
 * product (the app itself is English-only today) - this is a
 * content landing page that collects every Spanish-language page
 * that exists (brand definition, guides, templates) and is honest
 * that the product UI is in English once you sign in. Serves the
 * "advottic en español" / "aplicación legal en español" search
 * intent and gives Spanish-speaking LLM queries a real page to
 * land on instead of nothing.
 */
export default function EsHubPage() {
  return (
    <div className="space-y-14 sm:space-y-16 pb-20 animate-fade-up">
      <BreadcrumbJsonLd items={[{ name: 'Advottic', href: '/' }, { name: 'Español', href: '/es' }]} />

      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4 sm:pt-8 px-4">
        <p className="eyebrow justify-center">Advottic en español</p>
        <h1 className="font-display text-[36px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Prepara tu caso legal, con calma.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Advottic te ayuda a organizar evidencia, prepararte para una
          audiencia y redactar documentos con Bella, una asistente de
          IA siempre disponible. Estas páginas están en español; la
          aplicación en sí funciona en inglés después de iniciar
          sesión.
        </p>
        <div className="pt-2">
          <Link href="/sign-in?next=/cases" className="btn-primary">
            Crear una cuenta gratis
          </Link>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-4 sm:px-6 grid sm:grid-cols-3 gap-4">
        <Link
          href="/es/que-es-advottic"
          className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 hover:bg-cream-50/60 dark:hover:bg-forest-900/60 transition-colors"
        >
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Empieza aquí
          </p>
          <p className="mt-1.5 font-display text-xl text-forest-900 dark:text-cream-100">
            ¿Qué es Advottic?
          </p>
          <p className="mt-1 text-[13.5px] text-ink-600 dark:text-cream-100/70">
            La definición oficial de la marca, en español.
          </p>
        </Link>
        <Link
          href="/es/guias"
          className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 hover:bg-cream-50/60 dark:hover:bg-forest-900/60 transition-colors"
        >
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Guías gratis
          </p>
          <p className="mt-1.5 font-display text-xl text-forest-900 dark:text-cream-100">
            Respuestas a preguntas específicas
          </p>
          <p className="mt-1 text-[13.5px] text-ink-600 dark:text-cream-100/70">
            Desalojo, violencia doméstica, y más.
          </p>
        </Link>
        <Link
          href="/es/plantillas"
          className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 p-5 hover:bg-cream-50/60 dark:hover:bg-forest-900/60 transition-colors"
        >
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Plantillas gratis
          </p>
          <p className="mt-1.5 font-display text-xl text-forest-900 dark:text-cream-100">
            Documentos listos para usar
          </p>
          <p className="mt-1 text-[13.5px] text-ink-600 dark:text-cream-100/70">
            Carta de demanda, sin registro.
          </p>
        </Link>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-4">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Lo que hace Advottic
        </h2>
        <ul className="space-y-2 text-[14.5px] leading-relaxed list-disc list-outside pl-5">
          <li>
            <strong>Bella:</strong> una asistente de IA siempre
            disponible que resume tu caso, redacta documentos y
            responde preguntas de preparación legal.
          </li>
          <li>
            <strong>Organización del caso:</strong> agrega hechos y
            evidencia, y exporta un paquete de pruebas ordenado para
            llevar al tribunal.
          </li>
          <li>
            <strong>Safe Witness:</strong> un botón de seguridad
            personal que envía tu ubicación a tus contactos de
            confianza cuando lo necesitas.
          </li>
        </ul>
        <p className="text-[13px] text-ink-500 dark:text-cream-100/60">
          Advottic no es un despacho de abogados y no ofrece asesoría
          legal. Es una herramienta informativa para ayudarte a
          prepararte.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 text-center text-[13px] text-ink-500 dark:text-cream-100/60">
        <p>
          Read this site in English:{' '}
          <Link href="/" className="underline">
            advottic.com
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
