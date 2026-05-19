import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { AnalyzeStudio } from './analyze-studio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analyze · Counsel' };

export default async function CounselAnalyzePage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const where =
    ctx.firm.jurisdictions.length > 0
      ? ctx.firm.jurisdictions.slice(0, 3).join(', ')
      : 'the governing jurisdiction';

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Counsel · analyze</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Analyze a document
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Paste any contract or document. You get a plain-English
          breakdown of what it means, how the law in{' '}
          <strong>{where}</strong> applies to you, a bias rating
          (which side it favors), the hidden-consequence clauses, and
          recommended changes.
        </p>
      </header>
      <AnalyzeStudio />
    </div>
  );
}
