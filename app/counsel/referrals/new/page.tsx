import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import { ProposeReferralForm } from './propose-referral-form';
import { PageHeader } from '@/components/counsel/ui';
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
          className="text-muted hover:text-foreground"
        >
          <T>&larr; Referrals</T>
        </Link>
      </p>
      <PageHeader
        eyebrow={<T>Counsel · referrals · new</T>}
        title={<T>Propose a co-counsel referral</T>}
        subtitle={
          <T>Pick a firm on Advottic, write a one-paragraph matter brief, and
          propose a fee split. The other firm sees this in their inbox and
          can accept (with client consent) or pass.</T>
        }
      />
      <ProposeReferralForm firmId={ctx.firm.id} availableFirms={firms} />
    </div>
  );
}
