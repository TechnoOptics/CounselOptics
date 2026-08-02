import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { AnalyzeStudio } from './analyze-studio';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

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
      <PageHeader
        eyebrow={<T>Counsel · analyze</T>}
        title={<T>Analyze a document</T>}
        subtitle={
          <>
            <T>Paste any contract or document. You get a plain-English
            breakdown of what it means, how the law in</T>{' '}
            <strong>{where}</strong>{' '}
            <T>applies to you, a bias rating
            (which side it favors), the hidden-consequence clauses, and
            recommended changes.</T>
          </>
        }
      />
      <AnalyzeStudio />
    </div>
  );
}
