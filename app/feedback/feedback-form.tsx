'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { submitFeedbackAction, type SubmitFeedbackResult } from '@/lib/actions';

const CATEGORIES: { value: 'bug' | 'suggestion' | 'praise' | 'other'; label: string; help: string }[] = [
  { value: 'bug', label: 'Something broke', help: 'A button, page, or feature did not work as expected.' },
  { value: 'suggestion', label: 'I have an idea', help: 'A feature or improvement you would like to see.' },
  { value: 'praise', label: 'Something good', help: 'Tell us what worked - we share these with the team.' },
  { value: 'other', label: 'Other', help: 'Anything else.' },
];

/**
 * User-facing feedback form. Captures the URL the user was on and the
 * user-agent string so admins can reproduce bug reports without making
 * the user describe their setup.
 */
export function FeedbackForm() {
  const [state, formAction] = useFormState<SubmitFeedbackResult | null, FormData>(
    submitFeedbackAction,
    null,
  );
  const [category, setCategory] = useState<'bug' | 'suggestion' | 'praise' | 'other'>(
    'suggestion',
  );
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setCategory('suggestion');
    }
  }, [state]);

  const [urlAtSubmit, setUrlAtSubmit] = useState('');
  const [userAgent, setUserAgent] = useState('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setUrlAtSubmit(document.referrer || window.location.origin);
    setUserAgent(navigator.userAgent || '');
  }, []);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="card p-6 space-y-5"
      aria-label="Submit feedback"
    >
      <input type="hidden" name="urlAtSubmit" value={urlAtSubmit} />
      <input type="hidden" name="userAgent" value={userAgent} />

      {state?.ok && (
        <div
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          <p className="font-semibold mb-0.5">Thank you.</p>
          <p>Your feedback is in our queue. We read everything submitted here.</p>
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
        <legend className="label mb-2">What kind of feedback is this?</legend>
        <div className="grid gap-2 md:grid-cols-2">
          {CATEGORIES.map((c) => (
            <label
              key={c.value}
              className={`flex flex-col rounded-lg border p-3.5 cursor-pointer transition-all ${
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
              <span className="font-semibold text-ink-950 dark:text-cream-100 text-sm">
                {c.label}
              </span>
              <span className="text-xs text-ink-600 dark:text-cream-100/70 mt-0.5 leading-relaxed">
                {c.help}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label" htmlFor="subject">
          Subject
        </label>
        <input
          id="subject"
          name="subject"
          required
          maxLength={200}
          placeholder="Short summary - e.g., 'Upload button does not work on iPhone'"
          className="input"
        />
      </div>

      <div>
        <label className="label" htmlFor="body">
          Details
        </label>
        <textarea
          id="body"
          name="body"
          required
          rows={6}
          minLength={10}
          maxLength={4000}
          placeholder="What happened, what did you expect to happen, and what would you like us to do? Steps to reproduce help a lot for bug reports."
          className="input resize-y"
        />
        <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1.5">
          We capture your browser, the page you were on, and your account email so we can
          follow up. We do NOT capture case content.
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
      {pending ? 'Sending…' : 'Send feedback'}
    </button>
  );
}
