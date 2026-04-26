import Link from 'next/link';

export const metadata = { title: 'Privacy Policy - Advottic' };

export default function PrivacyPage() {
  return (
    <article className="max-w-3xl mx-auto prose-sm space-y-6 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <header>
        <p className="eyebrow mb-2">Privacy</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">Privacy Policy</h1>
        <p className="text-xs text-ink-500 mt-1">Last updated: 2026-04-25</p>
      </header>

      <Section title="Who we are">
        <p>
          Advottic ("we", "us") is operated by Techno Optics LLC. Contact:{' '}
          <a href="mailto:contact@advottic.com" className="underline">
            contact@advottic.com
          </a>
          .
        </p>
      </Section>

      <Section title="What we collect">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            <strong>Account info</strong>: email address (and optional name, role, organization,
            avatar URL) when you sign in via Google, Microsoft, or email magic link.
          </li>
          <li>
            <strong>Case content you create</strong>: case files, descriptions, exhibits (file
            uploads with metadata you provide), and Legal Eye reviews.
          </li>
          <li>
            <strong>Collaborators</strong>: emails you enter to invite collaborators to your
            cases.
          </li>
          <li>
            <strong>Billing</strong>: if you subscribe, a Stripe customer ID and subscription
            status. We never see or store your card details - Stripe handles those directly.
          </li>
          <li>
            <strong>Operational logs</strong>: IP addresses on Legal Eye / Bella requests for rate limiting and
            standard server logs from our hosting provider.
          </li>
        </ul>
      </Section>

      <Section title="Why we process it (legal bases)">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            <strong>Contract</strong>: providing the service you signed up for (case organization,
            Legal Eye review, exports).
          </li>
          <li>
            <strong>Legitimate interests</strong>: securing the platform, preventing abuse,
            keeping the service running.
          </li>
          <li>
            <strong>Consent</strong>: optional analytics and profile customizations.
          </li>
          <li>
            <strong>Legal obligation</strong>: tax records for paid subscriptions; responses to
            valid legal process.
          </li>
        </ul>
      </Section>

      <Section title="Sub-processors">
        <p>We share the minimum data needed with these third parties to run the service:</p>
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            <strong>Vercel</strong> - hosting + edge network.
          </li>
          <li>
            <strong>Supabase</strong> - authentication, database (Postgres), file storage.
          </li>
          <li>
            <strong>Anthropic</strong> - natural-language processing partner used by Legal Eye
            and Bella. Inputs travel over TLS and, under the partner&apos;s commercial terms,
            are not used to improve any outside service.
          </li>
          <li>
            <strong>Stripe</strong> - subscription billing for paid plans.
          </li>
        </ul>
      </Section>

      <Section title="Your rights (GDPR / CCPA)">
        <p>You can exercise these rights at any time, free of charge:</p>
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            <strong>Access &amp; portability</strong>: export your data as JSON from the{' '}
            <Link href="/profile" className="underline">
              Profile
            </Link>{' '}
            page.
          </li>
          <li>
            <strong>Rectification</strong>: edit your profile / case data directly in the app.
          </li>
          <li>
            <strong>Erasure</strong>: delete your account from the Profile page. This deletes all
            cases, exhibits, reviews, and your authentication record. Stripe billing history is
            retained as required by law.
          </li>
          <li>
            <strong>Restriction / objection</strong>: email us to pause specific processing.
          </li>
          <li>
            <strong>Complaint</strong>: lodge a complaint with your local data-protection
            authority.
          </li>
        </ul>
      </Section>

      <Section title="Retention">
        <p>
          We keep your data for as long as your account is active. When you delete your account
          we erase the records described above immediately, except where law requires retention
          (for example, billing records).
        </p>
      </Section>

      <Section title="Security">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>All traffic is encrypted in transit (TLS).</li>
          <li>Database and storage at rest are encrypted by Supabase.</li>
          <li>
            Row-level security policies ensure users can only read and modify their own cases
            (and shared collaborator cases).
          </li>
          <li>Server-side actions are CSRF-protected via Next.js&apos; built-in mechanisms.</li>
          <li>HSTS, frame-deny, and strict referrer headers are enforced site-wide.</li>
        </ul>
      </Section>

      <Section title="Cookies">
        <p>
          We use essential cookies only - to keep you signed in. We do not use advertising or
          third-party tracking cookies.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We&apos;ll post material changes to this policy on this page and update the date at the
          top.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Email{' '}
          <a href="mailto:contact@advottic.com" className="underline">
            contact@advottic.com
          </a>{' '}
          for any privacy-related question or to exercise a right above.
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
