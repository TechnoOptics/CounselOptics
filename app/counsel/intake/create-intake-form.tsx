'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMatterIntakeAction } from '@/lib/conflict-check';

/**
 * Generic typed intake.
 *
 * "Intake" is no longer assumed to be an outside-client matter. The
 * Request type dropdown defines what is actually being submitted, and
 * the form adapts:
 *
 *  - `client` mode (New case / matter): the classic law-firm flow -
 *    client identity + opposing/related parties so the conflict check
 *    has names to run against.
 *  - `inhouse` mode (everything else: contracts, internal reviews,
 *    safekeeping, trademark/IP, NDA, vendor/MSA, employment,
 *    compliance, litigation hold, demand): the in-house counsel flow -
 *    who submitted it, which employees are involved, when it is due,
 *    when it expires, priority + confidentiality.
 *
 * Storage is unchanged so no migration is needed: the request type is
 * written to `matter_type` (so the list + detail pages render it with
 * zero changes), in-house parties are mapped onto the existing
 * opposing/related arrays so the conflict check still works, and the
 * remaining in-house metadata rides in the existing `intake_answers`
 * JSON column.
 */

type Mode = 'client' | 'inhouse';

const REQUEST_TYPES: Array<{ value: string; label: string; mode: Mode }> = [
  { value: 'New case / matter', label: 'New case / matter (outside client)', mode: 'client' },
  { value: 'New contract / agreement', label: 'New contract / agreement', mode: 'inhouse' },
  { value: 'Internal review request', label: 'Internal review request', mode: 'inhouse' },
  { value: 'Document for safekeeping', label: 'Document submission for safekeeping', mode: 'inhouse' },
  { value: 'Trademark / IP filing', label: 'Trademark / IP filing', mode: 'inhouse' },
  { value: 'NDA review', label: 'NDA review', mode: 'inhouse' },
  { value: 'Vendor / MSA review', label: 'Vendor / MSA review', mode: 'inhouse' },
  { value: 'Employment matter', label: 'Employment matter', mode: 'inhouse' },
  { value: 'Compliance question', label: 'Compliance question', mode: 'inhouse' },
  { value: 'Litigation hold', label: 'Litigation hold', mode: 'inhouse' },
  { value: 'Demand letter', label: 'Demand letter', mode: 'inhouse' },
  { value: 'Other', label: 'Other', mode: 'inhouse' },
];

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
const CONFIDENTIALITY = [
  'Standard',
  'Confidential',
  'Highly confidential',
  'Privileged',
];

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

export function CreateIntakeForm({
  firmId,
  defaultSubmittedBy = '',
  employeeMode = false,
  redirectBase = '/counsel/intake',
}: {
  firmId: string;
  /**
   * The signed-in member's name/email, forwarded by the server page so
   * "Submitted by" is pre-filled for the common case (an employee
   * filing their own request). Still editable - a paralegal often
   * files on someone else's behalf.
   */
  defaultSubmittedBy?: string;
  /**
   * Employee-portal mode. Outside-client matters are removed (an
   * employee never files those), and "Submitted by" is locked to the
   * signed-in employee. The legal team still sees the full picker.
   */
  employeeMode?: boolean;
  /**
   * Where to send the user after a successful create. The employee
   * portal has no /counsel access, so it routes back to /portal.
   */
  redirectBase?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const availableTypes = employeeMode
    ? REQUEST_TYPES.filter((r) => r.mode === 'inhouse')
    : REQUEST_TYPES;
  const [requestType, setRequestType] = useState(availableTypes[0].value);
  const [opposing, setOpposing] = useState<string[]>(['']);
  const [related, setRelated] = useState<string[]>(['']);

  const mode: Mode =
    REQUEST_TYPES.find((r) => r.value === requestType)?.mode ?? 'client';
  // In employee mode every request is an in-house request, period.
  const inhouse = employeeMode || mode === 'inhouse';

  function submit(formData: FormData) {
    setError(null);
    // In client mode the primary identity is the client; in in-house
    // mode it is the request subject/title. Same DB column either way.
    const subject = String(formData.get('subject') ?? '').trim();
    if (!subject) {
      setError(
        inhouse
          ? 'A short request title is required.'
          : 'Client name is required.',
      );
      return;
    }

    const jurisdictionState =
      String(formData.get('state') ?? '').trim() || null;
    const matterSummary =
      String(formData.get('matterSummary') ?? '').trim() || null;

    let clientEmail: string | null = null;
    let clientPhone: string | null = null;
    const intakeAnswers: Record<string, unknown> = {
      request_type: requestType,
    };

    if (inhouse) {
      const submittedBy =
        String(formData.get('submittedBy') ?? '').trim() || null;
      const dueBy = String(formData.get('dueBy') ?? '').trim() || null;
      const expiry = String(formData.get('expiry') ?? '').trim() || null;
      const priority = String(formData.get('priority') ?? '').trim() || null;
      const confidentiality =
        String(formData.get('confidentiality') ?? '').trim() || null;
      intakeAnswers.submitted_by = submittedBy;
      intakeAnswers.due_by = dueBy;
      intakeAnswers.expiry = expiry;
      intakeAnswers.priority = priority;
      intakeAnswers.confidentiality = confidentiality;
    } else {
      clientEmail = String(formData.get('clientEmail') ?? '').trim() || null;
      clientPhone = String(formData.get('clientPhone') ?? '').trim() || null;
    }

    // Party mapping:
    //  - client mode: opposing = opposing parties, related = related
    //  - in-house mode: opposing = counterparty/other side (vendor,
    //    employee, contracting party), related = employees involved
    //    so the conflict check still has every name it needs.
    startTransition(async () => {
      const res = await createMatterIntakeAction(firmId, {
        clientName: subject,
        clientEmail,
        clientPhone,
        matterType: requestType,
        matterSummary,
        jurisdictionState,
        opposingParties: opposing.map((s) => s.trim()).filter(Boolean),
        relatedParties: related.map((s) => s.trim()).filter(Boolean),
        intakeAnswers,
      });
      if (res.ok && res.intakeId) {
        // Legal lands on the conflict-check detail page; an employee
        // has no detail route (and no business seeing it), so they go
        // back to their request list.
        router.push(
          employeeMode ? redirectBase : `${redirectBase}/${res.intakeId}`,
        );
      } else {
        setError(res.error ?? 'Could not create intake.');
      }
    });
  }

  return (
    <form action={submit} className="card p-5 sm:p-6 space-y-5">
      <p className="eyebrow">New intake</p>

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Request type{' '}
          <span aria-hidden className="text-rose-600 dark:text-rose-300">
            *
          </span>
          <span className="sr-only">(required)</span>
        </span>
        <select
          name="requestType"
          className="input"
          value={requestType}
          onChange={(e) => setRequestType(e.target.value)}
        >
          {availableTypes.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <span className="block text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-1">
          {inhouse
            ? 'In-house request. Capture who submitted it, who is involved, and when it is due.'
            : 'Outside-client matter. Capture the client and every party so the conflict check can run.'}
        </span>
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block sm:col-span-2">
          {/*
            Audit W20 V3 CR-9: required-field marker. The asterisk +
            aria-required="true" + aria-describedby link to the error
            region make the requirement legible in both the visual and
            the accessibility tree.
          */}
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            {inhouse ? 'Request title / subject' : 'Client name'}{' '}
            <span aria-hidden className="text-rose-600 dark:text-rose-300">
              *
            </span>
            <span className="sr-only">(required)</span>
          </span>
          <input
            name="subject"
            required
            aria-required="true"
            aria-describedby="intake-form-error"
            className="input"
            placeholder={
              inhouse
                ? 'e.g. Acme SaaS renewal - vendor MSA review'
                : undefined
            }
          />
        </label>

        {inhouse ? (
          <>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Submitted by
              </span>
              <input
                name="submittedBy"
                className="input"
                defaultValue={defaultSubmittedBy}
                readOnly={employeeMode}
                aria-readonly={employeeMode || undefined}
                placeholder="Who is filing this request"
              />
              {employeeMode && (
                <span className="block text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-1">
                  Filed as you. Legal will see who submitted this.
                </span>
              )}
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Priority
              </span>
              <select name="priority" className="input" defaultValue="Normal">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Due by
              </span>
              <input name="dueBy" type="date" className="input" />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Expiry / valid until
              </span>
              <input name="expiry" type="date" className="input" />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Confidentiality
              </span>
              <select
                name="confidentiality"
                className="input"
                defaultValue="Standard"
              >
                {CONFIDENTIALITY.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                State
              </span>
              <select name="state" className="input" defaultValue="">
                <option value="">Pick a state</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Client email
              </span>
              <input name="clientEmail" type="email" className="input" />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Phone
              </span>
              <input name="clientPhone" type="tel" className="input" />
            </label>
            <label className="block sm:col-span-2">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                State
              </span>
              <select name="state" className="input" defaultValue="">
                <option value="">Pick a state</option>
                {STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <PartyList
        label={inhouse ? 'Counterparty / other side' : 'Opposing parties'}
        hint={
          inhouse
            ? 'The vendor, contracting party, or other side - whoever this request is against or with.'
            : 'The other side of the dispute (counterparty, defendant, complainant).'
        }
        values={opposing}
        onChange={setOpposing}
      />

      <PartyList
        label={inhouse ? 'Employees involved' : 'Related parties'}
        hint={
          inhouse
            ? 'Employees or internal stakeholders connected to this request.'
            : 'Co-defendants, employers, family members, witnesses - anyone connected to the matter.'
        }
        values={related}
        onChange={setRelated}
      />

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          {inhouse ? 'Details / desired outcome' : 'Matter summary'}
        </span>
        <textarea
          name="matterSummary"
          rows={3}
          className="input"
          placeholder={
            inhouse
              ? 'What you need from legal, any background, and what a good outcome looks like.'
              : 'Brief description of what the client is asking for and any deadlines.'
          }
        />
      </label>

      {/*
        Live error region. aria-live="polite" so screen readers
        announce validation failures without interrupting whatever
        the user is reading. id matches the aria-describedby on the
        required input so an AT user navigating the field hears the
        error inline before they submit again.
      */}
      <div
        id="intake-form-error"
        role="status"
        aria-live="polite"
        className={error ? 'block' : 'hidden'}
      >
        {error && (
          <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Creating...' : 'Create intake'}
        </button>
      </div>
    </form>
  );
}

function PartyList({
  label,
  hint,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  function update(idx: number, value: string) {
    const next = values.slice();
    next[idx] = value;
    onChange(next);
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-forest-900 dark:text-cream-100">
        {label}
      </p>
      <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55">{hint}</p>
      <div className="space-y-1.5">
        {values.map((v, i) => (
          <input
            key={i}
            value={v}
            onChange={(e) => update(i, e.target.value)}
            placeholder={`Party ${i + 1}`}
            className="input"
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...values, ''])}
        className="text-[12px] underline text-ink-700 dark:text-cream-100/85"
      >
        Add another
      </button>
    </div>
  );
}
