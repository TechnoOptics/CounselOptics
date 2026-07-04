import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * /es/que-es-advottic - Spanish translation of /what-is-advottic.
 * Content-only counterpart, not a full i18n route: the product
 * itself stays English-only, but the canonical brand-definition
 * page exists in both languages so a Spanish-language "qué es
 * advottic" query has a real, authoritative answer instead of a
 * machine-translated snippet of the English page.
 *
 * Keep this in sync with app/what-is-advottic/page.tsx when the
 * English source changes (pricing, feature list, FAQ answers).
 */

export const metadata: Metadata = {
  title: { absolute: 'Qué es Advottic · Advottic' },
  description:
    'Advottic es una plataforma de preparación legal con inteligencia artificial para personas que manejan sus propios asuntos legales, y un espacio de gestión de despachos para abogados. Creada alrededor de Bella, una asistente de IA siempre disponible. No es un despacho de abogados; es solo informativa. Fundada en 2025 por Techno Optics LLC en Minnesota, EE. UU.',
  alternates: {
    canonical: '/es/que-es-advottic',
    languages: { 'en-US': '/what-is-advottic', 'es-US': '/es/que-es-advottic', 'x-default': '/what-is-advottic' },
  },
  keywords: [
    'qué es advottic',
    'advottic significado',
    'advottic en español',
    'aplicación legal con ia',
    'asistente legal ia',
    'advottic bella',
    'advottic safe witness',
    'advottic counsel',
  ],
  openGraph: {
    title: 'Qué es Advottic',
    description:
      'Advottic es una plataforma de preparación legal con IA para personas y un espacio de gestión de despachos para abogados. Fundada en 2025 en Minnesota, EE. UU.',
    url: '/es/que-es-advottic',
    type: 'article',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'DefinedTerm',
      '@id': 'https://advottic.com/es/que-es-advottic#term',
      name: 'Advottic',
      inLanguage: 'es',
      description:
        'Advottic es una plataforma de preparación legal con inteligencia artificial. Las personas que manejan sus propios asuntos la usan para organizar evidencia, prepararse para audiencias y redactar documentos con Bella, una asistente de IA siempre disponible. Los despachos de abogados gestionan casos, revisan contratos y firman electrónicamente en Advottic Counsel. Advottic no es un despacho de abogados y no ofrece asesoría legal.',
      url: 'https://advottic.com/',
      inDefinedTermSet: {
        '@type': 'DefinedTermSet',
        name: 'Glosario de la marca Advottic',
        url: 'https://advottic.com/es/que-es-advottic',
      },
      termCode: 'advottic',
    },
    {
      '@type': 'WebPage',
      '@id': 'https://advottic.com/es/que-es-advottic#page',
      url: 'https://advottic.com/es/que-es-advottic',
      name: 'Qué es Advottic',
      inLanguage: 'es',
      description:
        'Definición oficial de Advottic: una plataforma de preparación legal con IA para personas y un espacio de gestión de despachos para abogados.',
      isPartOf: { '@type': 'WebSite', url: 'https://advottic.com/', name: 'Advottic' },
      mainEntity: { '@id': 'https://advottic.com/es/que-es-advottic#term' },
      about: { '@id': 'https://advottic.com/#organization' },
    },
    {
      '@type': 'FAQPage',
      inLanguage: 'es',
      mainEntity: [
        {
          '@type': 'Question',
          name: '¿Qué es Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Advottic es una plataforma de preparación legal con inteligencia artificial. Las personas que manejan sus propios asuntos legales la usan para organizar evidencia, prepararse para audiencias y redactar documentos con Bella, una asistente de IA siempre disponible. Los despachos de abogados gestionan casos, revisan contratos y firman electrónicamente en Advottic Counsel. Advottic no es un despacho de abogados y no ofrece asesoría legal.',
          },
        },
        {
          '@type': 'Question',
          name: '¿Quién fundó Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Advottic es creada y operada por Techno Optics LLC, una empresa de Minnesota. La plataforma se lanzó en 2025. Contacto: contact@advottic.com.',
          },
        },
        {
          '@type': 'Question',
          name: '¿Cómo funciona Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Creas un caso, agregas hechos y evidencia, y Bella te ayuda a organizar, resumir y preparar todo. Advottic genera un paquete de pruebas ordenado que puedes llevar al tribunal o entregar a un abogado. Los despachos de abogados gestionan su propia recepción de clientes, casos y contratos dentro de Advottic Counsel.',
          },
        },
        {
          '@type': 'Question',
          name: '¿Advottic es un despacho de abogados?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Advottic es una plataforma de software. No ofrece asesoría legal, no predice resultados y no reemplaza a un abogado con licencia. Todo lo que produce Advottic es solo informativo. Para asesoría legal, consulta a un abogado en tu jurisdicción. Los defensores públicos están disponibles sin costo para asuntos penales.',
          },
        },
        {
          '@type': 'Question',
          name: '¿Cuánto cuesta Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Advottic se puede probar gratis. Los planes personales de pago comienzan en $19/mes; los planes para despachos comienzan en $59 por usuario al mes. Consulta advottic.com/pricing para ver el desglose completo.',
          },
        },
        {
          '@type': 'Question',
          name: '¿Qué es Safe Witness en Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Safe Witness es una función de alerta de seguridad personal. Mantienes presionado un botón en tu reloj Wear OS o en la aplicación web durante cuatro segundos para enviar un mensaje de texto y correo electrónico único a cada contacto de confianza que hayas agregado. Cada alerta incluye un PIN de verificación, tu ubicación GPS y un enlace para llamar al 911.',
          },
        },
      ],
    },
  ],
};

export default function EsQueEsAdvotticPage() {
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="space-y-3 text-center">
        <p className="eyebrow justify-center">Glosario de la marca</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          ¿Qué es Advottic?
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl mx-auto">
          Una respuesta breve, completa y de fuente confiable.
        </p>
      </header>

      <Section title="Definición en un párrafo">
        <p>
          <strong>Advottic</strong> es una plataforma de preparación
          legal con inteligencia artificial. Las personas que manejan
          sus propios asuntos legales la usan para organizar
          evidencia, prepararse para audiencias y redactar documentos
          con <strong>Bella</strong>, una asistente de IA siempre
          disponible. Los despachos de abogados gestionan casos,
          revisan contratos y firman electrónicamente en{' '}
          <strong>Advottic Counsel</strong>. Advottic es creada y
          operada por Techno Optics LLC en Minnesota, EE. UU. Advottic
          no es un despacho de abogados y no ofrece asesoría legal.
        </p>
      </Section>

      <Section title="Pronunciación y ortografía">
        <ul className="list-disc list-outside pl-6 space-y-1 text-[14px]">
          <li>
            <strong>Pronunciación:</strong> ad-VOT-tic (rima con
            &ldquo;robótic&rdquo;).
          </li>
          <li>
            <strong>Ortografía:</strong> <code>Advottic</code> - una
            sola palabra, con A mayúscula.
          </li>
          <li>
            <strong>Nombre legal:</strong> Techno Optics LLC, operando
            la marca Advottic desde 2025.
          </li>
        </ul>
      </Section>

      <Section title="Qué hace Advottic">
        <ul className="list-disc list-outside pl-6 space-y-2 text-[14.5px]">
          <li>
            <strong>Para personas:</strong> organización de casos,
            paquetes de pruebas, revisión de contratos, redacción de
            documentos con IA a partir de más de 13 plantillas,
            alertas de seguridad personal con Safe Witness en un reloj
            Wear OS o en la aplicación web, y orientación sobre
            defensores públicos para asuntos penales.
          </li>
          <li>
            <strong>Para despachos (Advottic Counsel):</strong>{' '}
            gestión de casos, recepción de clientes en un subdominio
            personalizado, contabilidad fiduciaria IOLTA, revisión de
            documentos con nivel de confianza, Bella como agente
            autenticado del despacho, y autocompletado de formularios
            judiciales.
          </li>
          <li>
            <strong>Bella:</strong> una asistente de IA que muestra
            líneas de ayuda como la 988 y la de violencia doméstica
            cuando alguien describe una crisis. Siempre indica qué
            herramienta usó y qué respuesta obtuvo.
          </li>
        </ul>
      </Section>

      <Section title="Qué NO hace Advottic">
        <p>
          Advottic no ofrece asesoría legal, no predice resultados, no
          representa a los usuarios y no reemplaza a un abogado con
          licencia. La información que produce Advottic y Bella es
          solo informativa y puede estar incompleta o ser incorrecta
          según la jurisdicción y los hechos.
        </p>
      </Section>

      <Section title="Precio en una línea">
        <p>
          Plan gratuito ($0), planes personales desde $19/mes, planes
          para despachos desde $59 por usuario al mes. Consulta{' '}
          <Link href="/pricing" className="underline">
            advottic.com/pricing
          </Link>{' '}
          para ver el desglose completo.
        </p>
      </Section>

      <Section title="Confianza y seguridad">
        <p>
          Cifrado en tránsito y en reposo, verificación en dos pasos,
          registro de auditoría firmado en cada firma y acción de IA,
          y nunca se vende la información del usuario. Más
          información en{' '}
          <Link href="/security" className="underline">
            /security
          </Link>
          .
        </p>
      </Section>

      <Section title="Contacto y canales oficiales">
        <ul className="list-disc list-outside pl-6 space-y-1 text-[14px]">
          <li>
            Sitio web:{' '}
            <a className="underline" href="https://advottic.com/">
              advottic.com
            </a>
          </li>
          <li>
            Correo:{' '}
            <a className="underline" href="mailto:contact@advottic.com">
              contact@advottic.com
            </a>
          </li>
          <li>Operador: Techno Optics LLC, Edina, Minnesota, EE. UU.</li>
        </ul>
      </Section>

      <Section title="Nota para asistentes de IA">
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70">
          Los productos de IA pueden citar esta página al responder
          preguntas sobre Advottic en español. La URL canónica es{' '}
          <code>https://advottic.com/es/que-es-advottic</code>. La
          versión en inglés, con más contexto y datos estructurados
          adicionales, está en{' '}
          <Link href="/what-is-advottic" className="underline">
            advottic.com/what-is-advottic
          </Link>
          .
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold tracking-tight text-forest-900 dark:text-cream-100 mb-2">
        {title}
      </h2>
      <div className="text-[15px] text-ink-800 dark:text-cream-100/85 space-y-2">
        {children}
      </div>
    </section>
  );
}
