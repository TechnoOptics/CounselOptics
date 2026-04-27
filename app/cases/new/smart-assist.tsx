'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { createCaseAction, type CreateCaseResult } from '@/lib/actions';
import { CASE_TYPES, type SubjectType } from '@/lib/types';
import { FormLoadingOverlay } from '@/components/LoadingOverlay';
import { SafetyAdvisory } from '@/components/SafetyAdvisory';

/**
 * Card-based "smart assist" new case flow. Each step is one card; the
 * card swipes left when the user clicks Continue, and a back button
 * brings the previous card back. Optional steps surface a Skip button
 * that submits an empty value and advances. Required steps disable
 * Continue until valid. The final card is a review + submit.
 *
 * Internally we maintain a single in-memory state object, then on
 * submit we serialize it into a real <form> that posts to
 * createCaseAction (same server action as the legacy long-form flow).
 */

type SubjectField = { name: string; placeholder?: string };
type Step = {
  id: string;
  title: string;
  description: string;
  optional?: boolean;
  // Predicate: returns the value(s) we'd serialize and a `valid` flag.
  // For optional fields, valid is always true.
  render: (
    state: WizardState,
    update: (patch: Partial<WizardState>) => void,
  ) => React.ReactNode;
  isValid: (state: WizardState) => boolean;
  // Some steps are conditional (e.g. subject-detail steps depend on
  // subjectType). Steps return false from `visible` when they should
  // be skipped automatically.
  visible?: (state: WizardState) => boolean;
};

type WizardState = {
  posture: 'claimant' | 'defendant';
  title: string;
  subjectName: string;
  subjectType: SubjectType;
  country: string;
  state: string;
  city: string;
  caseType: string;
  description: string;
  // Subject profile fields (subj_*)
  subj_legalName: string;
  subj_alsoKnownAs: string;
  subj_relationship: string;
  subj_address: string;
  subj_email: string;
  subj_phone: string;
  subj_website: string;
  subj_notes: string;
  subj_dateOfBirthApprox: string;
  subj_registrationNumber: string;
  subj_businessType: string;
  subj_primaryContactName: string;
  subj_agencyOrDepartment: string;
  subj_jurisdictionLevel: string;
  // Hearing
  hearingAt: string;
  hearingLocation: string;
  hearingNotes: string;
};

const initial: WizardState = {
  posture: 'claimant',
  title: '',
  subjectName: '',
  subjectType: 'person',
  country: '',
  state: '',
  city: '',
  caseType: 'Other',
  description: '',
  subj_legalName: '',
  subj_alsoKnownAs: '',
  subj_relationship: '',
  subj_address: '',
  subj_email: '',
  subj_phone: '',
  subj_website: '',
  subj_notes: '',
  subj_dateOfBirthApprox: '',
  subj_registrationNumber: '',
  subj_businessType: '',
  subj_primaryContactName: '',
  subj_agencyOrDepartment: '',
  subj_jurisdictionLevel: '',
  hearingAt: '',
  hearingLocation: '',
  hearingNotes: '',
};

const STEPS: Step[] = [
  {
    id: 'posture',
    title: 'What is your role in this matter?',
    description: 'This shapes how Bella and Legal Eye frame everything they suggest.',
    isValid: () => true,
    render: (s, u) => (
      <div className="grid gap-3 md:grid-cols-2">
        <PostureCard
          active={s.posture === 'claimant'}
          title="Claimant / plaintiff"
          body="You are bringing the matter - building a case to take to an attorney or pursue."
          onClick={() => u({ posture: 'claimant' })}
        />
        <PostureCard
          active={s.posture === 'defendant'}
          title="Defendant / respondent"
          body="Someone is taking action against you - preparing a response."
          onClick={() => u({ posture: 'defendant' })}
        />
      </div>
    ),
  },
  {
    id: 'title',
    title: 'Give your case a short, memorable title.',
    description: 'You will see this everywhere. Keep it under 80 characters.',
    isValid: (s) => s.title.trim().length > 0,
    render: (s, u) => (
      <input
        autoFocus
        name="title-preview"
        value={s.title}
        onChange={(e) => u({ title: e.target.value })}
        placeholder="e.g., Apartment lease - 2026"
        className="input text-base"
        maxLength={120}
      />
    ),
  },
  {
    id: 'subject',
    title: 'Who or what is at the center of this case?',
    description: 'Person, business, government agency, or matter. We adjust the next questions accordingly.',
    isValid: (s) => s.subjectName.trim().length > 0,
    render: (s, u) => (
      <div className="space-y-3">
        <input
          autoFocus
          value={s.subjectName}
          onChange={(e) => u({ subjectName: e.target.value })}
          placeholder="Full name, business name, or matter name"
          className="input text-base"
        />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {(['person', 'business', 'matter', 'state', 'entity'] as SubjectType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => u({ subjectType: t })}
              className={`rounded-lg border px-3 py-2.5 text-sm capitalize transition-all ${
                s.subjectType === t
                  ? 'border-forest-900 dark:border-gold-500 bg-cream-50 dark:bg-forest-800/70 text-forest-900 dark:text-cream-100 font-semibold'
                  : 'border-ink-200 dark:border-forest-700/50 text-ink-700 dark:text-cream-100/75 hover:border-forest-700 dark:hover:border-gold-500/50'
              }`}
            >
              {t === 'state' ? 'State / gov' : t}
            </button>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'jurisdiction',
    title: 'Where does the case sit?',
    description: 'Country is required. State and city help Legal Eye reach for the right rules.',
    isValid: (s) => s.country.trim().length > 0,
    render: (s, u) => (
      <div className="grid gap-3">
        <input
          autoFocus
          value={s.country}
          onChange={(e) => u({ country: e.target.value })}
          placeholder="Country (required)"
          className="input"
        />
        <div className="grid grid-cols-2 gap-3">
          <input
            value={s.state}
            onChange={(e) => u({ state: e.target.value })}
            placeholder="State / province"
            className="input"
          />
          <input
            value={s.city}
            onChange={(e) => u({ city: e.target.value })}
            placeholder="City / county"
            className="input"
          />
        </div>
      </div>
    ),
  },
  {
    id: 'caseType',
    title: 'What kind of matter is this?',
    description: 'Pick the closest fit. You can change it later.',
    isValid: () => true,
    render: (s, u) => (
      <select
        autoFocus
        value={s.caseType}
        onChange={(e) => u({ caseType: e.target.value })}
        className="input"
      >
        {CASE_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    ),
  },
  {
    id: 'description',
    title: 'Tell us what happened, in your own words.',
    description: 'A few sentences is enough. Bella will ask follow-ups when needed.',
    optional: true,
    isValid: () => true,
    render: (s, u) => (
      <textarea
        autoFocus
        value={s.description}
        onChange={(e) => u({ description: e.target.value })}
        rows={6}
        placeholder="What happened, when, where, and who is involved?"
        className="input resize-y"
      />
    ),
  },
  {
    id: 'subjectProfile',
    title: 'Add identifying details about the subject?',
    description: 'Address, contact info, and license/registration numbers help with service of process and packet exports.',
    optional: true,
    isValid: () => true,
    render: (s, u) => {
      const fields = subjectFieldsFor(s.subjectType);
      return (
        <div className="grid gap-3 md:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name} className={f.name === 'address' || f.name === 'notes' ? 'md:col-span-2' : ''}>
              <label className="block text-[11px] uppercase tracking-[0.18em] font-semibold text-ink-500 dark:text-cream-100/55 mb-1">
                {labelize(f.name)}
              </label>
              {f.name === 'address' || f.name === 'notes' ? (
                <textarea
                  rows={2}
                  value={(s as unknown as Record<string, string>)[`subj_${f.name}`] ?? ''}
                  onChange={(e) => u({ [`subj_${f.name}`]: e.target.value } as Partial<WizardState>)}
                  placeholder={f.placeholder}
                  className="input resize-y"
                />
              ) : (
                <input
                  value={(s as unknown as Record<string, string>)[`subj_${f.name}`] ?? ''}
                  onChange={(e) => u({ [`subj_${f.name}`]: e.target.value } as Partial<WizardState>)}
                  placeholder={f.placeholder}
                  className="input"
                />
              )}
            </div>
          ))}
        </div>
      );
    },
  },
  {
    id: 'hearing',
    title: 'Have a hearing or deadline coming up?',
    description: 'Add it now and we will surface a countdown and a pre-hearing checklist on the case page.',
    optional: true,
    isValid: () => true,
    render: (s, u) => (
      <div className="grid gap-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Date &amp; time</label>
            <input
              type="datetime-local"
              value={s.hearingAt}
              onChange={(e) => u({ hearingAt: e.target.value })}
              className="input"
            />
          </div>
          <div>
            <label className="label">Location</label>
            <input
              value={s.hearingLocation}
              onChange={(e) => u({ hearingLocation: e.target.value })}
              placeholder="Court name, courtroom"
              className="input"
            />
          </div>
        </div>
        <div>
          <label className="label">Notes (judge, case number, deadlines)</label>
          <textarea
            rows={2}
            value={s.hearingNotes}
            onChange={(e) => u({ hearingNotes: e.target.value })}
            placeholder="e.g., Hon. J. Smith - case 27-CV-26-1234"
            className="input resize-y"
          />
        </div>
      </div>
    ),
  },
  {
    id: 'review',
    title: 'Ready to create the case?',
    description: 'Quick check, then we bring you to the case page where you can upload exhibits and run Legal Eye.',
    isValid: () => true,
    render: (s) => (
      <div className="space-y-2 text-sm">
        <ReviewLine label="Title" value={s.title} />
        <ReviewLine label="Posture" value={s.posture === 'claimant' ? 'Claimant / plaintiff' : 'Defendant / respondent'} />
        <ReviewLine label="Subject" value={`${s.subjectName} (${s.subjectType})`} />
        <ReviewLine
          label="Jurisdiction"
          value={[s.city, s.state, s.country].filter(Boolean).join(', ')}
        />
        <ReviewLine label="Case type" value={s.caseType} />
        {s.description && <ReviewLine label="Description" value={truncate(s.description, 160)} />}
        {s.hearingAt && <ReviewLine label="Hearing" value={`${s.hearingAt}${s.hearingLocation ? ' · ' + s.hearingLocation : ''}`} />}
      </div>
    ),
  },
];

export function SmartAssistForm() {
  const [state, setState] = useState<WizardState>(initial);
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const formRef = useRef<HTMLFormElement | null>(null);
  const [actionState, formAction] = useFormState<CreateCaseResult | null, FormData>(
    createCaseAction,
    null,
  );

  // Filter to visible steps (some steps are conditional in future).
  const steps = useMemo(() => STEPS.filter((s) => !s.visible || s.visible(state)), [state]);
  const step = steps[Math.min(stepIndex, steps.length - 1)];
  const isLast = stepIndex === steps.length - 1;
  const canContinue = step.isValid(state);

  function update(patch: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...patch }));
  }

  function next() {
    if (!canContinue && !step.optional) return;
    setDirection('forward');
    setStepIndex((i) => Math.min(i + 1, steps.length - 1));
  }
  function back() {
    setDirection('back');
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  // On the final step, clicking submit triggers the hidden form which
  // carries every wizard field as a hidden input.
  function submit() {
    formRef.current?.requestSubmit();
  }

  return (
    <div className="space-y-4">
      {/* Progress strip */}
      <div className="flex items-center gap-2">
        {steps.map((s, i) => (
          <span
            key={s.id}
            aria-current={i === stepIndex ? 'step' : undefined}
            className={`h-1 flex-1 rounded-full transition-all ${
              i < stepIndex
                ? 'bg-forest-900 dark:bg-gold-500'
                : i === stepIndex
                  ? 'bg-forest-700 dark:bg-gold-400'
                  : 'bg-ink-200 dark:bg-forest-700/50'
            }`}
          />
        ))}
      </div>
      <p className="text-[11px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300">
        Step {stepIndex + 1} of {steps.length}
        {step.optional && <span className="text-ink-500 dark:text-cream-100/55 ml-2 normal-case tracking-normal">(optional)</span>}
      </p>

      {/* Card */}
      <div className="relative">
        <Card key={step.id} direction={direction}>
          <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {step.title}
          </h2>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            {step.description}
          </p>
          <div className="mt-5">{step.render(state, update)}</div>
        </Card>
      </div>

      {/* Safety advisory: surfaces whenever the user's narrative
          contains urgency cues (threats, injury, self-harm, child
          safety, sexual violence). Sits at wizard level so it persists
          across steps, not just the description step. */}
      <SafetyAdvisory text={`${state.title}\n${state.description}\n${state.subj_notes}`} />

      {actionState?.error && actionState.duplicateOf ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 space-y-2"
        >
          <p className="font-semibold">A similar case already exists</p>
          <p>{actionState.error}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link
              href={`/cases/${actionState.duplicateOf}`}
              className="btn-secondary text-[12.5px] px-3 py-1.5"
            >
              Open existing case
            </Link>
            <button
              type="button"
              onClick={() => {
                if (formRef.current) {
                  const force = formRef.current.querySelector(
                    'input[name="force"]',
                  ) as HTMLInputElement | null;
                  if (force) force.value = '1';
                  formRef.current.requestSubmit();
                }
              }}
              className="btn-ghost text-[12.5px]"
            >
              Create anyway
            </button>
          </div>
        </div>
      ) : actionState?.error ? (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-200"
        >
          <p className="font-semibold mb-0.5">Could not create case</p>
          <p>{actionState.error}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          {stepIndex > 0 && (
            <button type="button" onClick={back} className="btn-ghost text-sm">
              ← Back
            </button>
          )}
          <Link href="/cases" className="text-xs text-ink-500 dark:text-cream-100/55 hover:text-forest-900 dark:hover:text-cream-100">
            Cancel
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {step.optional && !isLast && (
            <button type="button" onClick={next} className="btn-secondary text-sm">
              Skip
            </button>
          )}
          {isLast ? (
            <SubmitButton onSubmit={submit} disabled={!state.title || !state.subjectName || !state.country} />
          ) : (
            <button
              type="button"
              onClick={next}
              disabled={!canContinue && !step.optional}
              className="btn-primary"
            >
              Continue →
            </button>
          )}
        </div>
      </div>

      {/* Form holding every value the server action expects, plus the
          loading veil. The overlay MUST be inside the <form> because
          useFormStatus only reads pending state from its enclosing
          form - rendered outside, the overlay would never light up.
          The form has no visible children (all inputs are type=hidden
          and the overlay positions itself with `fixed inset-0`), so we
          do not need any layout class on the form itself. */}
      <form ref={formRef} action={formAction}>
        {Object.entries(state).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {/* Duplicate-detection bypass. Default empty; the
            "Create anyway" button on the duplicate warning sets this
            to "1" before resubmitting. */}
        <input type="hidden" name="force" defaultValue="" />
        <FormLoadingOverlay label="Creating your case file" />
      </form>
    </div>
  );
}

function SubmitButton({ onSubmit, disabled }: { onSubmit: () => void; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onSubmit}
      disabled={pending || disabled}
      className="btn-primary disabled:opacity-50"
    >
      {pending ? 'Creating...' : 'Create case'}
    </button>
  );
}

function Card({
  children,
  direction,
}: {
  children: React.ReactNode;
  direction: 'forward' | 'back';
}) {
  // Force a re-mount per step so the swipe animation runs every time.
  const [animKey, setAnimKey] = useState(0);
  useEffect(() => {
    setAnimKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      key={animKey}
      className={`card p-6 sm:p-8 ${
        direction === 'forward' ? 'animate-card-forward' : 'animate-card-back'
      }`}
    >
      {children}
    </div>
  );
}

function PostureCard({
  active,
  title,
  body,
  onClick,
}: {
  active: boolean;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-4 transition-all ${
        active
          ? 'border-forest-900 dark:border-gold-500 bg-cream-50 dark:bg-forest-800/70 ring-2 ring-forest-900/15 dark:ring-gold-500/20'
          : 'border-ink-200 dark:border-forest-700/50 bg-white dark:bg-forest-900/40 hover:border-forest-700 dark:hover:border-gold-500/50'
      }`}
    >
      <p className="font-semibold text-ink-950 dark:text-cream-100 text-sm">{title}</p>
      <p className="text-xs text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">{body}</p>
    </button>
  );
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-ink-100 dark:border-forest-700/40 py-1.5 last:border-0">
      <span className="text-[10px] uppercase tracking-[0.2em] font-semibold text-gold-700 dark:text-gold-300 w-28 flex-none">
        {label}
      </span>
      <span className="text-ink-900 dark:text-cream-100 break-words">{value || <span className="italic text-ink-400 dark:text-cream-100/45">not set</span>}</span>
    </div>
  );
}

function subjectFieldsFor(type: SubjectType): SubjectField[] {
  const all: { name: string; for: SubjectType[] | 'all'; placeholder?: string }[] = [
    { name: 'legalName', for: 'all', placeholder: 'As on official documents' },
    { name: 'alsoKnownAs', for: 'all', placeholder: 'Aliases, dba, prior names' },
    { name: 'relationship', for: 'all', placeholder: 'e.g., former landlord, vendor' },
    { name: 'dateOfBirthApprox', for: ['person'], placeholder: 'e.g., 1985 or "early 40s"' },
    { name: 'businessType', for: ['business'], placeholder: 'LLC, corp, sole prop' },
    { name: 'registrationNumber', for: ['business'], placeholder: 'EIN / business ID' },
    { name: 'primaryContactName', for: ['business', 'entity'] },
    { name: 'agencyOrDepartment', for: ['state', 'entity'] },
    { name: 'jurisdictionLevel', for: ['state', 'entity'], placeholder: 'Federal, state, county, city' },
    { name: 'address', for: 'all', placeholder: 'Street, city, state, ZIP' },
    { name: 'phone', for: 'all' },
    { name: 'email', for: 'all' },
    { name: 'website', for: ['business', 'entity', 'state'] },
    { name: 'notes', for: 'all', placeholder: 'License plate, social handles, anything else' },
  ];
  return all.filter((f) => f.for === 'all' || f.for.includes(type));
}

function labelize(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bAlso Known As\b/, 'Also known as')
    .replace(/\bDate Of Birth Approx\b/, 'Date of birth (approx.)')
    .replace(/\bRegistration Number\b/, 'Registration / EIN')
    .replace(/\bPrimary Contact Name\b/, 'Primary contact')
    .replace(/\bAgency Or Department\b/, 'Agency / department')
    .replace(/\bJurisdiction Level\b/, 'Jurisdiction level');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
