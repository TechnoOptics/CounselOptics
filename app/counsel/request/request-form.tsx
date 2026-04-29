'use client';

import { useState, useTransition } from 'react';
import { requestCounselAccessAction } from '@/lib/firm-actions';
import { FIRM_TYPES, FIRM_TYPE_LABEL } from '@/lib/firm-types';

const TEAM_SIZES = ['Just me', '2-5', '6-25', '26-100', '100+'];

export function RequestForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await requestCounselAccessAction(formData);
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError(res.error ?? 'Could not submit request.');
      }
    });
  }

  if (submitted) {
    return (
      <section className="card p-7 sm:p-10 text-center space-y-4">
        <p className="text-[10px] uppercase tracking-[0.32em] font-semibold text-gold-300">
          Request received
        </p>
        <h2 className="font-display text-2xl sm:text-3xl font-medium tracking-[-0.01em] text-cream-100">
          Thanks. We&rsquo;ll be in touch.
        </h2>
        <p className="text-sm text-cream-100/80 max-w-md mx-auto leading-relaxed">
          The Advottic team reviews every request personally - usually within one
          business day. If approved, you&rsquo;ll get a single-use setup link at the
          email you provided.
        </p>
        <p className="text-[12px] text-cream-100/55">
          A confirmation copy is on its way to your inbox.
        </p>
      </section>
    );
  }

  return (
    <form action={submit} className="card p-6 sm:p-8 space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm font-medium text-cream-100 mb-1.5">
            Organization name
          </span>
          <input
            name="organizationName"
            required
            placeholder="Acme Law Group, PLLC"
            className="input"
            maxLength={120}
            disabled={pending}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-cream-100 mb-1.5">
            Type of organization
          </span>
          <select name="firmType" defaultValue="firm" className="input" disabled={pending}>
            {FIRM_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIRM_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm font-medium text-cream-100 mb-1.5">
            Your name
          </span>
          <input
            name="contactName"
            required
            placeholder="Jane Doe"
            className="input"
            maxLength={120}
            disabled={pending}
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-cream-100 mb-1.5">
            Your role
          </span>
          <input
            name="contactRole"
            placeholder="Managing partner / GC / Director"
            className="input"
            maxLength={120}
            disabled={pending}
          />
        </label>
      </div>
      <label className="block">
        <span className="block text-sm font-medium text-cream-100 mb-1.5">
          Work email
        </span>
        <input
          type="email"
          name="contactEmail"
          required
          placeholder="jane@acmelaw.com"
          className="input"
          maxLength={200}
          disabled={pending}
        />
        <span className="block text-[11px] text-cream-100/55 mt-1">
          The setup link will go to this address. Use a domain you control.
        </span>
      </label>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm font-medium text-cream-100 mb-1.5">
            Team size
          </span>
          <select name="teamSize" defaultValue="" className="input" disabled={pending}>
            <option value="">Select…</option>
            {TEAM_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-cream-100 mb-1.5">
            Primary jurisdictions
          </span>
          <input
            name="jurisdictions"
            placeholder="Minnesota, Wisconsin"
            className="input"
            maxLength={200}
            disabled={pending}
          />
        </label>
      </div>
      <label className="block">
        <span className="block text-sm font-medium text-cream-100 mb-1.5">
          Tell us about your team{' '}
          <span className="text-cream-100/55 font-normal">
            (optional)
          </span>
        </span>
        <textarea
          name="description"
          rows={4}
          placeholder="What do you do today? Why are you looking for Counsel? Anything we should know?"
          className="input resize-y"
          maxLength={2000}
          disabled={pending}
        />
      </label>
      {error && (
        <p className="rounded-lg border border-rose-300/40 bg-rose-950/30 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}
      <div className="flex justify-end pt-1">
        <button
          type="submit"
          className="btn bg-gold-metal text-forest-950 hover:brightness-110 shadow-gold-glow font-semibold px-6 py-3"
          disabled={pending}
        >
          {pending ? 'Sending...' : 'Send request'}
        </button>
      </div>
      <p className="text-[11px] text-cream-100/55 text-center">
        We never share your information. Reviews are done by the Advottic team only.
      </p>
    </form>
  );
}
