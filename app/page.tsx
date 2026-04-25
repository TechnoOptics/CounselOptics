import Link from 'next/link';
import { listCases } from '@/lib/storage';
import { storageUnavailable } from '@/lib/setup-status';
import { BrandMark } from '@/components/BrandMark';

export default async function HomePage() {
  let cases: Awaited<ReturnType<typeof listCases>> = [];
  if (!storageUnavailable()) {
    try {
      cases = await listCases();
    } catch {
      cases = [];
    }
  }

  return (
    <div className="space-y-14">
      {/* Hero — dark forest with gold accents */}
      <section className="relative overflow-hidden rounded-3xl brand-mark text-white px-8 py-14 md:px-12 md:py-16">
        {/* Decorative gold pillar background */}
        <div
          aria-hidden
          className="absolute -right-12 -top-6 text-gold-500/15 pointer-events-none select-none"
        >
          <BrandMark size={420} />
        </div>

        <div className="relative max-w-2xl">
          <p className="text-gold-400 text-[11px] tracking-[0.3em] uppercase font-semibold mb-5">
            AI Powered · Legal Focused · Case Ready
          </p>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-[1.05] mb-5">
            Build the case.
            <br />
            <span className="bg-gold-shine bg-clip-text text-transparent">
              We bring the structure.
            </span>
          </h1>
          <p className="text-cream-200/80 text-[15px] leading-relaxed mb-8">
            Advottic turns scattered evidence into an organized case packet — exhibits, timelines,
            jurisdiction-aware issue spotting, defense planning, and a PDF ready for your
            attorney. Built for individuals, businesses, and pro se litigants who need the work
            done right.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/cases/new"
              className="btn bg-gold-500 text-forest-950 hover:bg-gold-400 shadow-gold-glow font-semibold"
            >
              Start a case file
            </Link>
            <Link
              href="/cases"
              className="btn bg-white/10 text-white border border-white/20 hover:bg-white/15 backdrop-blur"
            >
              View cases{cases.length ? ` (${cases.length})` : ''}
            </Link>
          </div>
        </div>
      </section>

      <section>
        <p className="eyebrow mb-4">What it does</p>
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard
            number="01"
            title="Organize"
            body="Every matter under the person, business, government entity, or issue involved. Structured metadata, status tracking, jurisdiction, and posture (claimant or defendant)."
          />
          <FeatureCard
            number="02"
            title="Attach"
            body="Photos, PDFs, audio, video, screenshots. Each upload becomes an auto-numbered exhibit with category, date, and source captured."
          />
          <FeatureCard
            number="03"
            title="Review"
            body="Claude-backed issue spotting grounded in your jurisdiction — with concrete evidence to gather, records to subpoena, and pro se defense planning where applicable."
          />
        </div>
      </section>

      {/* Tagline footer band */}
      <section className="relative py-10 border-t border-gold-200">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow mb-2">Subscription</p>
            <h2 className="text-2xl font-semibold tracking-tight text-forest-900">
              $100/month — with a 7-day free trial.
            </h2>
            <p className="text-sm text-ink-600 mt-1 max-w-xl">
              Full access to case files, exhibit plans, AI review, defense planning, PDF export,
              and Bella, your on-demand legal information assistant. Cancel any time.
            </p>
          </div>
          <Link
            href="/billing"
            className="btn-secondary"
          >
            View pricing
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="card p-6 hover:border-gold-500/50 transition-colors">
      <p className="font-mono text-xs text-gold-700 mb-4">{number}</p>
      <h3 className="font-semibold tracking-tight text-forest-900 mb-1.5 text-[15px]">
        {title}
      </h3>
      <p className="text-sm text-ink-600 leading-relaxed">{body}</p>
    </div>
  );
}
