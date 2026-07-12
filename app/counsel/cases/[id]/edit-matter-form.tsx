'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { updateFirmCaseAction } from '@/lib/firm-actions';
import { CASE_TYPES, SUBJECT_TYPE_LABEL } from '@/lib/types';
import type { Posture, SubjectProfile, SubjectType } from '@/lib/types';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { AdvotticPulse } from '@/components/AdvotticPulse';

const SUBJECT_TYPES: SubjectType[] = ['person', 'business', 'entity', 'state', 'matter'];

export type EditMatterInitial = {
  title: string;
  subject: string;
  subjectType: SubjectType;
  caseType: string;
  posture: Posture;
  country: string;
  state: string;
  city: string;
  description: string;
  profile: Record<string, string>;
  hearingAt: string; // datetime-local value or ''
  hearingLocation: string;
  hearingNotes: string;
};

/**
 * Edit an existing firm matter's details in place: fix a typo, correct the
 * opposing party's name or the business, update jurisdiction / hearing. Mirrors
 * the New matter form but pre-filled and calling updateFirmCaseAction.
 */
export function EditMatterForm({
  firmId,
  caseId,
  initial,
  children,
}: {
  firmId: string;
  caseId: string;
  initial: EditMatterInitial;
  /** Rendered inside the open editor (e.g. the Case images panel), so images
   *  live with the rest of the editable matter details. */
  children?: ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(initial.title);
  const [subject, setSubject] = useState(initial.subject);
  const [subjectType, setSubjectType] = useState<SubjectType>(initial.subjectType);
  const [caseType, setCaseType] = useState(initial.caseType);
  const [posture, setPosture] = useState<Posture>(initial.posture);
  const [description, setDescription] = useState(initial.description);
  const [country, setCountry] = useState(initial.country);
  const [state, setState] = useState(initial.state);
  const [city, setCity] = useState(initial.city);
  const [profile, setProfile] = useState<SubjectProfile>(initial.profile as SubjectProfile);
  const setP = (k: keyof SubjectProfile, v: string) => setProfile((p) => ({ ...p, [k]: v }));
  const [hearingAt, setHearingAt] = useState(initial.hearingAt);
  const [hearingLocation, setHearingLocation] = useState(initial.hearingLocation);
  const [hearingNotes, setHearingNotes] = useState(initial.hearingNotes);

  function reset() {
    setTitle(initial.title);
    setSubject(initial.subject);
    setSubjectType(initial.subjectType);
    setCaseType(initial.caseType);
    setPosture(initial.posture);
    setDescription(initial.description);
    setCountry(initial.country);
    setState(initial.state);
    setCity(initial.city);
    setProfile(initial.profile as SubjectProfile);
    setHearingAt(initial.hearingAt);
    setHearingLocation(initial.hearingLocation);
    setHearingNotes(initial.hearingNotes);
    setError(null);
  }

  function save() {
    setError(null);
    if (!title.trim()) {
      setError(t('Give the matter a title.'));
      return;
    }
    startTransition(async () => {
      const res = await updateFirmCaseAction(firmId, caseId, {
        title: title.trim(),
        subject: subject.trim(),
        subjectType,
        subjectProfile: profile,
        caseType,
        posture,
        description: description.trim(),
        jurisdictionCountry: country.trim(),
        jurisdictionState: state.trim(),
        jurisdictionCity: city.trim(),
        hearingAt: hearingAt.trim() || null,
        hearingLocation: hearingLocation.trim() || null,
        hearingNotes: hearingNotes.trim() || null,
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save the changes.'));
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-2.5 py-1 text-ink-600 dark:text-cream-100/70 hover:bg-cream-50 dark:hover:bg-forest-800/40"
      >
        <T>Edit details</T>
      </button>
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <p className="eyebrow text-[10px]"><T>Edit matter details</T></p>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('Matter title')} className="input text-sm w-full" data-no-translate />
      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('Opposing party (person, business, or entity)')} className="input text-sm w-full" data-no-translate />

      <div className="grid gap-2 sm:grid-cols-2">
        <select value={subjectType} onChange={(e) => setSubjectType(e.currentTarget.value as SubjectType)} className="input text-sm" aria-label={t('Opposing party type')}>
          {SUBJECT_TYPES.map((s) => (
            <option key={s} value={s}>{t(SUBJECT_TYPE_LABEL[s])}</option>
          ))}
        </select>
        <select value={caseType} onChange={(e) => setCaseType(e.currentTarget.value)} className="input text-sm" aria-label={t('Matter type')}>
          {CASE_TYPES.map((ct) => (
            <option key={ct} value={ct}>{ct}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        <select value={posture} onChange={(e) => setPosture(e.currentTarget.value as Posture)} className="input text-sm" aria-label={t('Posture')}>
          <option value="claimant">{t('Claimant')}</option>
          <option value="defendant">{t('Defendant')}</option>
        </select>
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder={t('Country')} className="input text-sm" data-no-translate />
        <input value={state} onChange={(e) => setState(e.target.value)} placeholder={t('State (e.g. CA)')} className="input text-sm" data-no-translate />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder={t('City')} className="input text-sm" data-no-translate />
      </div>

      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('Summary of the matter and key facts')} rows={3} className="input text-sm w-full resize-y" data-no-translate />

      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3 grid gap-2 sm:grid-cols-2">
        <p className="sm:col-span-2 text-[11px] uppercase tracking-[0.12em] text-ink-400 dark:text-cream-100/40"><T>Opposing party details</T></p>
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

      {/* Party profile (prove-the-case): the dossier shown as a portrait card in
          the matter facts. The photo / logo itself is chosen in Case images. */}
      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3 grid gap-2 sm:grid-cols-2">
        <p className="sm:col-span-2 text-[11px] uppercase tracking-[0.12em] text-ink-400 dark:text-cream-100/40"><T>Party profile</T></p>
        <input value={profile.caseStatus ?? ''} onChange={(e) => setP('caseStatus', e.target.value)} placeholder={t('Status in matter (e.g. Defendant, active)')} className="input text-sm" data-no-translate />
        <input value={profile.location ?? ''} onChange={(e) => setP('location', e.target.value)} placeholder={t('Location')} className="input text-sm" data-no-translate />
        <textarea value={profile.partyRelevance ?? ''} onChange={(e) => setP('partyRelevance', e.target.value)} placeholder={t('Relevance to the matter')} rows={2} className="input text-sm sm:col-span-2 resize-y" data-no-translate />
        {subjectType === 'person' && (
          <>
            <input value={profile.gender ?? ''} onChange={(e) => setP('gender', e.target.value)} placeholder={t('Sex')} className="input text-sm" data-no-translate />
            <input value={profile.height ?? ''} onChange={(e) => setP('height', e.target.value)} placeholder={t('Height')} className="input text-sm" data-no-translate />
            <input value={profile.age ?? ''} onChange={(e) => setP('age', e.target.value)} placeholder={t('Age (e.g. 42 or early 40s)')} className="input text-sm" data-no-translate />
            <input value={profile.race ?? ''} onChange={(e) => setP('race', e.target.value)} placeholder={t('Race')} className="input text-sm" data-no-translate />
            <input value={profile.otherDescriptors ?? ''} onChange={(e) => setP('otherDescriptors', e.target.value)} placeholder={t('Other descriptors')} className="input text-sm" data-no-translate />
          </>
        )}
        <textarea value={profile.roleContext ?? ''} onChange={(e) => setP('roleContext', e.target.value)} placeholder={t('Role in the matter: what you are trying to establish about this party')} rows={2} className="input text-sm sm:col-span-2 resize-y" data-no-translate />
      </div>

      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3 grid gap-2 sm:grid-cols-2">
        <p className="sm:col-span-2 text-[11px] uppercase tracking-[0.12em] text-ink-400 dark:text-cream-100/40"><T>Hearing / key date</T></p>
        <input type="datetime-local" value={hearingAt} onChange={(e) => setHearingAt(e.target.value)} className="input text-sm" aria-label={t('Hearing date and time')} />
        <input value={hearingLocation} onChange={(e) => setHearingLocation(e.target.value)} placeholder={t('Court / location')} className="input text-sm" data-no-translate />
        <textarea value={hearingNotes} onChange={(e) => setHearingNotes(e.target.value)} placeholder={t('Hearing notes')} rows={2} className="input text-sm sm:col-span-2 resize-y" data-no-translate />
      </div>

      {children && (
        <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-ink-400 dark:text-cream-100/40 mb-2"><T>Case images</T></p>
          {children}
        </div>
      )}

      {error && <p className="text-[11px] text-rose-700 dark:text-rose-300">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="btn-ghost text-sm" disabled={pending}>
          <T>Cancel</T>
        </button>
        <button type="button" onClick={save} className="btn-primary text-sm inline-flex items-center" disabled={pending}>
          {pending ? <AdvotticPulse size={16} label={t('Saving…')} /> : <T>Save changes</T>}
        </button>
      </div>
    </div>
  );
}
