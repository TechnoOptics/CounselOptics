'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createFirmCaseAction } from '@/lib/firm-actions';
import { CASE_TYPES } from '@/lib/types';
import type { Posture } from '@/lib/types';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * "New matter" affordance for the firm cases list. Before this, a firm
 * could only get a case via Import or intake-conversion; this opens a
 * blank matter directly. Minimal by design - title, subject, type,
 * jurisdiction, posture - then routes into the new case detail where
 * the rest (deadlines, time, assignee) lives.
 */
export function NewMatterButton({ firmId }: { firmId: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [caseType, setCaseType] = useState<string>(CASE_TYPES[0]);
  const [posture, setPosture] = useState<Posture>('claimant');
  const [jurisdictionState, setJurisdictionState] = useState('');

  function submit() {
    setError(null);
    if (!title.trim()) {
      setError(t('Give the matter a title.'));
      return;
    }
    startTransition(async () => {
      const res = await createFirmCaseAction(firmId, {
        title: title.trim(),
        subject: subject.trim(),
        caseType,
        posture,
        jurisdictionState: jurisdictionState.trim(),
      });
      if (res.ok && res.caseId) {
        router.push(`/counsel/cases/${res.caseId}`);
      } else {
        setError(res.error ?? t('Could not create the matter.'));
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary text-sm shrink-0"
      >
        <T>New matter</T>
      </button>
    );
  }

  return (
    <div className="card p-4 space-y-3 w-full sm:max-w-xl">
      <p className="eyebrow text-[10px]"><T>New matter</T></p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('Matter title')}
        className="input text-sm w-full"
        autoFocus
      />
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={t('Subject (opposing party, person, or business)')}
        className="input text-sm w-full"
        // data-no-translate: this is user-entered matter data.
        data-no-translate
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          value={caseType}
          onChange={(e) => setCaseType(e.currentTarget.value)}
          className="input text-sm"
          aria-label={t('Case type')}
        >
          {CASE_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {ct}
            </option>
          ))}
        </select>
        <select
          value={posture}
          onChange={(e) => setPosture(e.currentTarget.value as Posture)}
          className="input text-sm"
          aria-label={t('Posture')}
        >
          <option value="claimant">{t('Claimant')}</option>
          <option value="defendant">{t('Defendant')}</option>
        </select>
        <input
          value={jurisdictionState}
          onChange={(e) => setJurisdictionState(e.target.value)}
          placeholder={t('State (e.g. CA)')}
          className="input text-sm"
          // data-no-translate: user-entered jurisdiction value.
          data-no-translate
        />
      </div>

      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn-ghost text-sm"
          disabled={pending}
        >
          <T>Cancel</T>
        </button>
        <button
          type="button"
          onClick={submit}
          className="btn-primary text-sm"
          disabled={pending}
        >
          {pending ? <T>Creating...</T> : <T>Create matter</T>}
        </button>
      </div>
    </div>
  );
}
