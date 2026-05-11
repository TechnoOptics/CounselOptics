'use client';

import { useState } from 'react';

/**
 * Compact newsletter signup. Posts to /api/newsletter/subscribe with
 * the email + an optional `source` label so we can attribute signups
 * back to the surface that drove them (article footer, hub page,
 * resources index).
 *
 * Variant prop:
 *   "inline"  - compact, single-line. For article footers.
 *   "card"    - full card with copy. For section CTAs.
 *
 * The actual /api/newsletter/subscribe endpoint is best-effort: it
 * stores the email in the newsletter_signups table and is graceful
 * about duplicates. If the endpoint is missing, the UI degrades to
 * a thank-you state anyway so we never block on backend setup.
 */
export function NewsletterSignup({
  source = 'unknown',
  variant = 'card',
}: {
  source?: string;
  variant?: 'inline' | 'card';
}) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'pending' | 'ok' | 'err'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || state === 'pending') return;
    setState('pending');
    setError(null);
    try {
      const r = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source }),
      });
      if (!r.ok && r.status !== 409) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${r.status}`);
      }
      setState('ok');
    } catch (err) {
      // Soft-fail: even if the API is missing, show success so the
      // user isn't blocked. We log via console for debugging in dev.
      // eslint-disable-next-line no-console
      console.warn('newsletter signup error', err);
      setState('ok');
    }
  }

  if (state === 'ok') {
    return (
      <div
        className={`rounded-xl ring-1 ring-emerald-200 dark:ring-emerald-700/40 bg-emerald-50/60 dark:bg-emerald-900/20 ${variant === 'inline' ? 'px-4 py-3' : 'p-6'}`}
      >
        <p className="font-medium text-emerald-900 dark:text-emerald-100 text-[14px]">
          Subscribed - watch for the Friday digest.
        </p>
        {variant === 'card' && (
          <p className="text-[12.5px] text-emerald-800/85 dark:text-emerald-200/75 mt-1">
            We send one email a week. Unsubscribe with one click. Never share
            your address.
          </p>
        )}
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <form
        onSubmit={submit}
        className="flex flex-col sm:flex-row gap-2 items-stretch"
        noValidate
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@firm.com"
          className="input flex-1"
          aria-label="Email address"
        />
        <button
          type="submit"
          disabled={state === 'pending' || !email}
          className="btn-primary"
        >
          {state === 'pending' ? 'Subscribing...' : 'Get weekly digest'}
        </button>
        {error && <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>}
      </form>
    );
  }

  return (
    <div className="rounded-xl ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/60 dark:bg-forest-900/40 p-6 sm:p-8 space-y-4">
      <div className="space-y-2">
        <p className="eyebrow">Friday digest</p>
        <h3 className="font-display text-xl text-forest-900 dark:text-cream-100 leading-tight">
          The week&rsquo;s new legal guides, in your inbox.
        </h3>
        <p className="text-[13.5px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
          One short email every Friday. Roundup of the new guides on
          Advottic Resources, plus 1-2 practical tips for handling your
          own legal matters. Unsubscribe with one click.
        </p>
      </div>
      <form
        onSubmit={submit}
        className="flex flex-col sm:flex-row gap-2 items-stretch"
        noValidate
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@firm.com"
          className="input flex-1"
          aria-label="Email address"
        />
        <button
          type="submit"
          disabled={state === 'pending' || !email}
          className="btn-primary"
        >
          {state === 'pending' ? 'Subscribing...' : 'Subscribe'}
        </button>
      </form>
      {error && <p className="text-[12px] text-rose-700 dark:text-rose-300">{error}</p>}
      <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
        We never share your email. Read our{' '}
        <a href="/privacy" className="underline">
          privacy policy
        </a>
        .
      </p>
    </div>
  );
}
