import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { employeeWantsEmail } from '@/lib/notify-prefs';
import { ProfileForm } from './profile-form';
import { PageHeader } from '@/components/counsel/ui';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · Hub' };

export default async function HubProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal/profile');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const admin = createAdminSupabase();
  // One preference, because one is what the send paths honour. The read
  // rule lives in lib/notify-prefs.ts so the page and the mailers cannot
  // disagree about what an absent key means.
  let prefs = { email: true };
  if (admin) {
    const { data } = await admin
      .from('firm_employees')
      .select('notify_prefs')
      .eq('user_id', user.id)
      .is('deactivated_at', null)
      .limit(1)
      .maybeSingle();
    const r = data as { notify_prefs?: Record<string, unknown> | null } | null;
    if (r) prefs = { email: employeeWantsEmail(r.notify_prefs) };
  }

  return (
    <div className="max-w-2xl space-y-7 animate-fade-up">
      <PageHeader
        eyebrow={persona.firm.name}
        title={<>Profile &amp; notifications</>}
        subtitle={
          <>
            Choose whether {persona.firm.name}&rsquo;s legal team emails you
            when they reply to one of your requests.
          </>
        }
      />

      <div className="popup-panel p-5 sm:p-6">
        <p className="text-[12px] text-cream-100/55 mb-1">Signed in as</p>
        <p className="text-sm text-cream-100 font-medium">
          {persona.employee.displayName || persona.employee.email}
        </p>
        <p className="text-[12px] text-cream-100/55">
          {persona.employee.email}
        </p>
      </div>

      <ProfileForm defaultPrefs={prefs} />
    </div>
  );
}
