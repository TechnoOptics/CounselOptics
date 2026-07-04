import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmCases } from '@/lib/firm-storage';
import { LettersStudio } from './letters-studio';
import { T } from '@/components/i18n/LocaleProvider';

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
        <p className="eyebrow mb-1"><T>Counsel · letters</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Draft a letter</T>
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          <T>Describe what you need and Advottic drafts a letter on</T>{' '}
          {ctx.firm.name}<T>&rsquo;s letterhead. Choose what the signature block
          includes, edit the draft, then export it as Word or PDF or attach it
          to a case.</T>
          {!ctx.firm.letterheadUrl && (
            <>
              {' '}
              <T>No letterhead yet? Add one in</T>{' '}
              <a href="/counsel/settings" className="underline">
                <T>Firm settings</T>
              </a>{' '}
              <T>— until then we compose one from your logo and firm name.</T>
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
