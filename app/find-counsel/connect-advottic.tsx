'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitFirmLeadAction } from '@/lib/marketplace-actions';
import { useStepAnchor } from '@/lib/use-step-anchor';

const PRACTICE_AREAS = [
  'Personal injury',
  'Family / divorce',
  'Estate planning / probate',
  'Real estate',
  'Landlord / tenant',
  'Employment',
  'Immigration',
  'Criminal defense',
  'Business / contracts',
  'Intellectual property',
  'Bankruptcy',
  'Tax',
  'Other',
];

const STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

/**
 * Marketplace lead form on /find-counsel. The consumer answers a
 * short questionnaire, the server action creates a firm_leads row,
 * resolves matching firms (by jurisdiction + practice area), drops
 * a notification in each matched firm's inbox, and confirms back.
 *
 * Direct-message fields (email + phone) stay private to firms that
 * the user later accepts; firms only see the lead summary + matter
 * area until the user picks them.
 */
export function ConnectAdvotticForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ matched: number } | null>(null);
  // Re-anchor the form / success card on transition.
  const cardRef = useStepAnchor<HTMLElement>(done ? 'done' : 'form');
  const [areaSelections, setAreaSelections] = useState<Set<string>>(
    new Set(),
  );

  function toggleArea(name: string) {
    setAreaSelections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function submit(formData: FormData) {
    setError(null);
    formData.set('practiceAreas', JSON.stringify(Array.from(areaSelections)));
    startTransition(async () => {
      const res = await submitFirmLeadAction(formData);
      if (res.ok) {
        setDone({ matched: res.matchedFirms ?? 0 });
        router.refresh();
      } else {
        setError(res.error ?? 'Could not submit.');
      }
    });
  }

  if (done) {
    return (
      <section ref={cardRef} className="card p-6 sm:p-8 ring-1 ring-emerald-300/40 dark:ring-emerald-700/40 bg-emerald-50/40 dark:bg-emerald-950/20 scroll-mt-20">
        <p className="eyebrow text-emerald-700 dark:text-emerald-300 mb-2">
          Match request submitted
        </p>
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          You&rsquo;re on the list.
        </h2>
        <p className="text-[14px] text-ink-700 dark:text-cream-100/85 mt-2 leading-relaxed">
          We notified <strong>{done.matched}</strong> firm
          {done.matched === 1 ? '' : 's'} that match your matter and
          jurisdiction. Interested firms will respond within 24 to 48
          hours; you&rsquo;ll see their proposals in your{' '}
          <a href="/inbox" className="underline">
            inbox
          </a>
          . Pick the one that feels right - no obligation until you do.
        </p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-3">
          Your contact details stay private until you accept a firm.
        </p>
      </section>
    );
  }

  return (
    <form
      ref={cardRef as unknown as React.RefObject<HTMLFormElement>}
      action={submit}
      className="card p-5 sm:p-6 space-y-5 scroll-mt-20"
    >
      <div>
        <p className="eyebrow mb-2">Get matched - free</p>
        <h2 className="font-display text-2xl text-forest-900 dark:text-cream-100">
          Connect with an Advottic firm
        </h2>
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
          Tell us about your matter. We send the brief to firms on Advottic
          Counsel that handle your area in your state. They respond, you
          pick. Your contact details stay private until you accept one.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Your name
          </span>
          <input name="contactName" required className="input" autoComplete="name" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Email
          </span>
          <input
            name="contactEmail"
            required
            type="email"
            className="input"
            autoComplete="email"
          />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Phone (optional)
          </span>
          <input name="contactPhone" type="tel" className="input" autoComplete="tel" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            State
          </span>
          <select name="state" required className="input" defaultValue="">
            <option value="" disabled>
              Pick your state
            </option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-forest-900 dark:text-cream-100 mb-2">
          What kind of matter?{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">
            (pick one or more)
          </span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {PRACTICE_AREAS.map((p) => {
            const active = areaSelections.has(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => toggleArea(p)}
                className={`px-3 py-1.5 rounded-md ring-1 text-[12.5px] font-medium transition-colors ${
                  active
                    ? 'bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 ring-transparent'
                    : 'bg-white dark:bg-forest-900/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40'
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Brief summary
        </span>
        <textarea
          name="summary"
          rows={4}
          required
          className="input"
          placeholder="What happened, what you need help with, and any deadline you are facing."
          maxLength={2000}
        />
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Urgency
          </span>
          <select name="urgency" className="input" defaultValue="normal">
            <option value="low">Low - exploring options</option>
            <option value="normal">Normal - within a few weeks</option>
            <option value="high">High - within a week</option>
            <option value="emergency">Emergency - within 48 hours</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Budget (optional)
          </span>
          <input
            name="budget"
            className="input"
            placeholder="e.g. $1,500 flat, or hourly OK, or contingency"
          />
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-relaxed max-w-md">
          Submitting shares this brief with Advottic firms in your state.
          Your name, email, and phone stay private until you accept a firm.
        </p>
        <button
          type="submit"
          className="btn-primary"
          disabled={pending || areaSelections.size === 0}
        >
          {pending ? 'Sending...' : 'Get matched'}
        </button>
      </div>
    </form>
  );
}
