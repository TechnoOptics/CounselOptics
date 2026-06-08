import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: {
    absolute:
      'Embed the SOL checker on your site (free) · Advottic',
  },
  description:
    'Free embeddable statute of limitations checker. Drop one iframe tag onto your site and your readers get a live, 50-state SOL picker. No signup. No fees.',
  alternates: {
    canonical: '/tools/statute-of-limitations/embed',
  },
  openGraph: {
    title: 'Embed the Advottic SOL checker on your site',
    description:
      'Free iframe widget for legal aid orgs, tenant unions, and blogs. Drop in one tag.',
    url: '/tools/statute-of-limitations/embed',
    type: 'website',
  },
};

const SNIPPET = `<iframe
  src="https://advottic.com/embed/statute-of-limitations"
  title="Statute of limitations checker"
  width="100%"
  height="720"
  loading="lazy"
  style="border:0;max-width:680px;display:block;margin:0 auto"
></iframe>`;

export default function EmbedInstructionsPage() {
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10 text-ink-800 dark:text-cream-100/85 leading-relaxed">
      <nav className="text-[12px] text-ink-500 dark:text-cream-100/55">
        <Link href="/" className="underline hover:no-underline">
          Advottic
        </Link>
        {' / '}
        <Link
          href="/tools/statute-of-limitations"
          className="underline hover:no-underline"
        >
          SOL checker
        </Link>
        {' / '}
        <span className="text-ink-700 dark:text-cream-100/80">
          Embed
        </span>
      </nav>

      <header className="space-y-2">
        <p className="eyebrow">Embed</p>
        <h1 className="font-display text-[40px] sm:text-[52px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Drop the SOL checker into your site.
        </h1>
        <p className="text-base text-ink-600 dark:text-cream-100/70 max-w-2xl">
          One iframe tag. Free for any site to use. Your readers
          get a live, 50-state statute-of-limitations checker
          with no signup, no email gate, no fees. A small
          &ldquo;Powered by Advottic&rdquo; link sits at the
          bottom of the widget.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Copy the snippet
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
          Paste this anywhere HTML is allowed - WordPress, Ghost,
          Webflow, Squarespace, a static site, a help center
          article, a Notion public page.
        </p>
        <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/40 p-5">
          <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap font-mono text-ink-800 dark:text-cream-100/85 overflow-x-auto">
            {SNIPPET}
          </pre>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Live preview
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
          This is exactly what your visitors will see.
        </p>
        <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 overflow-hidden bg-white dark:bg-forest-950">
          <iframe
            src="/embed/statute-of-limitations"
            title="Statute of limitations checker (preview)"
            width="100%"
            height={720}
            loading="lazy"
            style={{
              border: 0,
              display: 'block',
              margin: '0 auto',
            }}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Customizing the size
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
          The widget is responsive. The default snippet caps
          width at 680px and centers it. Adjust the{' '}
          <code className="font-mono text-[13px]">width</code>{' '}
          and{' '}
          <code className="font-mono text-[13px]">height</code>{' '}
          attributes to fit your layout. Sidebar slots fit at
          width 320 / height 760; full-width hero slots fit at
          width 100% / height 700.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          License
        </h2>
        <p className="text-[14.5px] text-ink-700 dark:text-cream-100/80">
          Free to embed on any public website without
          attribution beyond the small &ldquo;Powered by
          Advottic&rdquo; link already in the widget footer.
          Reach out at{' '}
          <a
            href="mailto:contact@advottic.com"
            className="underline"
          >
            contact@advottic.com
          </a>{' '}
          if you want a white-label variant or a custom skin.
        </p>
      </section>

      <section className="pt-4 border-t border-ink-200 dark:border-forest-700/60 text-[12.5px] text-ink-600 dark:text-cream-100/65">
        <p>
          The widget is informational only and is not legal
          advice. The page already surfaces the &ldquo;consult
          a licensed attorney&rdquo; disclaimer inside the
          result panel, so you do not need to add your own.
        </p>
      </section>
    </article>
  );
}
