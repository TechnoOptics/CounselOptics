'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createCaseAction } from '@/lib/actions';
import { CASE_TYPES, type SubjectType } from '@/lib/types';

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

  const visibleFields = SUBJECT_FIELDS.filter(
    (f) => f.showFor === 'all' || f.showFor.includes(subjectType),
  );

  return (
    <form action={createCaseAction} className="card p-6 space-y-5">
      <div>
        <label className="label">Your posture in this matter</label>
        <div className="grid gap-2 md:grid-cols-2">
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
        <label className="label">Jurisdiction</label>
        <div className="grid md:grid-cols-3 gap-3">
          <input name="country" required placeholder="Country (required)" className="input" />
          <input name="state" placeholder="State / province" className="input" />
          <input name="city" placeholder="City / county" className="input" />
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
        <label className="label" htmlFor="description">
          Description / context
        </label>
        <textarea
          id="description"
          name="description"
          rows={5}
          placeholder="Brief summary of what happened and why you're opening this file."
          className="input resize-y"
        />
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Link href="/cases" className="btn-secondary">
          Cancel
        </Link>
        <button type="submit" className="btn-primary">
          Create case
        </button>
      </div>
    </form>
  );
}
