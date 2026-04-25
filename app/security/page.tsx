import Link from 'next/link';

export const metadata = { title: 'Security - Advottic' };

export default function SecurityPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 text-sm text-ink-700 leading-relaxed">
      <header>
        <p className="eyebrow mb-2">Legal</p>
        <h1 className="text-3xl font-semibold tracking-tight text-forest-900">
          Security &amp; data handling
        </h1>
        <p className="text-xs text-ink-500 mt-2">Last updated: 2026-04-25</p>
      </header>

      <Section title="In transit">
        <p>
          All traffic to Advottic is served over HTTPS with TLS 1.2+. Strict-Transport-Security
          (HSTS) is enabled on the production domain.
        </p>
      </Section>

      <Section title="At rest">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            <strong>Database</strong>: Postgres on Supabase, AES-256 encrypted at rest. Per-row
            access enforced by Row-Level Security policies tied to your user ID.
          </li>
          <li>
            <strong>Files</strong>: exhibit uploads sit in a private storage bucket. Path-scoped
            policies ensure users only see files for cases they own or were invited into.
          </li>
          <li>
            <strong>Secrets</strong>: API keys and webhook secrets are stored as encrypted
            environment variables on Vercel. Service-role keys never reach the browser.
          </li>
        </ul>
      </Section>

      <Section title="Authentication">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            Sign-in via Google OAuth, Microsoft OAuth, or email magic links - issued by
            Supabase Auth. We never see your password.
          </li>
          <li>
            Session cookies are HTTP-only, Secure, and SameSite=Lax.
          </li>
          <li>
            Sign-out invalidates the session immediately and clears auth cookies in the
            browser.
          </li>
        </ul>
      </Section>

      <Section title="Access controls">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>RLS denies cross-user reads and writes by default.</li>
          <li>Admin tools are gated by a `is_admin` flag on the profiles table.</li>
          <li>Webhook endpoints verify signatures before processing.</li>
        </ul>
      </Section>

      <Section title="Sub-processors">
        <p>
          Vercel (hosting), Supabase (auth + database + storage), Anthropic (AI processing for
          Legal Eye and Bella), Stripe (subscription billing). Inputs to Anthropic are not used
          to train models per Anthropic&apos;s commercial terms.
        </p>
      </Section>

      <Section title="Reporting a vulnerability">
        <p>
          Email{' '}
          <a className="underline" href="mailto:contact@technooptics.com">contact@technooptics.com</a>{' '}
          with subject line <code className="font-mono">[security]</code>. We aim to acknowledge
          within 2 business days. Please don&apos;t publicly disclose before we&apos;ve had a
          chance to investigate and fix.
        </p>
      </Section>

      <p className="text-xs text-ink-500">
        Read also our{' '}
        <Link href="/privacy" className="underline">Privacy Policy</Link>,{' '}
        <Link href="/terms" className="underline">Terms</Link>, and{' '}
        <Link href="/cookies" className="underline">Cookie Policy</Link>.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-forest-900 mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
