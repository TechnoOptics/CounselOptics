import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getWorkspacePersona } from '@/lib/persona';
import { ProfileForm } from './profile-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · Hub' };

export default async function HubProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/portal/profile');
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const admin = createAdminSupabase();
  let phone = '';
  let prefs = { email: true, sms: false, reminders: true };
  if (admin) {
    const { data } = await admin
      .from('firm_employees')
      .select('phone, notify_prefs')
      .eq('user_id', user.id)
      .is('deactivated_at', null)
      .limit(1)
      .maybeSingle();
    const r = data as {
      phone?: string | null;
      notify_prefs?: Record<string, unknown> | null;
    } | null;
    if (r) {
      phone = r.phone ?? '';
      const p = r.notify_prefs ?? {};
      prefs = {
        email: p.email !== false,
        sms: p.sms === true,
        reminders: p.reminders !== false,
      };
    }
  }

  return (
    <div className="max-w-2xl space-y-7 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">{persona.firm.name}</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-cream-100">
          Profile &amp; notifications
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Choose how {persona.firm.name}&rsquo;s legal team reaches you
          about replies, meetings, and anything due.
        </p>
      </header>

      <div className="popup-panel p-5 sm:p-6">
        <p className="text-[12px] text-cream-100/55 mb-1">Signed in as</p>
        <p className="text-sm text-cream-100 font-medium">
          {persona.employee.displayName || persona.employee.email}
        </p>
        <p className="text-[12px] text-cream-100/55">
          {persona.employee.email}
        </p>
      </div>

      <ProfileForm
        defaultPhone={phone}
        defaultPrefs={prefs}
      />
    </div>
  );
}
