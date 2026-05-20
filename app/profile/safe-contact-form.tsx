'use client';

import { useState, useTransition } from 'react';
import { updateSafeWitnessConfigAction } from '@/lib/actions';

const DEFAULT_MESSAGE =
  'Safe mode activated. I need you. Please send help.';

/**
 * Safe Witness configuration on /profile. Three fields:
 *
 *   - Contact email (required to enable the feature)
 *   - PIN: a short pre-shared code the user + their contact agreed
 *     on, included in every alert email so the contact can verify
 *     it's genuinely from this user (and not a stalker who
 *     grabbed the watch).
 *   - Message: the first line the contact reads in the alert
 *     email. Defaults to the canned "I need help" line when
 *     empty.
 *
 * Empty contact disables the feature entirely. The PIN and
 * message persist whether the feature is enabled or not, so
 * toggling the feature back on doesn't make the user re-enter
 * them.
 */
export function SafeContactForm({
  initial,
}: {
  initial: {
    email: string | null;
    pin: string | null;
    message: string | null;
  };
}) {
  const [email, setEmail] = useState(initial.email ?? '');
  const [pin, setPin] = useState(initial.pin ?? '');
  const [message, setMessage] = useState(initial.message ?? '');
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    null | { kind: 'ok'; text: string } | { kind: 'error'; text: string }
  >(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('safeContactEmail', email.trim());
      fd.set('safeWitnessPin', pin.trim());
      fd.set('safeWitnessMessage', message.trim());
      const res = await updateSafeWitnessConfigAction(fd);
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error });
        return;
      }
      setFeedback({
        kind: 'ok',
        text: res.email
          ? `Saved. Next press-and-hold of Safe Witness on your watch alerts ${res.email}.`
          : 'Safe Witness disabled. No contact will be alerted.',
      });
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="block text-[12px] uppercase tracking-[0.16em] text-ink-500 dark:text-cream-100/55 mb-1">
          Contact email
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="someone@example.com"
          className="input"
          disabled={pending}
          autoComplete="email"
          inputMode="email"
        />
        <span className="block text-[11px] text-ink-500 dark:text-cream-100/45 mt-1 leading-relaxed">
          The person Advottic emails when you press-and-hold Safe
          Witness on your watch. Required to enable the feature.
        </span>
      </label>

      <label className="block">
        <span className="block text-[12px] uppercase tracking-[0.16em] text-ink-500 dark:text-cream-100/55 mb-1">
          PIN (shared with your contact)
        </span>
        <input
          type="text"
          value={pin}
          onChange={(e) => setPin(e.target.value.slice(0, 64))}
          placeholder="e.g. 4429"
          className="input font-mono tracking-[0.2em]"
          disabled={pending}
          autoComplete="off"
          inputMode="numeric"
          maxLength={64}
        />
        <span className="block text-[11px] text-ink-500 dark:text-cream-100/45 mt-1 leading-relaxed">
          A short code you&rsquo;ve told your contact in person. It
          appears in every alert email so they know the message is
          really from you. Pick something only the two of you would
          know.
        </span>
      </label>

      <label className="block">
        <span className="block text-[12px] uppercase tracking-[0.16em] text-ink-500 dark:text-cream-100/55 mb-1">
          Message they&rsquo;ll see
        </span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 500))}
          placeholder={DEFAULT_MESSAGE}
          rows={3}
          className="input"
          disabled={pending}
          maxLength={500}
        />
        <span className="block text-[11px] text-ink-500 dark:text-cream-100/45 mt-1 leading-relaxed">
          The first line your contact reads. Leave blank for the
          default: &ldquo;{DEFAULT_MESSAGE}&rdquo;
        </span>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary text-[13px] px-4 py-2 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save Safe Witness setup'}
        </button>
        {initial.email && (
          <button
            type="button"
            onClick={() => {
              setEmail('');
            }}
            disabled={pending}
            className="text-[12px] text-ink-500 dark:text-cream-100/55 hover:text-ink-900 dark:hover:text-cream-100 underline"
            title="Clearing the contact email disables the feature; PIN + message stay saved."
          >
            Clear contact (disable)
          </button>
        )}
      </div>
      {feedback && (
        <p
          className={`text-[12.5px] rounded-md px-3 py-2 ${
            feedback.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-300/50 dark:ring-emerald-500/30'
              : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-1 ring-rose-300/50 dark:ring-rose-500/30'
          }`}
        >
          {feedback.text}
        </p>
      )}
    </form>
  );
}
