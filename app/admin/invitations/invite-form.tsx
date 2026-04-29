'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dispatchCounselInviteAction } from '@/lib/firm-actions';
import { FIRM_TYPES, FIRM_TYPE_LABEL, type FirmType } from '@/lib/firm-types';

export function InviteForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentLink, setSentLink] = useState<{ org: string; link: string } | null>(null);

  const [organizationName, setOrganizationName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [firmType, setFirmType] = useState<FirmType>('firm');
  const [inviteNote, setInviteNote] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await dispatchCounselInviteAction({
        organizationName: organizationName.trim(),
        contactEmail: contactEmail.trim(),
        contactName: contactName.trim() || null,
        firmType,
        inviteNote: inviteNote.trim() || null,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not send invitation.');
        return;
      }
      const link =
        typeof window !== 'undefined' && res.grantToken
          ? `${window.location.origin}/counsel/welcome?grant=${res.grantToken}`
          : '';
      setSentLink({ org: organizationName, link });
      setOrganizationName('');
      setContactEmail('');
      setContactName('');
      setInviteNote('');
      setFirmType('firm');
      router.refresh();
    });
  }

  if (sentLink) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg ring-1 ring-emerald-200 dark:ring-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm space-y-1.5">
          <p className="text-emerald-900 dark:text-emerald-100 font-semibold">
            Invitation sent to {sentLink.org}.
          </p>
          {sentLink.link && (
            <>
              <p className="text-[11px] text-emerald-900/85 dark:text-emerald-100/80 uppercase tracking-wider">
                Setup link (also emailed)
              </p>
              <p className="text-[11px] text-emerald-900 dark:text-emerald-100/85 font-mono break-all">
                {sentLink.link}
              </p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSentLink(null)}
          className="btn-ghost text-sm"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Organization name" required>
        <input
          type="text"
          required
          value={organizationName}
          onChange={(e) => setOrganizationName(e.target.value)}
          maxLength={120}
          className="input"
          disabled={pending}
          placeholder="Hartwell &amp; Vance LLP"
        />
      </Field>

      <Field label="Organization type">
        <select
          value={firmType}
          onChange={(e) => setFirmType(e.target.value as FirmType)}
          className="input"
          disabled={pending}
        >
          {FIRM_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIRM_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Contact email" required>
        <input
          type="email"
          required
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          maxLength={200}
          className="input"
          disabled={pending}
          placeholder="partner@example.com"
        />
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1">
          The recipient must sign in with this email to redeem the invitation.
        </p>
      </Field>

      <Field label="Contact name">
        <input
          type="text"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          maxLength={120}
          className="input"
          disabled={pending}
          placeholder="Optional - personalises the email"
        />
      </Field>

      <Field label="Personal note">
        <textarea
          value={inviteNote}
          onChange={(e) => setInviteNote(e.target.value)}
          rows={3}
          maxLength={600}
          className="input resize-y"
          disabled={pending}
          placeholder="Optional - shown in the invitation email."
        />
      </Field>

      {error && (
        <p className="text-[12px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 rounded-md px-3 py-2 border border-rose-200 dark:border-rose-700/30">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn-primary w-full text-sm"
      >
        {pending ? 'Sending...' : 'Send invitation'}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[12px] font-medium text-ink-700 dark:text-cream-100/75">
        {label}
        {required && <span className="text-rose-600 dark:text-rose-400 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
