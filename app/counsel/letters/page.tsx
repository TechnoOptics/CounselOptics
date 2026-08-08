import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmCases } from '@/lib/firm-storage';
import { LettersStudio } from './letters-studio';
import { PageHeader } from '@/components/counsel/ui';
import { firmLetterheadDesign } from '@/lib/letterhead-design';
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

  // A firm has a letterhead if it uploaded an image OR designed one. Asking
  // only about the image told a firm that had just typed its whole address in
  // that it had no letterhead and that we were composing one from its logo,
  // neither of which was true any more.
  const hasLetterhead =
    Boolean(ctx.firm.letterheadUrl) || firmLetterheadDesign(ctx.firm.metadata) !== null;

  const cases = await listFirmCases(ctx.firm.id);
  const caseOptions = cases.map((c) => ({ id: c.id, title: c.title }));
  const initialCaseId =
    searchParams.caseId && caseOptions.some((c) => c.id === searchParams.caseId)
      ? searchParams.caseId
      : undefined;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · letters</T>}
        title={<T>Draft a letter</T>}
        subtitle={
          <>
            <T>Describe what you need and Advottic drafts a letter on</T>{' '}
            <span data-no-translate>{ctx.firm.name}</span>
            <T>&rsquo;s letterhead. Choose what the signature block
            includes, edit the draft, then export it as Word or PDF or attach it
            to a case.</T>
            {!hasLetterhead && (
              <>
                {' '}
                <T>No letterhead yet? Add one in</T>{' '}
                <a href="/counsel/settings" className="underline">
                  <T>Firm settings</T>
                </a>{' '}
                <T>(until then we compose one from your logo and firm name).</T>
              </>
            )}
          </>
        }
      />
      <LettersStudio
        brand={{
          firmName: ctx.firm.name,
          logoUrl: ctx.firm.logoUrl ?? null,
          letterheadUrl: ctx.firm.letterheadUrl ?? null,
          letterheadDesign: firmLetterheadDesign(ctx.firm.metadata),
          accent: ctx.firm.accentColor,
        }}
        cases={caseOptions}
        initialCaseId={initialCaseId}
      />
    </div>
  );
}
