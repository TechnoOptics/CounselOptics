import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { SettingsForm } from './settings-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Firm settings · Counsel' };

export default async function CounselSettingsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  if (ctx.membership.role !== 'owner' && ctx.membership.role !== 'admin') {
    redirect('/counsel');
  }
  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Firm settings</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {ctx.firm.name}
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Update the firm&rsquo;s name, brand, jurisdictions, and practice areas.
        </p>
      </header>
      <SettingsForm
        firmId={ctx.firm.id}
        defaultValues={{
          name: ctx.firm.name,
          accentColor: ctx.firm.accentColor,
          logoUrl: ctx.firm.logoUrl ?? '',
          jurisdictions: ctx.firm.jurisdictions,
          practiceAreas: ctx.firm.practiceAreas,
        }}
      />
    </div>
  );
}
