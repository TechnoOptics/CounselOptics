import Link from 'next/link';
import { BreadcrumbJsonLd } from '@/components/seo/JsonLd';

export const metadata = {
  title: { absolute: 'Developers · Advottic API' },
  description:
    'Read-only REST endpoints for cases, documents, and signing requests, plus outbound webhooks for partner intake tickets.',
  alternates: { canonical: '/developers' },
  openGraph: {
    title: 'Advottic for developers',
    description:
      'Read-only REST endpoints and outbound webhooks for building on top of Advottic.',
    type: 'website',
    url: '/developers',
  },
};

/**
 * Developers / API page. This page documents the API that exists.
 *
 * It previously advertised eight endpoints (only four are built, and
 * all four are GET), an invite-only beta (tokens are self-serve),
 * scopes that were never implemented, an api.advottic.com host that
 * does not resolve, a webhook header name the sender does not send,
 * a retry policy with no retry behind it, rate limiting that is not
 * applied to /api/v1, and SDKs and an OpenAPI spec that do not
 * exist. A partner following the old page could not have succeeded.
 *
 * Rule for editing this file: every endpoint, header, scope and
 * behaviour named here must be traceable to a route handler or to
 * lib/api-tokens.ts / lib/partner-notify.ts. If it is only planned,
 * it does not go on the page.
 */

const ENDPOINTS: Array<{
  method: string;
  path: string;
  blurb: string;
}> = [
  {
    method: 'GET',
    path: '/api/v1/me',
    blurb: 'Return the account or firm the token belongs to.',
  },
  {
    method: 'GET',
    path: '/api/v1/cases',
    blurb:
      "List cases scoped to the token. A user token returns that user's cases; a firm token returns the firm's matters. Paginated via limit and offset.",
  },
  {
    method: 'GET',
    path: '/api/v1/documents',
    blurb: 'List documents scoped to the token.',
  },
  {
    method: 'GET',
    path: '/api/v1/signing-requests',
    blurb: 'List signing requests scoped to the token.',
  },
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Is the Advottic API publicly available?',
    a: 'Yes. Mint a token yourself from API tokens in your profile settings. There is no waiting list and no application.',
  },
  {
    q: 'How is auth handled?',
    a: 'Every request carries a Bearer token. Tokens carry one or more of three scopes: read, write, and admin. The endpoints published today all require read. Tokens can be given an expiry and can be revoked at any time from the same settings panel.',
  },
  {
    q: 'What about webhooks?',
    a: 'Webhooks are for partner intake tickets, and they are configured per firm rather than through the API. Five events are sent: ticket.created, ticket.employee_replied, ticket.legal_replied, ticket.status_changed, and ticket.reminder. Delivery is a single attempt with a 10-second timeout and is not retried, so treat it as a hint to refresh rather than a guaranteed feed, and poll if you need certainty.',
  },
  {
    q: 'Are there SDKs?',
    a: 'No. There is no published SDK and no OpenAPI document. The endpoints are plain REST over HTTPS returning JSON, so any HTTP client will do.',
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
          Read-only REST endpoints for cases, documents, and signing
          requests, plus outbound webhooks for partner intake tickets.
          Mint a token from your profile settings and start; there is no
          waiting list. Questions go to{' '}
          <a
            href="mailto:partnerships@advottic.com"
            className="underline underline-offset-2"
          >
            partnerships@advottic.com
          </a>
          .
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
          That is the whole published surface today. Everything is
          read-only; there is no endpoint that creates or changes data.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Authentication
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-[1.7]">
          Every request carries a Bearer token. Tokens begin{' '}
          <code className="text-[12.5px] font-mono">adv_</code> and are
          tied to your account or your firm. Sample request:
        </p>
        <pre className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-forest-950 text-cream-100 text-[12.5px] font-mono p-4 overflow-x-auto leading-relaxed">{`curl https://advottic.com/api/v1/cases \\
  -H "Authorization: Bearer adv_..." \\
  -H "Accept: application/json"`}</pre>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          A token missing the scope an endpoint needs is refused with
          403. Tokens are revocable at any time from the same settings
          panel that issued them.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 space-y-5">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Webhooks
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80 leading-[1.7]">
          Partner intake tickets emit webhooks, configured per firm.
          Payloads are signed with{' '}
          <code className="text-[12.5px] font-mono">HMAC-SHA256</code>{' '}
          using your webhook secret; verify the{' '}
          <code className="text-[12.5px] font-mono">
            X-Advottic-Signature
          </code>{' '}
          header before processing. The event name arrives in{' '}
          <code className="text-[12.5px] font-mono">X-Advottic-Event</code>.
        </p>
        <ul className="space-y-1.5 text-[14px] text-ink-600 dark:text-cream-100/70 leading-relaxed list-disc list-inside">
          <li>ticket.created</li>
          <li>ticket.employee_replied</li>
          <li>ticket.legal_replied</li>
          <li>ticket.status_changed</li>
          <li>ticket.reminder</li>
        </ul>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Delivery is a single attempt with a 10-second timeout and is
          not retried. Treat a webhook as a prompt to refresh, and poll
          if you need certainty.
        </p>
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
          Ready to build?
        </h2>
        <p className="text-[14.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          Mint a token from your profile settings. If you need something
          the endpoints above do not cover, write to{' '}
          <a
            href="mailto:partnerships@advottic.com"
            className="underline underline-offset-2"
          >
            partnerships@advottic.com
          </a>{' '}
          and tell us what you&rsquo;re building.
        </p>
        <div className="pt-3 flex justify-center gap-3 flex-wrap">
          <Link href="/profile/api-tokens" className="btn-primary">
            Create a token
          </Link>
          <Link href="/security" className="btn-secondary">
            Read security overview
          </Link>
        </div>
      </section>
    </div>
  );
}
