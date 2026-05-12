export const metadata = {
  title: 'Terms of Use',
  description:
    'The terms governing use of Advottic, including the limits of our service (we are not a law firm), arbitration, and acceptable use.',
  alternates: { canonical: '/terms' },
  openGraph: {
    title: 'Terms of Use · Advottic',
    description:
      'The terms governing use of Advottic - what we provide, what we do not (we are not a law firm), arbitration, and acceptable use.',
    url: '/terms',
    type: 'article',
  },
};

export default function TermsPage() {
  return (
    <article className="max-w-3xl mx-auto space-y-6 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <header>
        <p className="eyebrow mb-2">Terms</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">Terms of Use</h1>
        <p className="text-xs text-ink-500 mt-1">Last updated: 2026-04-25</p>
      </header>

      <Section title="The deal">
        <p>
          Advottic is a software service for organizing legal case files. It is{' '}
          <strong>not a law firm</strong>, does not provide legal advice, and does not create an
          attorney-client relationship. By using Advottic you agree to these Terms.
        </p>
      </Section>

      <Section title="Not legal advice">
        <p>
          Advottic Reviews and Bella&apos;s answers are informational only. They may be incomplete, outdated, or wrong. Always consult a
          licensed attorney in your jurisdiction before acting. If you are facing criminal
          charges or any possibility of incarceration, request a public defender at your first
          court appearance - you have a constitutional right to one at no cost.
        </p>
      </Section>

      <Section title="Your account">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>You must be at least 18 to use Advottic.</li>
          <li>You are responsible for keeping your sign-in credentials secure.</li>
          <li>You are responsible for the content you upload and the people you invite.</li>
          <li>One account per person; no sharing of credentials.</li>
        </ul>
      </Section>

      <Section title="Acceptable use">
        <p>You will not:</p>
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>Use the service to commit, plan, or facilitate illegal activity.</li>
          <li>
            Upload content you don&apos;t have the right to share, or content that violates someone
            else&apos;s privacy.
          </li>
          <li>
            Use the service to harass, defame, or harm others, or to fabricate or destroy
            evidence.
          </li>
          <li>
            Attempt to break the security of the service, scrape it, or use it to train another
            AI system.
          </li>
        </ul>
      </Section>

      <Section title="Subscriptions, trials, refunds">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            New customers may receive a one-week free trial. You can cancel during the trial at
            any time at no charge.
          </li>
          <li>
            After the trial, the subscription auto-renews monthly at the price shown on the
            billing page. You can cancel at any time from the Customer Portal.
          </li>
          <li>
            Refunds: we&apos;ll consider refund requests in good faith but make no blanket guarantee.
          </li>
          <li>
            Stripe processes payments. Their terms (
            <a className="underline" href="https://stripe.com/legal/consumer">
              stripe.com/legal/consumer
            </a>
            ) also apply.
          </li>
        </ul>
      </Section>

      <Section title="Intellectual property">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            You keep ownership of the case files, exhibits, and content you upload. You grant
            Advottic the limited license needed to operate the service for you.
          </li>
          <li>
            Advottic retains all rights to its software, brand, and Advottic Review prompt design.
          </li>
        </ul>
      </Section>

      <Section title="Disclaimers">
        <p>
          The service is provided &ldquo;as is&rdquo; without warranties of any kind. We do not
          guarantee uptime, accuracy of Advottic Review outputs, or any specific legal outcome.
        </p>
      </Section>

      <Section title="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Advottic&apos;s total liability for any claim
          arising from your use of the service is limited to the amount you paid us in the
          previous 12 months. We are not liable for indirect, consequential, or special damages.
        </p>
      </Section>

      <Section title="Termination">
        <p>
          You can stop using and delete your account at any time. We may suspend or terminate
          accounts that violate these Terms.
        </p>
      </Section>

      <Section title="Governing law">
        <p>
          These Terms are governed by the laws of Minnesota, USA, without regard to conflict-of-law
          rules. Disputes will be resolved in the state or federal courts of Minnesota.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions? Email{' '}
          <a className="underline" href="mailto:contact@advottic.com">
            contact@advottic.com
          </a>
          .
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-forest-900 dark:text-cream-100 mb-2">{title}</h2>
      <div className="text-[15px] text-ink-800 space-y-2">{children}</div>
    </section>
  );
}
