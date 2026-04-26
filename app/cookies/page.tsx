import Link from 'next/link';

export const metadata = { title: 'Cookie Policy - Advottic' };

export default function CookiePolicyPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
      <header>
        <p className="eyebrow mb-2">Legal</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">Cookie Policy</h1>
        <p className="text-xs text-ink-500 mt-2">Last updated: 2026-04-25</p>
      </header>

      <Section title="Cookies we use">
        <p>
          Advottic uses <strong>essential cookies only</strong>. We do not run advertising
          trackers, do not sell your data, and do not embed third-party analytics today.
        </p>
        <table className="w-full text-xs border border-ink-200 rounded-md mt-3 overflow-hidden">
          <thead className="bg-cream-50 text-forest-900">
            <tr>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Purpose</th>
              <th className="text-left px-3 py-2">Lifespan</th>
              <th className="text-left px-3 py-2">Category</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            <Row name="sb-* (Supabase auth)" purpose="Keeps you signed in." life="~7 days" cat="Strictly necessary" />
            <Row name="advottic_csrf" purpose="CSRF protection for form posts." life="Session" cat="Strictly necessary" />
            <Row name="bella-conversation (localStorage)" purpose="Remembers your in-progress chat with Bella." life="Session" cat="Functional" />
            <Row name="case-tabs:&lt;id&gt; (sessionStorage)" purpose="Remembers the active tab on a case detail page." life="Session" cat="Functional" />
            <Row name="co-cookie-ack (localStorage)" purpose="Records your cookie preferences so we don't ask again." life="Until cleared" cat="Strictly necessary" />
          </tbody>
        </table>
      </Section>

      <Section title="Your choices">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>
            <strong>Configure preferences</strong>: open the cookie dialog from the footer to
            review and revise your selections. Strictly-necessary cookies cannot be disabled.
          </li>
          <li>
            <strong>Browser controls</strong>: most browsers let you block or delete cookies.
            Disabling strictly-necessary cookies will stop sign-in from working.
          </li>
        </ul>
      </Section>

      <Section title="Future categories">
        <p>
          If we ever add analytics or marketing cookies, the dialog will surface them as opt-ins
          (off by default) and we will revise this policy with a clear &quot;Last updated&quot;
          date.
        </p>
      </Section>

      <p className="text-xs text-ink-500">
        Questions:{' '}
        <a className="underline" href="mailto:contact@advottic.com">
          contact@advottic.com
        </a>
        . Read also our{' '}
        <Link href="/privacy" className="underline">Privacy Policy</Link> and{' '}
        <Link href="/terms" className="underline">Terms</Link>.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-forest-900 dark:text-cream-100 mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ name, purpose, life, cat }: { name: string; purpose: string; life: string; cat: string }) {
  return (
    <tr>
      <td className="px-3 py-2 font-mono text-[11px]">{name}</td>
      <td className="px-3 py-2">{purpose}</td>
      <td className="px-3 py-2">{life}</td>
      <td className="px-3 py-2">{cat}</td>
    </tr>
  );
}
