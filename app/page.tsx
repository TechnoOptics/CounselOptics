import Link from 'next/link';
import { listCases } from '@/lib/storage';

export default async function HomePage() {
  const cases = await listCases();

  return (
    <div className="space-y-14">
      <section className="max-w-3xl">
        <p className="eyebrow mb-4">Case organization for individuals & businesses</p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-ink-950 leading-[1.08] mb-5">
          Organized evidence.
          <br />
          <span className="text-ink-500">Clear case context.</span>
        </h1>
        <p className="text-ink-600 text-[15px] leading-relaxed max-w-2xl mb-7">
          Collect documents, images, voice notes, and records into structured case files. Upload
          evidence, add context, surface possible legal issues, and export a professional packet
          for your attorney.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/cases/new" className="btn-primary">
            Start a case file
          </Link>
          <Link href="/cases" className="btn-secondary">
            View cases{cases.length ? ` (${cases.length})` : ''}
          </Link>
        </div>
      </section>

      <section>
        <p className="eyebrow mb-4">What it does</p>
        <div className="grid gap-4 md:grid-cols-3">
          <FeatureCard
            number="01"
            title="Organize"
            body="Every matter under the person, business, or issue involved. Structured metadata, status tracking, and jurisdiction."
          />
          <FeatureCard
            number="02"
            title="Attach"
            body="Photos, PDFs, audio, video, screenshots. Each upload becomes an auto-numbered exhibit with its own description."
          />
          <FeatureCard
            number="03"
            title="Review"
            body="Claude-backed issue spotting grounded in your jurisdiction — with concrete evidence to gather and records to subpoena."
          />
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
    <div className="card p-6">
      <p className="font-mono text-xs text-ink-400 mb-4">{number}</p>
      <h3 className="font-semibold tracking-tight text-ink-950 mb-1.5 text-[15px]">{title}</h3>
      <p className="text-sm text-ink-600 leading-relaxed">{body}</p>
    </div>
  );
}
