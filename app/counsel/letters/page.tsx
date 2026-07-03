import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmCases } from '@/lib/firm-storage';
import { LettersStudio } from './letters-studio';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Letters · Counsel' };

export default async function CounselLettersPage({
  searchParams,
}: {
  searchParams: { caseId?: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const cases = await listFirmCases(ctx.firm.id);
  const caseOptions = cases.map((c) => ({ id: c.id, title: c.title }));
  const initialCaseId =
    searchParams.caseId && caseOptions.some((c) => c.id === searchParams.caseId)
      ? searchParams.caseId
      : undefined;

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Counsel · letters</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Draft a letter
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Describe what you need and Advottic drafts a letter on{' '}
          {ctx.firm.name}&rsquo;s letterhead. Choose what the signature block
          includes, edit the draft, then export it as Word or PDF or attach it
          to a case.
          {!ctx.firm.letterheadUrl && (
            <>
              {' '}
              No letterhead yet? Add one in{' '}
              <a href="/counsel/settings" className="underline">
                Firm settings
              </a>{' '}
              — until then we compose one from your logo and firm name.
            </>
          )}
        </p>
      </header>
      <LettersStudio
        brand={{
          firmName: ctx.firm.name,
          logoUrl: ctx.firm.logoUrl ?? null,
          letterheadUrl: ctx.firm.letterheadUrl ?? null,
          accent: ctx.firm.accentColor,
        }}
        cases={caseOptions}
        initialCaseId={initialCaseId}
      />
    </div>
  );
}
