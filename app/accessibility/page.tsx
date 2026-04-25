import Link from 'next/link';

export const metadata = { title: 'Accessibility - Advottic' };

export default function AccessibilityPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 text-sm text-ink-700 leading-relaxed">
      <header>
        <p className="eyebrow mb-2">Legal</p>
        <h1 className="text-3xl font-semibold tracking-tight text-forest-900">
          Accessibility statement
        </h1>
        <p className="text-xs text-ink-500 mt-2">Last updated: 2026-04-25</p>
      </header>

      <Section title="Our commitment">
        <p>
          Advottic aims to meet the <strong>WCAG 2.1 Level AA</strong> conformance level. We
          design with screen readers, keyboard-only navigation, color-contrast standards, and
          reduced-motion preferences in mind.
        </p>
      </Section>

      <Section title="What we've built in">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>Keyboard-navigable: every interactive element is reachable via Tab and operable via Enter / Space.</li>
          <li>Visible focus styles on every focusable control.</li>
          <li>
            <code className="font-mono">prefers-reduced-motion</code> support: heavy animations
            (orbit / float / shimmer) disable themselves automatically.
          </li>
          <li>Semantic HTML and ARIA roles on dialogs, menus, and tabs.</li>
          <li>Color contrast targets the AA threshold for body text and accent surfaces.</li>
          <li>Form inputs have visible labels and error messages.</li>
        </ul>
      </Section>

      <Section title="Known limitations">
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>Embedded Google Maps (Find counsel) inherits Google&apos;s accessibility behavior, which we don&apos;t control.</li>
          <li>Stripe Checkout and the Customer Portal are operated by Stripe and follow Stripe&apos;s accessibility standards.</li>
          <li>PDF case packets are tagged but complex tables may not be fully navigable in every reader.</li>
        </ul>
      </Section>

      <Section title="Need an accommodation?">
        <p>
          Email{' '}
          <a className="underline" href="mailto:contact@advottic.com">contact@advottic.com</a>{' '}
          or message us via WhatsApp at{' '}
          <a
            className="underline"
            href="https://wa.me/19253001600"
            target="_blank"
            rel="noreferrer"
          >
            +1 (925) 300-1600
          </a>
          . Tell us what you need and we&apos;ll work with you - keyboard alternatives, scaled
          fonts, alternative formats for case packets, or a one-on-one walkthrough.
        </p>
      </Section>

      <p className="text-xs text-ink-500">
        Read also our{' '}
        <Link href="/privacy" className="underline">Privacy Policy</Link> and{' '}
        <Link href="/terms" className="underline">Terms</Link>.
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
