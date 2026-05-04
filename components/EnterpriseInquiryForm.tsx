'use client';

import { useState } from 'react';
import { submitEnterpriseInquiryAction } from '@/lib/actions';

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
 * action that writes to enterprise_inquiries (Supabase) and emails
 * the admin team. Admin reviews in the dashboard, replies, and
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
        <p className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
          Inquiry received
        </p>
        <h3 className="font-display text-2xl tracking-tight text-cream-100">
          Thanks for reaching out.
        </h3>
        <p className="text-sm leading-relaxed text-cream-100/80">
          A real human will read your inquiry and reply within one business day. While you wait,
          you&apos;re welcome to start a free personal trial - it runs the same software your
          firm would use, just sized for one matter.
        </p>
        <a
          href="/cases/new"
          className="inline-flex items-center gap-2 mt-2 text-sm font-semibold text-gold-300 underline-offset-4 hover:underline"
        >
          Try the personal experience while you wait
          <ArrowRight />
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="firm-name" className="block text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-300 mb-1.5">
          Firm or organization name *
        </label>
        <input
          id="firm-name"
          name="firmName"
          type="text"
          required
          maxLength={200}
          className="w-full rounded-lg border border-cream-100/20 bg-forest-950/60 px-3 py-2.5 text-sm text-cream-100 placeholder-cream-100/35 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
          placeholder="e.g. Smith &amp; Jones LLP"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className="block text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-300 mb-1.5">
            Your name *
          </label>
          <input
            id="contact-name"
            name="contactName"
            type="text"
            required
            maxLength={120}
            className="w-full rounded-lg border border-cream-100/20 bg-forest-950/60 px-3 py-2.5 text-sm text-cream-100 placeholder-cream-100/35 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
            placeholder="Jane Doe"
          />
        </div>
        <div>
          <label htmlFor="contact-role" className="block text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-300 mb-1.5">
            Your role
          </label>
          <input
            id="contact-role"
            name="contactRole"
            type="text"
            maxLength={120}
            className="w-full rounded-lg border border-cream-100/20 bg-forest-950/60 px-3 py-2.5 text-sm text-cream-100 placeholder-cream-100/35 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
            placeholder="Managing Partner"
          />
        </div>
      </div>

      <div>
        <label htmlFor="email" className="block text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-300 mb-1.5">
          Work email *
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={200}
          className="w-full rounded-lg border border-cream-100/20 bg-forest-950/60 px-3 py-2.5 text-sm text-cream-100 placeholder-cream-100/35 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
          placeholder="jane@firm.com"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sector" className="block text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-300 mb-1.5">
            Sector *
          </label>
          <select
            id="sector"
            name="sector"
            required
            defaultValue=""
            className="w-full rounded-lg border border-cream-100/20 bg-forest-950/60 px-3 py-2.5 text-sm text-cream-100 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
          >
            <option value="" disabled>
              Pick one
            </option>
            {SECTORS.map((s) => (
              <option key={s.value} value={s.value} className="bg-forest-950 text-cream-100">
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="size" className="block text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-300 mb-1.5">
            Team size
          </label>
          <select
            id="size"
            name="size"
            defaultValue=""
            className="w-full rounded-lg border border-cream-100/20 bg-forest-950/60 px-3 py-2.5 text-sm text-cream-100 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400"
          >
            <option value="" disabled>
              Pick one
            </option>
            {SIZES.map((s) => (
              <option key={s.value} value={s.value} className="bg-forest-950 text-cream-100">
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="message" className="block text-[11px] tracking-[0.18em] uppercase font-semibold text-gold-300 mb-1.5">
          Anything else we should know?
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          maxLength={2000}
          className="w-full rounded-lg border border-cream-100/20 bg-forest-950/60 px-3 py-2.5 text-sm text-cream-100 placeholder-cream-100/35 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400 resize-none"
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
        className="w-full btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold py-3 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending ? 'Sending...' : 'Request a walkthrough'}
        <ArrowRight />
      </button>
      <p className="text-[11px] text-cream-100/55 leading-relaxed">
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
