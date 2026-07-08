'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createFirmCaseAction } from '@/lib/firm-actions';
import { CASE_TYPES, SUBJECT_TYPE_LABEL } from '@/lib/types';
import type { Posture, SubjectProfile, SubjectType } from '@/lib/types';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * "New matter" affordance for the firm cases list. Opens a full matter
 * the way a personal case is opened - subject dossier, jurisdiction,
 * description, and hearing - so a firm-created case carries the same
 * substance as a client-created one (the firm often opens the case WITH
 * the client, then invites them). Framed as intake, not self-help: no
 * "call a lawyer" prompts, because the firm is the lawyer.
 *
 * The two dossier/hearing groups are collapsed by default so the common
 * path stays a four-field form; power users expand what they need.
 */
type SubjType = SubjectType;

const SUBJECT_TYPES: SubjType[] = ['person', 'business', 'entity', 'state', 'matter'];

export function NewMatterButton({ firmId }: { firmId: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Core
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [subjectType, setSubjectType] = useState<SubjType>('person');
  const [caseType, setCaseType] = useState<string>(CASE_TYPES[0]);
  const [posture, setPosture] = useState<Posture>('claimant');
  const [description, setDescription] = useState('');

  // Jurisdiction
  const [country, setCountry] = useState('US');
  const [jurisdictionState, setJurisdictionState] = useState('');
  const [city, setCity] = useState('');

  // Opposing-party dossier (collapsible)
  const [showParty, setShowParty] = useState(false);
  const [profile, setProfile] = useState<SubjectProfile>({});
  const setP = (k: keyof SubjectProfile, v: string) =>
    setProfile((p) => ({ ...p, [k]: v }));

  // Hearing (collapsible)
  const [showHearing, setShowHearing] = useState(false);
  const [hearingAt, setHearingAt] = useState('');
  const [hearingLocation, setHearingLocation] = useState('');
  const [hearingNotes, setHearingNotes] = useState('');

  function reset() {
    setError(null);
    setTitle('');
    setSubject('');
    setSubjectType('person');
    setCaseType(CASE_TYPES[0]);
    setPosture('claimant');
    setDescription('');
    setCountry('US');
    setJurisdictionState('');
    setCity('');
    setShowParty(false);
    setProfile({});
    setShowHearing(false);
    setHearingAt('');
    setHearingLocation('');
    setHearingNotes('');
  }

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
        subjectType,
        subjectProfile: profile,
        caseType,
        posture,
        description: description.trim(),
        jurisdictionCountry: country.trim(),
        jurisdictionState: jurisdictionState.trim(),
        jurisdictionCity: city.trim(),
        hearingAt: hearingAt.trim() || null,
        hearingLocation: hearingLocation.trim() || null,
        hearingNotes: hearingNotes.trim() || null,
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
        data-no-translate
      />
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={t('Opposing party (person, business, or entity)')}
        className="input text-sm w-full"
        // data-no-translate: user-entered matter data.
        data-no-translate
      />

      <div className="grid gap-2 sm:grid-cols-2">
        <select
          value={subjectType}
          onChange={(e) => setSubjectType(e.currentTarget.value as SubjType)}
          className="input text-sm"
          aria-label={t('Opposing party type')}
        >
          {SUBJECT_TYPES.map((s) => (
            <option key={s} value={s}>
              {t(SUBJECT_TYPE_LABEL[s])}
            </option>
          ))}
        </select>
        <select
          value={caseType}
          onChange={(e) => setCaseType(e.currentTarget.value)}
          className="input text-sm"
          aria-label={t('Matter type')}
        >
          {CASE_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {ct}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
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
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          placeholder={t('Country')}
          className="input text-sm"
          data-no-translate
        />
        <input
          value={jurisdictionState}
          onChange={(e) => setJurisdictionState(e.target.value)}
          placeholder={t('State (e.g. CA)')}
          className="input text-sm"
          data-no-translate
        />
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder={t('City')}
          className="input text-sm"
          data-no-translate
        />
      </div>

      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('Summary of the matter and key facts')}
        rows={3}
        className="input text-sm w-full resize-y"
        data-no-translate
      />

      {/* Opposing-party dossier */}
      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40">
        <button
          type="button"
          onClick={() => setShowParty((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-[12.5px] text-ink-700 dark:text-cream-100/85"
        >
          <span><T>Opposing party details</T></span>
          <span className="text-ink-400 dark:text-cream-100/40">{showParty ? '-' : '+'}</span>
        </button>
        {showParty && (
          <div className="px-3 pb-3 grid gap-2 sm:grid-cols-2">
            <input value={profile.legalName ?? ''} onChange={(e) => setP('legalName', e.target.value)} placeholder={t('Legal name')} className="input text-sm" data-no-translate />
            <input value={profile.alsoKnownAs ?? ''} onChange={(e) => setP('alsoKnownAs', e.target.value)} placeholder={t('Also known as')} className="input text-sm" data-no-translate />
            <input value={profile.primaryContactName ?? ''} onChange={(e) => setP('primaryContactName', e.target.value)} placeholder={t('Primary contact')} className="input text-sm" data-no-translate />
            <input value={profile.relationship ?? ''} onChange={(e) => setP('relationship', e.target.value)} placeholder={t('Relationship to client')} className="input text-sm" data-no-translate />
            <input value={profile.email ?? ''} onChange={(e) => setP('email', e.target.value)} placeholder={t('Email')} className="input text-sm" data-no-translate />
            <input value={profile.phone ?? ''} onChange={(e) => setP('phone', e.target.value)} placeholder={t('Phone')} className="input text-sm" data-no-translate />
            <input value={profile.businessType ?? ''} onChange={(e) => setP('businessType', e.target.value)} placeholder={t('Entity type (LLC, corp...)')} className="input text-sm" data-no-translate />
            <input value={profile.registrationNumber ?? ''} onChange={(e) => setP('registrationNumber', e.target.value)} placeholder={t('Registration / EIN')} className="input text-sm" data-no-translate />
            <input value={profile.address ?? ''} onChange={(e) => setP('address', e.target.value)} placeholder={t('Address')} className="input text-sm sm:col-span-2" data-no-translate />
            <textarea value={profile.notes ?? ''} onChange={(e) => setP('notes', e.target.value)} placeholder={t('Notes on the opposing party')} rows={2} className="input text-sm sm:col-span-2 resize-y" data-no-translate />
          </div>
        )}
      </div>

      {/* Hearing */}
      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40">
        <button
          type="button"
          onClick={() => setShowHearing((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 text-[12.5px] text-ink-700 dark:text-cream-100/85"
        >
          <span><T>Hearing / key date</T></span>
          <span className="text-ink-400 dark:text-cream-100/40">{showHearing ? '-' : '+'}</span>
        </button>
        {showHearing && (
          <div className="px-3 pb-3 grid gap-2 sm:grid-cols-2">
            <input type="datetime-local" value={hearingAt} onChange={(e) => setHearingAt(e.target.value)} className="input text-sm" aria-label={t('Hearing date and time')} />
            <input value={hearingLocation} onChange={(e) => setHearingLocation(e.target.value)} placeholder={t('Court / location')} className="input text-sm" data-no-translate />
            <textarea value={hearingNotes} onChange={(e) => setHearingNotes(e.target.value)} placeholder={t('Hearing notes')} rows={2} className="input text-sm sm:col-span-2 resize-y" data-no-translate />
          </div>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
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
