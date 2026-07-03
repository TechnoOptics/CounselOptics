'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { submitFeedbackAction, type SubmitFeedbackResult } from '@/lib/actions';

type Cat = 'bug' | 'suggestion' | 'other';

const CATEGORIES: { value: Cat; label: string; help: string }[] = [
  {
    value: 'bug',
    label: "Something's broken",
    help: 'A page, button, or feature isn’t working as expected.',
  },
  {
    value: 'suggestion',
    label: 'Design or feature request',
    help: 'An improvement or new capability you’d like to see.',
  },
  {
    value: 'other',
    label: 'Question / other',
    help: 'A question, or anything else you want to tell the Advottic team.',
  },
];

/**
 * Enterprise help form. Routes into the same feedback pipeline the
 * Advottic team triages (createFeedback via submitFeedbackAction), so
 * a firm's employees and legal team can open a ticket from inside the
 * app. On success it refreshes so the caller's ticket list updates.
 */
export function SupportTicketForm({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const router = useRouter();
  const [state, formAction] = useFormState<SubmitFeedbackResult | null, FormData>(
    submitFeedbackAction,
    null,
  );
  const [category, setCategory] = useState<Cat>('bug');
  const formRef = useRef<HTMLFormElement | null>(null);
  const [urlAtSubmit, setUrlAtSubmit] = useState('');
  const [userAgent, setUserAgent] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setUrlAtSubmit(window.location.href);
    setUserAgent(navigator.userAgent || '');
  }, []);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setCategory('bug');
      router.refresh();
    }
  }, [state, router]);

  const dark = tone === 'dark';

  return (
    <form ref={formRef} action={formAction} className="card p-5 sm:p-6 space-y-5" aria-label="Open a support ticket">
      <input type="hidden" name="urlAtSubmit" value={urlAtSubmit} />
      <input type="hidden" name="userAgent" value={userAgent} />

      {state?.ok && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          <p className="font-semibold mb-0.5">Ticket opened.</p>
          <p>The Advottic team has it and will follow up by email. It&rsquo;s listed below.</p>
        </div>
      )}
      {state?.error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
        >
          <p className="font-semibold mb-0.5">Could not submit</p>
          <p>{state.error}</p>
        </div>
      )}

      <fieldset>
        <legend className={`label mb-2 ${dark ? 'text-cream-100' : ''}`}>What can we help with?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {CATEGORIES.map((c) => (
            <label
              key={c.value}
              className={`flex flex-col rounded-lg border p-3 cursor-pointer transition-all ${
                category === c.value
                  ? 'border-forest-900 dark:border-gold-500 bg-cream-50 dark:bg-forest-800/70 ring-2 ring-forest-900/15 dark:ring-gold-500/20'
                  : 'border-ink-200 dark:border-forest-700/50 bg-white dark:bg-forest-900/40 hover:border-forest-700 dark:hover:border-gold-500/50'
              }`}
            >
              <input
                type="radio"
                name="category"
                value={c.value}
                checked={category === c.value}
                onChange={() => setCategory(c.value)}
                className="sr-only"
              />
              <span className="font-semibold text-ink-950 dark:text-cream-100 text-[13px]">
                {c.label}
              </span>
              <span className="text-[11px] text-ink-600 dark:text-cream-100/70 mt-0.5 leading-relaxed">
                {c.help}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className={`label ${dark ? 'text-cream-100' : ''}`} htmlFor="support-subject">
          Subject
        </label>
        <input
          id="support-subject"
          name="subject"
          required
          maxLength={200}
          placeholder="Short summary — e.g. “Signing link 404s on mobile”"
          className="input"
        />
      </div>

      <div>
        <label className={`label ${dark ? 'text-cream-100' : ''}`} htmlFor="support-body">
          Details
        </label>
        <textarea
          id="support-body"
          name="body"
          required
          rows={6}
          minLength={10}
          maxLength={4000}
          placeholder="What happened, what you expected, and what you’d like us to do. Steps to reproduce help a lot for bugs."
          className="input resize-y"
        />
        <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1.5">
          We capture the page you were on, your browser, and your account email so we can
          follow up. We do not capture case or matter content.
        </p>
      </div>

      <div className="flex justify-end">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Sending…' : 'Open ticket'}
    </button>
  );
}
