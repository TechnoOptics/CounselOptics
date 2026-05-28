'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { createCaseAction, type CreateCaseResult } from '@/lib/actions';
import { CASE_TYPES, type SubjectType } from '@/lib/types';
import { FormLoadingOverlay } from '@/components/LoadingOverlay';
import { SafetyAdvisory } from '@/components/SafetyAdvisory';
import {
  PlaceAutocomplete,
  type AutocompletePlace,
} from '@/components/PlaceAutocomplete';
import { DictationButton } from '@/components/DictationButton';
import { EvidencePicker } from '@/components/EvidencePicker';

const SUBJECT_TYPE_OPTIONS: { value: SubjectType; label: string }[] = [
  { value: 'person', label: 'Person' },
  { value: 'business', label: 'Business' },
  { value: 'matter', label: 'Matter' },
  { value: 'state', label: 'State / government' },
  { value: 'entity', label: 'Entity / organization' },
];

type FieldDef = {
  name: string; // form-key without subj_ prefix
  label: string;
  placeholder?: string;
  type?: 'text' | 'textarea';
  showFor: SubjectType[] | 'all';
};

const SUBJECT_FIELDS: FieldDef[] = [
  {
    name: 'legalName',
    label: 'Full legal name',
    placeholder: 'As it appears on official documents',
    showFor: 'all',
  },
  {
    name: 'alsoKnownAs',
    label: 'Also known as / alias',
    placeholder: 'Nicknames, doing-business-as, prior names',
    showFor: 'all',
  },
  {
    name: 'relationship',
    label: 'Relationship to you',
    placeholder: 'e.g., former landlord, neighbor, vendor, ex-employer',
    showFor: 'all',
  },
  {
    name: 'dateOfBirthApprox',
    label: 'Date of birth (approximate)',
    placeholder: 'e.g., 1985 or "early 40s" - if known',
    showFor: ['person'],
  },
  {
    name: 'businessType',
    label: 'Business structure',
    placeholder: 'LLC, corporation, sole proprietor, partnership',
    showFor: ['business'],
  },
  {
    name: 'registrationNumber',
    label: 'Registration / EIN / business ID',
    placeholder: 'If known - useful for service of process',
    showFor: ['business'],
  },
  {
    name: 'primaryContactName',
    label: 'Primary contact name',
    placeholder: 'Owner, manager, registered agent',
    showFor: ['business', 'entity'],
  },
  {
    name: 'agencyOrDepartment',
    label: 'Agency / department',
    placeholder: 'e.g., Department of Motor Vehicles, City Planning',
    showFor: ['state', 'entity'],
  },
  {
    name: 'jurisdictionLevel',
    label: 'Jurisdiction level',
    placeholder: 'Federal, state, county, or city',
    showFor: ['state', 'entity'],
  },
  {
    name: 'address',
    label: 'Address',
    placeholder: 'Street address, city, state, ZIP',
    type: 'textarea',
    showFor: 'all',
  },
  {
    name: 'phone',
    label: 'Phone',
    placeholder: 'Best number you have',
    showFor: 'all',
  },
  {
    name: 'email',
    label: 'Email',
    placeholder: 'name@example.com',
    showFor: 'all',
  },
  {
    name: 'website',
    label: 'Website',
    placeholder: 'https://...',
    showFor: ['business', 'entity', 'state'],
  },
  {
    name: 'notes',
    label: 'Other identifying details',
    placeholder: 'License plate, professional license #, social handles, anything else useful',
    type: 'textarea',
    showFor: 'all',
  },
];

export function NewCaseForm() {
  const [subjectType, setSubjectType] = useState<SubjectType>('person');
  const [showSubjectDetails, setShowSubjectDetails] = useState(false);
  const [description, setDescription] = useState('');
  // Track the picked jurisdiction so the hearing-location autocomplete
  // can bias suggestions toward courts in the right region. Only the
  // country/state lat-lng (the geometry of the chosen place) drives
  // the bias; we don't strictly restrict so the user can still pick
  // a court a few counties over.
  const [jurisdictionPlace, setJurisdictionPlace] =
    useState<AutocompletePlace | null>(null);
  // Picked structured values for the country/state/city fields, so
  // narrowing dropdowns can cascade. Empty when the user free-typed.
  const [jurisdictionCountryCode, setJurisdictionCountryCode] = useState<string | null>(null);
  const [jurisdictionStateCode, setJurisdictionStateCode] = useState<string | null>(null);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const hearingNotesRef = useRef<HTMLTextAreaElement | null>(null);
  const [state, formAction] = useFormState<CreateCaseResult | null, FormData>(
    createCaseAction,
    null,
  );

  const visibleFields = SUBJECT_FIELDS.filter(
    (f) => f.showFor === 'all' || f.showFor.includes(subjectType),
  );

  return (
    <form action={formAction} className="card p-6 space-y-5">
      {state?.error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
        >
          <p className="font-semibold mb-0.5">Could not create case</p>
          <p>{state.error}</p>
        </div>
      )}
      <div>
        <label className="label">Your posture in this matter</label>
        <div className="grid gap-2 md:grid-cols-3">
          <label className="flex items-start gap-3 rounded-lg border border-ink-200 bg-white p-3.5 cursor-pointer hover:bg-ink-50/40 has-[:checked]:border-ink-900 has-[:checked]:bg-ink-50">
            <input
              type="radio"
              name="posture"
              value="claimant"
              defaultChecked
              className="mt-1"
            />
            <span>
              <span className="font-medium text-ink-950 block text-sm">Claimant / plaintiff</span>
              <span className="text-xs text-ink-500 block mt-0.5">
                You are bringing the matter - building a case to take to an attorney or pursue.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 rounded-lg border border-ink-200 bg-white p-3.5 cursor-pointer hover:bg-ink-50/40 has-[:checked]:border-ink-900 has-[:checked]:bg-ink-50">
            <input type="radio" name="posture" value="defendant" className="mt-1" />
            <span>
              <span className="font-medium text-ink-950 block text-sm">
                Defendant / respondent
              </span>
              <span className="text-xs text-ink-500 block mt-0.5">
                Someone is taking action against you - preparing a response.
              </span>
            </span>
          </label>
          {/* New: "Just tracking" posture - for users who haven't
              committed to a side yet. Common at the start of every
              real-world matter: someone is gathering evidence, taking
              notes, dating events, and only later decides whether to
              file. The downstream case detail page treats this the
              same as 'claimant' for UI affordances but the DB stores
              the distinct value so we don't mislabel evidence as
              "complaint material" until they do file. */}
          <label className="flex items-start gap-3 rounded-lg border border-ink-200 bg-white p-3.5 cursor-pointer hover:bg-ink-50/40 has-[:checked]:border-ink-900 has-[:checked]:bg-ink-50">
            <input type="radio" name="posture" value="tracking" className="mt-1" />
            <span>
              <span className="font-medium text-ink-950 block text-sm">
                Just tracking
              </span>
              <span className="text-xs text-ink-500 block mt-0.5">
                Building a file - not yet a plaintiff or defendant. You're gathering evidence and dating events while you decide what to do.
              </span>
            </span>
          </label>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="title">
          Case title
        </label>
        <input
          id="title"
          name="title"
          required
          placeholder="e.g., Apartment lease dispute - 2026"
          className="input"
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="subjectName">
            Subject name
          </label>
          <input
            id="subjectName"
            name="subjectName"
            required
            placeholder="Person, business, agency, or entity"
            className="input"
          />
        </div>
        <div>
          <label className="label" htmlFor="subjectType">
            Subject type
          </label>
          <select
            id="subjectType"
            name="subjectType"
            className="input"
            value={subjectType}
            onChange={(e) => setSubjectType(e.target.value as SubjectType)}
          >
            {SUBJECT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Optional subject profile */}
      <div className="rounded-xl border border-ink-200 bg-cream-50/40">
        <button
          type="button"
          onClick={() => setShowSubjectDetails((s) => !s)}
          className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left"
        >
          <span>
            <span className="block text-sm font-semibold text-forest-900">
              Subject profile{' '}
              <span className="text-ink-400 font-normal">(optional)</span>
            </span>
            <span className="block text-xs text-ink-500 mt-0.5">
              Address, contact info, identifying details so you don&apos;t have to dig later.
            </span>
          </span>
          <span
            className={`text-xs font-mono text-ink-500 transition-transform ${
              showSubjectDetails ? 'rotate-90' : ''
            }`}
            aria-hidden
          >
            ▶
          </span>
        </button>
        {showSubjectDetails && (
          <div className="px-5 pb-5 pt-1 grid md:grid-cols-2 gap-4 animate-fade-in">
            {visibleFields.map((f) => (
              <div
                key={f.name}
                className={f.type === 'textarea' ? 'md:col-span-2' : ''}
              >
                <label className="label" htmlFor={`subj_${f.name}`}>
                  {f.label}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    id={`subj_${f.name}`}
                    name={`subj_${f.name}`}
                    rows={3}
                    placeholder={f.placeholder}
                    maxLength={2000}
                    className="input resize-y"
                  />
                ) : (
                  <input
                    id={`subj_${f.name}`}
                    name={`subj_${f.name}`}
                    placeholder={f.placeholder}
                    maxLength={400}
                    className="input"
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="label">Where does this case sit?</label>
        <p className="text-xs text-ink-500 mb-2 leading-snug">
          Start typing - we look up real countries, states, and cities so
          your jurisdiction is consistent and the court suggestions below
          stay relevant.
        </p>
        <div className="grid md:grid-cols-3 gap-3">
          <PlaceAutocomplete
            name="country"
            required
            placeholder="Country (required)"
            className="input"
            types={['country']}
            onPlace={(p) => {
              setJurisdictionCountryCode(p.country_code);
              // Picking a new country resets the state code below so
              // the State field doesn't keep a stale value (e.g. MN
              // when the user just switched to Canada).
              setJurisdictionStateCode(null);
              setJurisdictionPlace(p);
            }}
            fallbackHint="Type your country and hit tab."
          />
          <PlaceAutocomplete
            name="state"
            placeholder="State / province"
            className="input"
            types={['administrative_area_level_1']}
            countryRestrictions={
              jurisdictionCountryCode ? [jurisdictionCountryCode] : undefined
            }
            onPlace={(p) => {
              setJurisdictionStateCode(p.administrative_area_level_1_code);
              // The state place has lat/lng, which we use to bias
              // the court-location autocomplete further down.
              setJurisdictionPlace(p);
            }}
            fallbackHint="Type your state or province and hit tab."
          />
          <PlaceAutocomplete
            name="city"
            placeholder="City / county"
            className="input"
            types={['(cities)']}
            countryRestrictions={
              jurisdictionCountryCode ? [jurisdictionCountryCode] : undefined
            }
            onPlace={(p) => {
              // Locality result is preferred but counties (admin
              // level 2) also come through. Either way we pick up a
              // tighter lat/lng for the court bias.
              setJurisdictionPlace(p);
            }}
            fallbackHint="Type the city or county where the matter sits."
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="caseType">
          Case type
        </label>
        <select id="caseType" name="caseType" className="input" defaultValue="Other">
          {CASE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="label !mb-0" htmlFor="description">
            Description / context
          </label>
          {/* Dictation tied to the description textarea by id. The
              button captures the mic, streams interim Web Speech API
              results into the textarea at the cursor, and fires the
              normal onChange so SafetyAdvisory mid-typing detection
              continues to work. */}
          <DictationButton
            targetRef={descriptionRef}
            title="Click then speak. The transcription will type into the description box at the cursor."
          />
        </div>
        <textarea
          id="description"
          name="description"
          ref={descriptionRef}
          rows={5}
          placeholder="Brief summary of what happened and why you're opening this file. Click the Dictate button to speak it instead."
          className="input resize-y"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <SafetyAdvisory text={description} />
      </div>

      {/* Hearing date - optional, can be edited later from the case detail. */}
      <div className="rounded-xl border border-ink-200 bg-cream-50/40 p-5">
        <p className="text-sm font-semibold text-forest-900">
          Upcoming hearing{' '}
          <span className="text-ink-400 font-normal">(optional)</span>
        </p>
        <p className="text-xs text-ink-500 mt-0.5 leading-relaxed">
          If you have a court date or deadline, set it here. Advottic will surface a countdown
          and a pre-hearing checklist on the case page.
        </p>
        <div className="grid gap-4 md:grid-cols-2 mt-4">
          <div>
            <label className="label" htmlFor="hearingAt">
              Date &amp; time
            </label>
            <input
              id="hearingAt"
              name="hearingAt"
              type="datetime-local"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="hearingLocation">
              Location
            </label>
            {/* Court / hearing location. Biased to the jurisdiction
                picked above (lat/lng of the chosen state or city) so
                the user gets local courts at the top of the list -
                Hennepin County District Court before Hennepin
                Healthcare. types=['establishment'] keeps us in
                buildings, not bare addresses. Falls back to free
                text on any Places error. */}
            <PlaceAutocomplete
              name="hearingLocation"
              placeholder="Search for the court or courtroom address"
              className="input"
              types={['establishment']}
              countryRestrictions={
                jurisdictionCountryCode ? [jurisdictionCountryCode] : undefined
              }
              locationBiasLatLng={
                jurisdictionPlace?.lat != null && jurisdictionPlace?.lng != null
                  ? { lat: jurisdictionPlace.lat, lng: jurisdictionPlace.lng }
                  : undefined
              }
              locationBiasRadiusM={75_000}
              fallbackHint="Type the court name. Maps suggestions appear under your jurisdiction."
            />
          </div>
          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="label !mb-0" htmlFor="hearingNotes">
                Notes (judge, case number, deadlines)
              </label>
              <DictationButton
                targetRef={hearingNotesRef}
                title="Dictate hearing notes - useful right after a docket call."
              />
            </div>
            <textarea
              id="hearingNotes"
              name="hearingNotes"
              ref={hearingNotesRef}
              rows={2}
              maxLength={2000}
              className="input resize-y"
              placeholder="e.g., Hon. J. Smith - case 27-CV-26-1234 - bring filed Answer + 3 copies"
            />
          </div>
        </div>
      </div>

      {/* Evidence picker: pull existing exhibits from the user's
          Vault or Contracts and tag them onto this case at creation
          time. Saves the "create case then re-upload everything"
          friction that's killed real users on the existing flow.
          Component is fully self-contained: fetches vault + contract
          items via /api/cases/new-evidence, renders chip list, and
          serializes selected ids into a hidden form field for the
          createCaseAction to consume. */}
      <EvidencePicker
        hiddenFieldName="attachedItems"
        helperText="Add documents, photos, or contracts you already have - we'll attach them to this case as exhibits."
      />

      <div className="flex items-center justify-end gap-3 pt-2">
        <Link href="/cases" className="btn-secondary">
          Cancel
        </Link>
        <SubmitButton />
      </div>
      <FormLoadingOverlay label="Creating your case file" />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Creating...' : 'Create case'}
    </button>
  );
}
