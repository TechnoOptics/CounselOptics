import Link from 'next/link';

export const metadata = {
  title: 'Responsible disclosure - Advottic',
  description:
    'How to report a security vulnerability to Advottic. Safe-harbor commitments, scope, and PGP key.',
  alternates: { canonical: '/security/disclosure' },
};

export default function DisclosurePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10 animate-fade-up">
      <header className="space-y-3">
        <p className="eyebrow">Security · disclosure</p>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em]">
          Reporting a vulnerability to Advottic
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 leading-relaxed">
          We treat security reports from researchers as a gift. This page is
          our public commitment to handle them well: safe harbor for
          good-faith research, fast triage, named credit when you want it,
          and bounties on a tier ladder for qualifying findings.
        </p>
      </header>

      <section className="card p-6 space-y-3">
        <h2 className="font-display text-xl font-medium text-forest-900 dark:text-cream-100">
          How to report
        </h2>
        <p className="text-[14px] text-ink-700 dark:text-cream-100/85 leading-relaxed">
          Email{' '}
          <a href="mailto:security@advottic.com" className="underline">
            security@advottic.com
          </a>{' '}
          with:
        </p>
        <ul className="text-[13px] text-ink-700 dark:text-cream-100/80 space-y-2 list-disc pl-5 leading-relaxed">
          <li>A description of the issue and where you found it</li>
          <li>
            Reproduction steps clear enough that we can confirm without
            asking follow-up questions
          </li>
          <li>The impact you believe a malicious actor could achieve</li>
          <li>
            Any temporary mitigation we can apply while we ship a fix
          </li>
        </ul>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed pt-1 border-t border-ink-100 dark:border-forest-800/40">
          For higher-severity issues you can encrypt your report with our
          PGP key (fingerprint published on{' '}
          <Link
            href="/.well-known/security.txt"
            className="underline"
            prefetch={false}
          >
            /.well-known/security.txt
          </Link>
          ).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-medium text-forest-900 dark:text-cream-100">
          Our commitments
        </h2>
        <ul className="space-y-3 text-[13.5px] text-ink-700 dark:text-cream-100/85 leading-relaxed">
          <li>
            <strong>Safe harbor.</strong> We will not pursue legal action
            against researchers who report findings to us in good faith,
            do not access more data than necessary to demonstrate the
            issue, do not exfiltrate data, do not perform denial-of-service
            attacks, and do not publicly disclose before we have shipped a
            fix.
          </li>
          <li>
            <strong>Acknowledgement within 24 hours</strong> on business
            days, faster for critical issues.
          </li>
          <li>
            <strong>Triage decision within 72 hours.</strong> If we decide
            the report is in scope and exploitable, we tell you the
            severity and a target patch window.
          </li>
          <li>
            <strong>Public credit when you want it.</strong> We maintain a
            researcher acknowledgements page. Anonymous credit is also
            fine.
          </li>
          <li>
            <strong>Bounty tiers.</strong> Critical: $1,500 - $5,000.
            High: $500 - $1,500. Medium: $100 - $500. Low / informational:
            swag and credit. Scope, severity, and quality of the report
            all factor in. Final decisions sit with our security team.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-medium text-forest-900 dark:text-cream-100">
          In scope
        </h2>
        <ul className="text-[13px] text-ink-700 dark:text-cream-100/80 space-y-2 list-disc pl-5 leading-relaxed">
          <li>advottic.com and any subdomain (hq, enterprise, *.advottic.com)</li>
          <li>The Advottic Counsel firm-mode application</li>
          <li>The Advottic HQ admin console</li>
          <li>The Advottic public API and OAuth endpoints</li>
          <li>The native iOS / Android apps (when published)</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-medium text-forest-900 dark:text-cream-100">
          Out of scope
        </h2>
        <ul className="text-[13px] text-ink-700 dark:text-cream-100/80 space-y-2 list-disc pl-5 leading-relaxed">
          <li>
            Issues on third-party services we depend on (Vercel, Supabase,
            Stripe, Resend, Anthropic, Microsoft, Zoom). Report those to
            the vendor; we will help mediate if needed.
          </li>
          <li>
            Denial-of-service attacks. Do not test by trying to exhaust
            our infrastructure.
          </li>
          <li>
            Social-engineering of Advottic staff or customers (this
            includes phishing tests).
          </li>
          <li>
            Self-XSS, CSRF on actions that have no security impact, missing
            best-practice headers without a demonstrated exploit, and
            theoretical issues without a working PoC.
          </li>
          <li>
            Issues in test or staging environments unless they reveal a
            real production vulnerability.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-xl font-medium text-forest-900 dark:text-cream-100">
          What happens next
        </h2>
        <ol className="text-[13px] text-ink-700 dark:text-cream-100/80 space-y-2 list-decimal pl-5 leading-relaxed">
          <li>You email security@advottic.com with the report.</li>
          <li>
            We acknowledge, triage, and assign a severity. We may ask for
            clarifying information.
          </li>
          <li>
            We ship a fix on a timeline scaled to severity (critical: 7
            days, high: 30 days, medium: 60 days, low: best-effort).
          </li>
          <li>
            We confirm with you that the fix addresses the report.
          </li>
          <li>
            We agree on a public-disclosure window (default 90 days from
            triage, sooner for already-public CVEs in dependencies).
          </li>
          <li>We pay the bounty and credit you on the acknowledgements page.</li>
        </ol>
      </section>

      <p className="text-[12px] text-ink-500 dark:text-cream-100/55 leading-relaxed pt-6 border-t border-ink-100 dark:border-forest-800/40">
        This page is informational and does not modify the Advottic Terms of
        Service. If you have a contractual confidentiality obligation with
        Advottic (eg. you are an enterprise customer with a signed MSA), the
        contract controls.
      </p>
    </div>
  );
}
