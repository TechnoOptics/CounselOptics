import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { TemplateStudio } from './template-studio';

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
      <header>
        <p className="eyebrow mb-1">Counsel · templates</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Document templates
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Generate a complete, professionally drafted contract or
          legal document on {ctx.firm.name}&rsquo;s letterhead.
          Branded, clean prose (no AI tells), viewable and exportable
          as PDF.
        </p>
      </header>
      <TemplateStudio
        brand={{
          title: 'Document',
          brandName,
          firmName: ctx.firm.name,
          logoUrl: ctx.firm.logoUrl ?? null,
          accent: ctx.firm.accentColor,
        }}
      />
    </div>
  );
}
