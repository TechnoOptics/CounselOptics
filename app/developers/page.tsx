import Link from 'next/link';
import { BreadcrumbJsonLd } from '@/components/seo/JsonLd';

export const metadata = {
  title: 'Developers - Advottic API and integrations',
  description:
    'REST API, webhooks, and Capacitor SDK for building on top of Advottic. Read-only access to cases, contracts, and signing requests; write access for partners.',
  alternates: { canonical: '/developers' },
  openGraph: {
    title: 'Advottic for developers',
    description:
      'REST API, webhooks, and Capacitor SDK for building on top of Advottic.',
    type: 'website',
    url: '/developers',
  },
};

/**
 * Developers / API marketing page. The actual API surface lives at
 * /api/* (route handlers); this page is the marketing front door
 * that documents the public endpoints, points devs at the auth
 * model, and captures partnership leads.
 *
 * Why we have a /developers page even though the API is partner-
 * only today: dev landing pages rank well for long-tail integration
 * keywords ("legal practice management API", "IOLTA accounting API"),
 * and signal to evaluators that we have a real platform behind the
 * UI. The actual API access stays gated behind a partnership flow.
 */

const ENDPOINTS: Array<{
  method: string;
  path: string;
  blurb: string;
}> = [
  {
    method: 'GET',
    path: '/api/v1/cases',
    blurb: 'List cases the authenticated user has access to.',
  },
  {
    method: 'POST',
    path: '/api/v1/cases',
    blurb: 'Create a new case from structured intake data.',
  },
  {
    method: 'GET',
    path: '/api/v1/cases/:id/exhibits',
    blurb: 'List exhibits attached to a case.',
  },
  {
    method: 'POST',
    path: '/api/v1/cases/:id/exhibits',
    blurb: 'Upload an exhibit (multipart) and run optional OCR.',
  },
  {
    method: 'POST',
    path: '/api/v1/sign',
    blurb: 'Create an e-signature request with one or more recipients.',
  },
  {
    method: 'POST',
    path: '/api/v1/contracts/review',
    blurb: 'Submit a contract for AI review; returns a confidence rating + flagged clauses.',
  },
  {
    method: 'GET',
    path: '/api/v1/firms/:id/usage',
    blurb: 'Bella token usage by attorney, by case, by day.',
  },
  {
    method: 'POST',
    path: '/api/v1/webhooks',
    blurb: 'Register a webhook subscription for case + signing + billing events.',
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Is the Advottic API publicly available?',
    a: 'The API is in invite-only beta. We are onboarding partner integrations one cohort at a time so we can keep latency and reliability tight. Email partnerships@advottic.com with a one-paragraph description of your use case.',
  },
  {
    q: 'How is auth handled?',
    a: 'API tokens are issued per-firm and scoped to specific actions (read:cases, write:exhibits, etc.). Tokens are passed via Bearer Authorization. OAuth 2.0 + PKCE is on the roadmap for partner apps that act on a per-user basis.',
  },
  {
    q: 'What about webhooks?',
    a: 'Webhooks fire for case state changes, signing-request status, billing events, and firm-pool token thresholds. Payloads are signed with HMAC-SHA256 using a per-subscription secret; we retry with exponential backoff for up to 24 hours.',
  },
  {
    q: 'Are there SDKs?',
    a: 'A TypeScript SDK is published on npm (@advottic/sdk), and a Capacitor SDK ships our iOS / Android shells. Python and Ruby SDKs are auto-generated from the OpenAPI spec on request.',
  },
];

export default function DevelopersPage() {
  return (
    <div className="space-y-16 sm:space-y-20 pb-20 animate-fade-up">
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', href: '/' },
          { name: 'Developers', href: '/developers' },
        ]}
      />

      <header className="text-center space-y-4 max-w-3xl mx-auto pt-4 sm:pt-8 px-4">
        <p className="eyebrow justify-center">Developers</p>
        <h1 className="font-display text-[40px] sm:text-[56px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Build on the Advottic API.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 leading-relaxed">
          REST + webhooks for cases, contracts, and signing. SDKs for
          TypeScript, Capacitor, and OpenAPI. Currently invite-only;
          email{' '}
          <a
            href="mailto:partnerships@advottic.com"
            className="underline underline-offset-2"
          >
            partnerships@advottic.com
          </a>{' '}
          to request access.
        </p>
      </header>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Endpoint overview
        </h2>
        <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40 overflow-hidden">
          <ul className="divide-y divide-ink-100 dark:divide-forest-700/40">
            {ENDPOINTS.map((e) => (
              <li
                key={e.path}
                className="grid grid-cols-[auto_1fr] gap-4 p-4 sm:p-5"
              >
                <code className="font-mono text-[12px] sm:text-[13px] tabular-nums text-forest-900 dark:text-cream-100">
                  <span className="inline-block min-w-[3rem] mr-2 text-gold-700 dark:text-amber-300">
                    {e.method}
                  </span>
                  {e.path}
                </code>
                <span className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-snug">
                  {e.blurb}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
          A complete OpenAPI 3.1 spec is shared with onboarded
          partners. Versioning policy: breaking changes are released
          as a new major (/api/v2/) with a 12-month deprecation
          window for the prior version.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Authentication
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-[1.7]">
          Every request carries a Bearer token tied to a firm and
          scoped to the actions you registered for. Sample request:
        </p>
        <pre className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-forest-950 text-cream-100 text-[12.5px] font-mono p-4 overflow-x-auto leading-relaxed">{`curl https://api.advottic.com/v1/cases \\
  -H "Authorization: Bearer adv_live_..." \\
  -H "Accept: application/json"`}</pre>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Tokens are revocable per-environment from the Counsel
          settings panel. We rate-limit at 60 requests / second per
          token with a 1,000-request burst.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Webhooks
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-[1.7]">
          Subscribe to events to get notified about state changes
          without polling. Payloads are signed with{' '}
          <code className="text-[12.5px] font-mono">HMAC-SHA256</code>{' '}
          using your subscription secret; verify the{' '}
          <code className="text-[12.5px] font-mono">
            Advottic-Signature
          </code>{' '}
          header before processing.
        </p>
        <ul className="space-y-1.5 text-[14px] text-ink-600 dark:text-cream-100/70 leading-relaxed list-disc list-inside">
          <li>case.created, case.updated, case.closed</li>
          <li>signing.sent, signing.signed, signing.declined, signing.expired</li>
          <li>contract.review.completed</li>
          <li>billing.subscription.updated, billing.invoice.paid</li>
          <li>firm.tokens.threshold (when the firm pool hits a configured low-water mark)</li>
        </ul>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Frequently asked
        </h2>
        <ul className="space-y-3">
          {FAQ.map((qa) => (
            <li
              key={qa.q}
              className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/30 dark:bg-forest-900/40"
            >
              <details className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-start justify-between gap-3 p-4 sm:p-5">
                  <span className="font-medium text-forest-900 dark:text-cream-100 text-[15px] leading-snug">
                    {qa.q}
                  </span>
                  <span
                    aria-hidden
                    className="text-ink-500 dark:text-cream-100/55 text-lg leading-none transition-transform group-open:rotate-45 mt-0.5 shrink-0"
                  >
                    +
                  </span>
                </summary>
                <div className="px-4 sm:px-5 pb-4 sm:pb-5 text-[14.5px] text-ink-700 dark:text-cream-100/75 leading-relaxed">
                  {qa.a}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 text-center space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Want API access?
        </h2>
        <p className="text-[14.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Tell us what you&rsquo;re building. We onboard partners
          weekly.
        </p>
        <div className="pt-3 flex justify-center gap-3 flex-wrap">
          <a
            href="mailto:partnerships@advottic.com?subject=API%20access%20request"
            className="btn-primary"
          >
            Request access
          </a>
          <Link href="/security" className="btn-secondary">
            Read security overview
          </Link>
        </div>
      </section>
    </div>
  );
}
