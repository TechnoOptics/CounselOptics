'use client';

import { useState } from 'react';
import { submitEnterpriseInquiryAction } from '@/lib/actions';
import { BUTTON_INK, FOCUS, LABEL, LINK } from '@/components/marketing/file';

/**
 * The form sits in the "Talk to us" Section, on the ordinary paper ground
 * (theme-aware forest ink on light, cream on dark), not on the forest cover.
 * `CONTROL` is the one input/select/textarea shape so the seven controls
 * cannot drift from each other: a ruled edge (`border-rule`, the case
 * file's only border colour), a transparent ground rather than a floating
 * card, and the shared `FOCUS` ring.
 */
const CONTROL =
  `w-full rounded-[3px] border border-rule bg-transparent px-3 py-2.5 font-public text-sm text-forest-900 placeholder-ink-400 dark:text-cream-100 dark:placeholder-cream-100/35 ${FOCUS}`;

const SECTORS = [
  { value: 'firm', label: 'Private firm' },
  { value: 'inhouse-corp', label: 'In-house corporate counsel' },
  { value: 'inhouse-other', label: 'In-house, non-corporate' },
  { value: 'legal-aid', label: 'Legal aid / non-profit' },
  { value: 'government', label: 'Government' },
  { value: 'other', label: 'Other' },
];

const SIZES = [
  { value: '1-3', label: '1 - 3 attorneys' },
  { value: '4-10', label: '4 - 10 attorneys' },
  { value: '11-50', label: '11 - 50 attorneys' },
  { value: '51-200', label: '51 - 200 attorneys' },
  { value: '200+', label: '200+ attorneys' },
];

/**
 * Replaces the prior mailto link. Submissions go through a server
 * action that inserts one enterprise_inquiries row (Supabase) and
 * stops there. NOTHING IS SENT: no email, no notification, no
 * webhook, and the table has no trigger beyond updated_at. A new
 * inquiry is seen only when someone opens /admin/enterprise-inquiries
 * and looks. Admin reviews in the dashboard, replies, and
 * eventually sets a custom price in the firm's subscription record
 * for the agreed-upon auto-payment cadence.
 */
export function EnterpriseInquiryForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const formData = new FormData(e.currentTarget);
    try {
      await submitEnterpriseInquiryAction(formData);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your inquiry.');
    } finally {
      setPending(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <p className={LABEL}>Inquiry received</p>
        <h3 className="font-public text-lg font-semibold text-forest-900 dark:text-cream-100">
          Thanks for reaching out.
        </h3>
        <p className="text-sm leading-relaxed text-ink-700 dark:text-cream-100/80">
          A real human will read your inquiry and reply within one business day. While you wait,
          you&apos;re welcome to start a free personal trial - it runs the same software your
          firm would use, just sized for one matter.
        </p>
        <a href="/cases/new" className={`${LINK} inline-flex items-center gap-2 mt-2`}>
          Try the personal experience while you wait
          <ArrowRight />
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="firm-name" className={`${LABEL} block mb-1.5`}>
          Firm or organization name *
        </label>
        <input
          id="firm-name"
          name="firmName"
          type="text"
          required
          maxLength={200}
          className={CONTROL}
          placeholder="e.g. Smith &amp; Jones LLP"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className={`${LABEL} block mb-1.5`}>
            Your name *
          </label>
          <input
            id="contact-name"
            name="contactName"
            type="text"
            required
            maxLength={120}
            className={CONTROL}
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <label htmlFor="contact-role" className={`${LABEL} block mb-1.5`}>
            Your role
          </label>
          <input
            id="contact-role"
            name="contactRole"
            type="text"
            maxLength={120}
            className={CONTROL}
            placeholder="Managing Partner"
          />
        </div>
      </div>

      <div>
        <label htmlFor="email" className={`${LABEL} block mb-1.5`}>
          Work email *
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={200}
          className={CONTROL}
          placeholder="jane@firm.com"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sector" className={`${LABEL} block mb-1.5`}>
            Sector *
          </label>
          <select
            id="sector"
            name="sector"
            required
            defaultValue=""
            className={CONTROL}
          >
            <option value="" disabled>
              Pick one
            </option>
            {SECTORS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="size" className={`${LABEL} block mb-1.5`}>
            Team size
          </label>
          <select
            id="size"
            name="size"
            defaultValue=""
            className={CONTROL}
          >
            <option value="" disabled>
              Pick one
            </option>
            {SIZES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="message" className={`${LABEL} block mb-1.5`}>
          Anything else we should know?
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          maxLength={2000}
          className={`${CONTROL} resize-none`}
          placeholder="Practice areas, what you use today, deadline pressure, anything that helps us prep the demo."
        />
      </div>

      {error && (
        <p className="rounded-lg border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={`${BUTTON_INK} w-full justify-center disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {pending ? 'Sending...' : 'Request a walkthrough'}
        <ArrowRight />
      </button>
      <p className="text-[11px] text-ink-600/80 dark:text-cream-100/55 leading-relaxed">
        By submitting you agree to receive a one-time reply from us. We do not put you on a
        marketing list. We don&apos;t share your contact details with anyone.
      </p>
    </form>
  );
}

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12h14m0 0l-6-6m6 6l-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
