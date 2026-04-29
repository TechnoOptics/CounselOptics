'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { inviteFirmMemberAction } from '@/lib/firm-actions';
import { FIRM_ROLE_LABEL } from '@/lib/firm-types';

const INVITABLE_ROLES = ['admin', 'attorney', 'paralegal', 'staff'] as const;

export function InviteMemberForm({ firmId }: { firmId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await inviteFirmMemberAction(firmId, formData);
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        setError(res.error ?? 'Could not send invitation.');
      }
    });
  }

  return (
    <form action={submit} className="card p-5 sm:p-6 space-y-3">
      <p className="eyebrow">Invite a teammate</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <input
          name="email"
          type="email"
          required
          placeholder="teammate@example.com"
          className="input sm:col-span-2"
          disabled={pending}
        />
        <select name="role" defaultValue="attorney" className="input" disabled={pending}>
          {INVITABLE_ROLES.map((r) => (
            <option key={r} value={r}>
              {FIRM_ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
          They&rsquo;ll get an email with a 7-day acceptance link.
        </p>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Sending...' : 'Send invitation'}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {ok && (
        <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
          Invitation sent.
        </p>
      )}
    </form>
  );
}
