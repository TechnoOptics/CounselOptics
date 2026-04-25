import Link from 'next/link';
import { createCaseAction } from '@/lib/actions';
import { CASE_TYPES } from '@/lib/types';
import { Disclaimer } from '@/components/Disclaimer';

export default function NewCasePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/cases" className="text-sm text-ink-500 hover:text-ink-700">
          &larr; Back to cases
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight mt-2">New case file</h1>
        <p className="text-sm text-ink-600">
          Capture the basics now &mdash; you can upload evidence and add notes after creating.
        </p>
      </div>

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
                <span className="font-medium text-ink-950 block text-sm">
                  Claimant / plaintiff
                </span>
                <span className="text-xs text-ink-500 block mt-0.5">
                  You are bringing the matter — building a case to take to an attorney or
                  pursue.
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
                  Someone is taking you to court — preparing a defense, possibly pro se.
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
            placeholder="e.g., Apartment lease dispute &mdash; 2026"
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
              placeholder="Person or business"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="subjectType">
              Subject type
            </label>
            <select id="subjectType" name="subjectType" className="input" defaultValue="person">
              <option value="person">Person</option>
              <option value="business">Business</option>
              <option value="matter">Matter</option>
              <option value="state">State / government</option>
              <option value="entity">Entity / organization</option>
            </select>
          </div>
        </div>

        <div>
          <label className="label">Jurisdiction</label>
          <div className="grid md:grid-cols-3 gap-3">
            <input
              name="country"
              required
              placeholder="Country (required)"
              className="input"
            />
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

      <Disclaimer />
    </div>
  );
}
