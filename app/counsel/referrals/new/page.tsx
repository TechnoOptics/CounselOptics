import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { ProposeReferralForm } from './propose-referral-form';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New referral · Counsel' };

export default async function NewReferralPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();
  const { data: firmsRaw } = await supabase
    .from('firms')
    .select('id, name, jurisdictions')
    .neq('id', ctx.firm.id)
    .order('name', { ascending: true })
    .limit(200);
  const firms = (firmsRaw ?? []) as Array<{
    id: string;
    name: string;
    jurisdictions: string[] | null;
  }>;
  return (
    <div className="max-w-2xl space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/referrals"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          <T>&larr; Referrals</T>
        </Link>
      </p>
      <header>
        <p className="eyebrow mb-1"><T>Counsel · referrals · new</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Propose a co-counsel referral</T>
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
          <T>Pick a firm on Advottic, write a one-paragraph matter brief, and
          propose a fee split. The other firm sees this in their inbox and
          can accept (with client consent) or pass.</T>
        </p>
      </header>
      <ProposeReferralForm firmId={ctx.firm.id} availableFirms={firms} />
    </div>
  );
}
