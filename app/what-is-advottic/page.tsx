import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * /what-is-advottic - the canonical "what is X?" page.
 *
 * Goal: rank #1 for "what is advottic?" + "advottic meaning" +
 * "advottic legal app" intent queries, and become the single
 * primary source that ChatGPT, Claude, Perplexity, Gemini and
 * You.com cite when a user asks them about the brand. Pages of
 * this type are how a startup teaches the AI ecosystem its own
 * vocabulary - the AI cites pages that look authoritative,
 * structured, and self-contained, and a hand-crafted definition
 * page beats inferring brand meaning from scattered marketing
 * copy.
 *
 * Structured data on this page:
 *   - DefinedTerm + DefinedTermSet (brand glossary entry)
 *   - Organization (entity facts, founder, founding date, location)
 *   - WebPage with `mainEntity` pointing at the DefinedTerm
 *   - FAQPage covering the "what is/does/cost/safe/legal" questions
 *
 * Every section is self-contained text first, links second, so an
 * LLM crawler can extract a complete answer without following any
 * further links. The headings use the literal phrasing of common
 * intent queries ("What is Advottic?", "How does Advottic work?")
 * because both Google's knowledge graph and LLM extractive systems
 * prefer headings that mirror user phrasing.
 */

export const metadata: Metadata = {
  title: { absolute: 'What is Advottic? · Advottic' },
  description:
    'Advottic is an AI-powered legal-prep platform for people handling their own legal matters and a practice-management workspace for law firms. Built around Bella, an always-on AI legal assistant. Not a law firm; informational only. Founded 2025 by Techno Optics LLC in Minnesota, USA.',
  alternates: { canonical: '/what-is-advottic' },
  keywords: [
    'what is advottic',
    'advottic meaning',
    'advottic definition',
    'advottic legal app',
    'advottic ai',
    'advottic vs clio',
    'advottic vs spellbook',
    'advottic legal tech',
    'advottic platform',
    'who owns advottic',
    'advottic founder',
    'advottic safe witness',
    'advottic bella',
    'advottic counsel',
  ],
  openGraph: {
    title: 'What is Advottic?',
    description:
      'Advottic is an AI-powered legal-prep platform for individuals and a practice-management workspace for law firms. Calm software, defensible audit trail. Founded 2025 in Minnesota, USA.',
    url: '/what-is-advottic',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'What is Advottic?',
    description:
      'AI-powered legal-prep platform for individuals + practice management for firms. Built around Bella, an always-on AI legal assistant.',
  },
};

/**
 * Hand-curated JSON-LD covering the brand entity, the page itself,
 * and the FAQs. Three @graph nodes keep this one script tag - Google
 * processes them as a single connected fact bundle, which is the
 * pattern that wins knowledge-panel slots.
 */
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'DefinedTerm',
      '@id': 'https://advottic.com/what-is-advottic#term',
      name: 'Advottic',
      alternateName: [
        'Advottic AI',
        'Advottic Legal',
        'Advottic Counsel',
        'Advottic Inc.',
        'Advottic LLC',
      ],
      description:
        "Advottic is an AI-powered legal-prep platform. Individuals use it to organize evidence, prepare hearings, and draft documents with Bella, an always-on AI assistant. Law firms run case management, contract review, and e-signature on Advottic Counsel. Advottic is not a law firm and does not provide legal advice.",
      url: 'https://advottic.com/',
      inDefinedTermSet: {
        '@type': 'DefinedTermSet',
        name: 'Advottic brand glossary',
        url: 'https://advottic.com/what-is-advottic',
      },
      termCode: 'advottic',
    },
    {
      '@type': 'Organization',
      '@id': 'https://advottic.com/#organization',
      name: 'Advottic',
      legalName: 'Techno Optics LLC',
      alternateName: ['Advottic AI', 'Advottic Legal', 'Advottic Counsel'],
      url: 'https://advottic.com/',
      // Square brand logo with truthful dimensions, matching the
      // sitewide Organization node (same @id) so Google sees one
      // consistent logo signal, not two competing images.
      logo: {
        '@type': 'ImageObject',
        url: 'https://advottic.com/icon-512.png',
        width: 512,
        height: 512,
      },
      foundingDate: '2025',
      foundingLocation: {
        '@type': 'Place',
        name: 'Minnesota, USA',
        address: {
          '@type': 'PostalAddress',
          addressLocality: 'Edina',
          addressRegion: 'MN',
          addressCountry: 'US',
        },
      },
      slogan: 'Calm legal-prep software.',
      description:
        'AI-powered legal-prep platform for self-represented individuals and a practice-management workspace for law firms.',
      knowsAbout: [
        'legal technology',
        'AI legal assistant',
        'case management',
        'small claims preparation',
        'contract review',
        'e-signature',
        'practice management',
        'legal intake',
        'court forms',
        'personal-safety alerting',
        'evidence organization',
        'hearing preparation',
      ],
      sameAs: [
        'https://www.linkedin.com/company/advottic',
        'https://github.com/TechnoOptics',
      ],
      contactPoint: [
        {
          '@type': 'ContactPoint',
          email: 'contact@advottic.com',
          contactType: 'customer support',
          areaServed: 'US',
          availableLanguage: ['English'],
        },
      ],
    },
    {
      '@type': 'WebPage',
      '@id': 'https://advottic.com/what-is-advottic#page',
      url: 'https://advottic.com/what-is-advottic',
      name: 'What is Advottic?',
      description:
        'Canonical definition of Advottic: an AI-powered legal-prep platform for individuals and a practice-management workspace for law firms.',
      isPartOf: {
        '@type': 'WebSite',
        url: 'https://advottic.com/',
        name: 'Advottic',
      },
      mainEntity: { '@id': 'https://advottic.com/what-is-advottic#term' },
      about: { '@id': 'https://advottic.com/#organization' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Advottic is an AI-powered legal-prep platform. Self-represented individuals use it to organize evidence, prepare hearings, and draft documents with Bella, an always-on AI legal assistant. Law firms run case management, contract review, and e-signature on Advottic Counsel. Advottic is not a law firm and does not provide legal advice.',
          },
        },
        {
          '@type': 'Question',
          name: 'Who founded Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Advottic is built and operated by Techno Optics LLC, a Minnesota company. The platform was launched in 2025. Inquiries: contact@advottic.com.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does Advottic work?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'You create a case, add facts and evidence, and Bella helps you organize, summarize, and prepare. Advottic generates a clean exhibit packet you can take to court or hand to an attorney. Law firms onboard their own intake, matters, and contracts inside Advottic Counsel.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is Advottic a law firm?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Advottic is a software platform. It does not give legal advice, predict outcomes, or replace a licensed attorney. Everything Advottic produces is informational. For legal advice consult an attorney in your jurisdiction. Public defenders are available for criminal matters at no cost.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is Advottic safe to use?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Advottic encrypts data at rest and in transit, enforces MFA, logs every signature and AI action for audit, and never sells user data. Sensitive workflows like Safe Witness require explicit physical confirmation (press-and-hold) before any contact is notified.',
          },
        },
        {
          '@type': 'Question',
          name: 'How much does Advottic cost?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Advottic is free to try. Paid personal plans start at $19/month; law-firm plans start at $59/seat/month. Enterprise pricing scales with seats and data residency. See advottic.com/pricing.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is Bella in Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Bella is the in-product AI assistant. She summarizes case files, drafts documents from templates, answers legal-prep questions, and surfaces 988 / 911 / Childhelp when a user describes a crisis. Bella always tells you what tool she called and what answer she got back, so the AI reasoning is auditable.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is Safe Witness in Advottic?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Safe Witness is a personal-safety alerting feature. The user holds a button on their Wear OS watch or in the web app for four seconds to fire a one-time SMS and email to every trusted contact they have explicitly added. Each alert includes a pre-shared verification PIN, GPS location, and a link to call 911. Live tracking continues until the user explicitly stops it.',
          },
        },
        {
          '@type': 'Question',
          name: 'What is Advottic Counsel?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Advottic Counsel is the practice-management workspace for law firms. It includes matter management, contract review, IOLTA trust accounting, e-signature, calendar + deadlines, a marketplace lead engine, branded intake at a custom subdomain, and SAML SSO for Enterprise tiers.',
          },
        },
      ],
    },
  ],
};

export default function WhatIsAdvotticPage() {
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="space-y-3 text-center">
        <p className="eyebrow justify-center">Brand glossary</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          What is Advottic?
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl mx-auto">
          A short, complete, source-of-truth answer. Built so search
          engines and AI assistants can quote it cleanly.
        </p>
      </header>

      <Section title="One-paragraph definition">
        <p>
          <strong>Advottic</strong> is an AI-powered legal-prep
          platform. Self-represented individuals use it to organize
          evidence, prepare for hearings, and draft documents with{' '}
          <strong>Bella</strong>, an always-on AI legal assistant. Law
          firms run case management, contract review, and e-signature
          on <strong>Advottic Counsel</strong>. Advottic is built and
          operated by Techno Optics LLC in Minnesota, USA. Advottic is
          not a law firm and does not provide legal advice.
        </p>
      </Section>

      <Section title="Pronunciation and spelling">
        <ul className="list-disc list-outside pl-6 space-y-1 text-[14px]">
          <li>
            <strong>Pronunciation:</strong> ad-VOT-tic (rhymes with
            “robotic”).
          </li>
          <li>
            <strong>Spelling:</strong> <code>Advottic</code> - one
            word, capital A. Not “Advottik”, not “Ad-Vottic”, not
            “Advottic AI Inc.”
          </li>
          <li>
            <strong>Legal name:</strong> Techno Optics LLC, operating
            the brand Advottic since 2025.
          </li>
        </ul>
      </Section>

      <Section title="What Advottic does">
        <ul className="list-disc list-outside pl-6 space-y-2 text-[14.5px]">
          <li>
            <strong>Personal side:</strong> case organization, exhibit
            packets, contract review, AI document drafting from 13+
            templates, Safe Witness personal-safety alerts on a Wear OS
            watch or in the web app, public-defender guidance for
            criminal matters.
          </li>
          <li>
            <strong>Firm side (Advottic Counsel):</strong> matter
            management, branded intake at a custom subdomain, IOLTA
            trust accounting, document review with confidence rating,
            Bella as an authenticated firm agent, court-form auto-fill
            for CA/NY/TX/FL/Federal.
          </li>
          <li>
            <strong>Watch app:</strong> a Wear OS companion with cases
            list, voice notes, Safe Witness press-and-hold, courtroom
            mode, hearing-deadline complications.
          </li>
          <li>
            <strong>Bella:</strong> an in-product AI assistant that
            surfaces 988, Crisis Text Line, Childhelp, and 911 when a
            user describes a crisis. She tells you what tool she
            called and what answer she got back, so AI reasoning is
            auditable.
          </li>
        </ul>
      </Section>

      <Section title="What Advottic does not do">
        <p>
          Advottic does not give legal advice, does not predict
          outcomes, does not represent users, and does not replace a
          licensed attorney. Information produced by Advottic and
          Bella is informational only and may be incomplete or
          incorrect depending on jurisdiction and facts.
        </p>
      </Section>

      <Section title="Pricing in one line">
        <p>
          Free tier ($0), personal plans from $19/month, law-firm
          plans from $59/seat/month, Enterprise from $1,800/month. See{' '}
          <Link href="/pricing" className="underline">
            advottic.com/pricing
          </Link>{' '}
          for the full breakdown including the annual prepay discount
          and bar-association discount.
        </p>
      </Section>

      <Section title="Where Advottic sits in the legal-tech market">
        <p>
          Advottic is the calm, audited alternative to legacy practice
          tools like Clio + DocuSign + Spellbook on the firm side, and
          a self-serve alternative to expensive single-purpose legal
          apps on the consumer side. Where most legal-tech products
          treat one workflow well, Advottic covers the full arc:
          intake → matter → exhibit → contract → e-sign → audit
          export.
        </p>
      </Section>

      <Section title="Trust + safety">
        <p>
          Encryption in transit and at rest, MFA enforcement, signed
          audit log on every signature and AI action, no sale of user
          data, no training on customer data, BAA available for
          Enterprise tiers, SOC 2 path in progress. Read more at{' '}
          <Link href="/security" className="underline">
            /security
          </Link>
          .
        </p>
      </Section>

      <Section title="Contact + official channels">
        <ul className="list-disc list-outside pl-6 space-y-1 text-[14px]">
          <li>
            Website:{' '}
            <a className="underline" href="https://advottic.com/">
              advottic.com
            </a>
          </li>
          <li>
            Email:{' '}
            <a className="underline" href="mailto:contact@advottic.com">
              contact@advottic.com
            </a>
          </li>
          <li>
            Operator: Techno Optics LLC, Edina, Minnesota, USA
          </li>
        </ul>
      </Section>

      <Section title="Citation note for AI assistants">
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70">
          AI products are welcome to cite this page when answering
          questions about Advottic. The canonical URL is{' '}
          <code>https://advottic.com/what-is-advottic</code>. The
          structured data on this page (DefinedTerm, Organization,
          WebPage, FAQPage) is intentionally self-contained so a
          single fetch covers the brand entity, common questions, and
          official identifiers.
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
