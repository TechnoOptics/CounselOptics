import Link from 'next/link';

export const metadata = {
  title: 'Trust & Security',
  description:
    'How Advottic protects your case data: encryption, authentication, access controls, sub-processors, and AI handling. Built for legal-grade trust.',
  alternates: { canonical: '/security' },
  openGraph: {
    title: 'Trust & Security · Advottic',
    description:
      'TLS 1.2+ in transit, AES-256 at rest, RLS-scoped per-row access, and zero-retention AI processing terms.',
    url: '/security',
    type: 'article',
  },
};

export default function SecurityPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-10 animate-fade-up">
      {/* Hero - mirrors Mercury / Stripe trust-center pattern: lead with
          confidence, not disclaimers. */}
      <header className="text-center max-w-2xl mx-auto pt-2">
        <p className="eyebrow mb-3 justify-center">Trust & Security</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Built for legal-grade trust.
        </h1>
        <p className="text-base sm:text-lg text-ink-600 dark:text-cream-100/70 mt-4 leading-relaxed">
          Your case is some of the most sensitive content you'll ever put in a SaaS. Advottic
          treats it that way. Every section below describes what we do today, in plain
          language, and what we're working toward.
        </p>
        <p className="text-xs text-ink-400 dark:text-cream-100/45 mt-4 font-mono">
          Last reviewed: 2026-04-25
        </p>
      </header>

      {/* Three-column promise grid - confidence layer above the technical
          details, in the Mercury/Wealthfront pattern. */}
      <section className="grid gap-4 sm:grid-cols-3">
        <Promise
          icon={<LockIcon />}
          title="Encrypted everywhere"
          body="TLS 1.2+ in transit, AES-256 at rest. Per-row access enforced server-side, not in the client."
        />
        <Promise
          icon={<KeyIcon />}
          title="Your story stays yours"
          body="Bella and Advottic Review process your case under strict zero-retention commercial terms. Your content is never used to improve outside services."
        />
        <Promise
          icon={<ShieldIcon />}
          title="You control access"
          body="Owner, editor, and attorney roles. Revoke any collaborator at any time. Fine-grained sharing is the default, not the exception."
        />
      </section>

      {/* Section: How we keep your funds (cases) safe */}
      <Section
        eyebrow="Funds (case content) safety"
        title="How we keep your case content safe"
      >
        <SubSection title="In transit">
          All traffic to Advottic is served over HTTPS with TLS 1.2+. Strict-Transport-Security
          (HSTS) is enabled on the production domain so browsers refuse to downgrade.
        </SubSection>
        <SubSection title="At rest">
          <ul className="list-disc list-outside pl-6 space-y-1.5">
            <li>
              <strong>Database</strong>: Postgres on Supabase, AES-256 encrypted at rest.
              Per-row access is enforced by Row-Level Security (RLS) policies tied to your
              user ID, not by application code.
            </li>
            <li>
              <strong>Files</strong>: exhibit uploads live in a private storage bucket with
              path-scoped policies, so users only see files for cases they own or were
              invited into.
            </li>
            <li>
              <strong>Secrets</strong>: API keys and webhook secrets are stored as encrypted
              environment variables on Vercel. Service-role credentials never reach the
              browser.
            </li>
          </ul>
        </SubSection>
        <SubSection title="Backups & recovery">
          Supabase performs daily automated backups with point-in-time recovery on the
          paid plan we run on. We test restore procedures during major upgrades.
        </SubSection>
      </Section>

      {/* Section: How we protect your account */}
      <Section
        eyebrow="Account protection"
        title="How we protect your account"
      >
        <SubSection title="Authentication">
          <ul className="list-disc list-outside pl-6 space-y-1.5">
            <li>
              Sign in via Google OAuth, Microsoft OAuth, or email magic link, issued by
              Supabase Auth. We never see or store your password.
            </li>
            <li>
              Session cookies are HTTP-only, Secure, and SameSite=Lax. They are bound to
              your browser and cannot be read by client-side JavaScript.
            </li>
            <li>
              Sign-out invalidates the session immediately and clears auth cookies in the
              browser.
            </li>
          </ul>
        </SubSection>
        <SubSection title="Multi-factor authentication">
          TOTP-based two-factor authentication via the standard authenticator apps (1Password,
          Authy, Google Authenticator) is on the near-term roadmap. We do not, and will not,
          offer SMS-based 2FA: SIM-swap attacks make it materially weaker than TOTP.
        </SubSection>
        <SubSection title="Suspicious activity">
          Unusual sign-in attempts trigger an email notification. You can sign out of every
          device from your profile page.
        </SubSection>
      </Section>

      {/* Section: Controls that keep you in control */}
      <Section
        eyebrow="Controls"
        title="Controls that keep you in control"
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          <ControlTile
            label="Role-based sharing"
            body="Invite collaborators as owner, editor, or attorney. Each role sees only what they need."
          />
          <ControlTile
            label="Per-case audit trail"
            body="See who viewed, uploaded, exported, or shared a case. (In-app surface ships next.)"
          />
          <ControlTile
            label="Self-serve data export"
            body="Download every case, exhibit, and review you've created at any time, for any reason."
          />
          <ControlTile
            label="Delete on demand"
            body="Permanent account deletion from your profile. We honor it within 30 days, including backups."
          />
        </ul>
      </Section>

      {/* Section: Your data, your eyes only */}
      <Section
        eyebrow="Data handling"
        title="Your data. Your eyes only."
      >
        <SubSection title="What we collect">
          The minimum required to run the product: email + auth provider profile, the case
          content you choose to upload, billing identifiers from Stripe, and basic operational
          telemetry (request counts, error rates, no content). See the{' '}
          <Link href="/privacy" className="underline text-forest-900 dark:text-cream-100 hover:text-gold-700">
            Privacy Policy
          </Link>{' '}
          for the full list.
        </SubSection>
        <SubSection title="Assistant features">
          Bella (your conversational assistant) and Advottic Review (case review) call a
          natural-language processing partner under commercial terms that prohibit using your
          inputs to improve their or any other service. Your case content is never used to
          improve a product outside your account.
        </SubSection>
        <SubSection title="Where it lives">
          Application: Vercel (United States, primary region: Washington, D.C.). Database and
          storage: Supabase (United States). Natural-language processing: Anthropic (United
          States). Billing: Stripe (United States).
        </SubSection>
        <SubSection title="Retention">
          Active cases are retained for the life of your account. On account deletion, we
          delete case content within 30 days from primary storage and from rolling backups
          within 35 days. Stripe transaction records are retained as required by tax and
          financial regulation.
        </SubSection>
      </Section>

      {/* Sub-processor list */}
      <Section
        eyebrow="Sub-processors"
        title="Who we trust with what"
      >
        <p className="mb-4">
          We keep this list short on purpose. Every party below has a contractual data-handling
          agreement and a relevant compliance posture.
        </p>
        <div className="overflow-hidden rounded-xl border border-ink-200 dark:border-forest-700/60">
          <table className="w-full text-sm">
            <thead className="bg-cream-50 dark:bg-forest-900/60 text-ink-700 dark:text-cream-100/85">
              <tr>
                <th className="text-left font-semibold px-4 py-3">Sub-processor</th>
                <th className="text-left font-semibold px-4 py-3">Purpose</th>
                <th className="text-left font-semibold px-4 py-3">Region</th>
                <th className="text-left font-semibold px-4 py-3">Compliance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-forest-700/40">
              <SubProcRow
                name="Vercel"
                purpose="Application hosting, edge network"
                region="USA"
                compliance="SOC 2 Type II, ISO 27001"
              />
              <SubProcRow
                name="Supabase"
                purpose="Auth, Postgres database, file storage"
                region="USA"
                compliance="SOC 2 Type II, HIPAA-ready"
              />
              <SubProcRow
                name="Anthropic"
                purpose="Natural-language processing for Bella + Advottic Review"
                region="USA"
                compliance="SOC 2 Type II; zero-retention commercial terms"
              />
              <SubProcRow
                name="Stripe"
                purpose="Subscription billing + customer portal"
                region="USA"
                compliance="PCI DSS Level 1, SOC 1/2"
              />
              <SubProcRow
                name="Resend"
                purpose="Transactional email (sign-in, invites)"
                region="USA"
                compliance="SOC 2 Type II"
              />
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-3">
          We will email account owners at least 30 days before adding a sub-processor that
          handles case content.
        </p>
      </Section>

      {/* Reporting */}
      <Section
        eyebrow="Disclosure"
        title="Found a vulnerability?"
      >
        <p>
          Please report it directly to{' '}
          <a className="underline text-forest-900 dark:text-cream-100 hover:text-gold-700" href="mailto:security@advottic.com">
            security@advottic.com
          </a>{' '}
          with the subject{' '}
          <code className="font-mono text-[12px] bg-ink-100 dark:bg-forest-800 px-1.5 py-0.5 rounded">[security]</code>.
          We aim to acknowledge within 2 business days. Please give us a reasonable window to
          investigate and fix before public disclosure. We do not currently run a paid bug
          bounty, but we recognize meaningful reports publicly with permission.
        </p>
      </Section>

      {/* FAQ */}
      <Section eyebrow="Common questions" title="You have questions. We have answers.">
        <div className="space-y-2">
          <Faq q="Is my case content used to improve any outside service?">
            No. Our processing partner&apos;s commercial terms forbid using your inputs to
            improve their service or any other product. Your content reaches Bella or Legal
            Eye, returns an answer, and is not retained beyond delivering that answer.
          </Faq>
          <Faq q="Can my attorney see my case without an Advottic account?">
            Yes — invite them as a collaborator. They'll receive a magic-link invite, see only
            the case you shared, and can be removed any time from the Sharing tab. We do not
            require the attorney to subscribe.
          </Faq>
          <Faq q="What happens to my data if I cancel?">
            Your subscription downgrades at the end of the current billing period. Cases stay
            in your account read-only. If you delete the account, all case content is purged
            from primary storage within 30 days and from backups within 35 days.
          </Faq>
          <Faq q="Are you SOC 2 / HIPAA / ISO 27001 certified?">
            We're not yet directly certified — we run on infrastructure (Vercel, Supabase,
            Anthropic, Stripe) that is. Direct certification of Advottic is on the roadmap as
            we move beyond early-stage operation.
          </Faq>
          <Faq q="Where is my data stored?">
            United States. Application on Vercel, database + files on Supabase. We can offer
            a Data Processing Agreement (DPA) on request.
          </Faq>
        </div>
      </Section>

      {/* Footer CTA */}
      <section className="card p-6 sm:p-8 text-center">
        <h3 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Have a security or compliance question we didn't cover?
        </h3>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2">
          Email{' '}
          <a className="underline text-forest-900 dark:text-cream-100" href="mailto:security@advottic.com">
            security@advottic.com
          </a>{' '}
          and we'll respond within 2 business days.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3 text-xs text-ink-500 dark:text-cream-100/55">
          <Link href="/privacy" className="underline">Privacy Policy</Link>
          <span aria-hidden>·</span>
          <Link href="/terms" className="underline">Terms</Link>
          <span aria-hidden>·</span>
          <Link href="/cookies" className="underline">Cookie Policy</Link>
          <span aria-hidden>·</span>
          <Link href="/dmca" className="underline">DMCA</Link>
        </div>
      </section>
    </div>
  );
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 className="font-display text-2xl sm:text-[28px] font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {title}
        </h2>
      </div>
      <div className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed space-y-4">
        {children}
      </div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="font-semibold tracking-tight text-forest-900 dark:text-cream-100 mb-1.5">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Promise({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="card p-5">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-forest-900 text-gold-300 dark:bg-gold-metal dark:text-forest-950">
        {icon}
      </span>
      <h3 className="font-semibold tracking-tight text-forest-900 dark:text-cream-100 mt-3">
        {title}
      </h3>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
        {body}
      </p>
    </div>
  );
}

function ControlTile({ label, body }: { label: string; body: string }) {
  return (
    <li className="card p-4">
      <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
        {label}
      </p>
      <p className="text-sm text-ink-700 dark:text-cream-100/80 mt-1.5 leading-relaxed">
        {body}
      </p>
    </li>
  );
}

function SubProcRow({
  name,
  purpose,
  region,
  compliance,
}: {
  name: string;
  purpose: string;
  region: string;
  compliance: string;
}) {
  return (
    <tr className="text-sm">
      <td className="px-4 py-3 font-semibold text-forest-900 dark:text-cream-100">{name}</td>
      <td className="px-4 py-3 text-ink-700 dark:text-cream-100/80">{purpose}</td>
      <td className="px-4 py-3 text-ink-500 dark:text-cream-100/55">{region}</td>
      <td className="px-4 py-3 text-ink-500 dark:text-cream-100/55">{compliance}</td>
    </tr>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group card p-4">
      <summary className="flex items-center justify-between cursor-pointer list-none">
        <span className="font-semibold text-forest-900 dark:text-cream-100">{q}</span>
        <span aria-hidden className="text-ink-400 group-open:rotate-90 transition-transform font-mono text-xs">
          ▶
        </span>
      </summary>
      <div className="mt-3 text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
        {children}
      </div>
    </details>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="8" cy="14" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M11 12l9-9m-3 0h3v3m-3 3l-2-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
