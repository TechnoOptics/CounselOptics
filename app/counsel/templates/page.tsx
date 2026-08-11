import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { TemplateStudio } from './template-studio';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Templates · Counsel' };

export default async function CounselTemplatesPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const brandName =
    String(
      (ctx.firm.metadata as Record<string, unknown> | null)?.brandName ??
        '',
    ).trim() || ctx.firm.name;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        eyebrow={<T>Counsel · templates</T>}
        title={<T>Document templates</T>}
        subtitle={
          <>
            <T>Draft a complete contract or legal document on</T>{' '}
            <span data-no-translate>{ctx.firm.name}</span>
            <T>&rsquo;s letterhead, then read it and export it as a PDF.</T>
          </>
        }
      />
      <TemplateStudio
        brand={{
          title: 'Document',
          brandName,
          firmName: ctx.firm.name,
          logoUrl: ctx.firm.logoUrl ?? null,
          letterheadUrl: ctx.firm.letterheadUrl ?? null,
          accent: ctx.firm.accentColor,
        }}
      />
    </div>
  );
}
