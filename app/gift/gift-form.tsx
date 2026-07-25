'use client';

import { useMemo, useState } from 'react';
import {
  type GiftTier,
  type GiftDuration,
  type GiftTierSlug,
  giftAmountCents,
  formatDollars,
} from '@/lib/gift';

export function GiftForm({
  tiers,
  durations,
  initialGifterEmail,
  initialGifterName,
  signedIn,
}: {
  tiers: GiftTier[];
  durations: { months: GiftDuration; label: string }[];
  initialGifterEmail: string;
  initialGifterName: string;
  signedIn: boolean;
}) {
  const [tier, setTier] = useState<GiftTierSlug>('pro');
  const [duration, setDuration] = useState<GiftDuration>(3);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [personalNote, setPersonalNote] = useState('');
  const [gifterName, setGifterName] = useState(initialGifterName);
  const [gifterEmail, setGifterEmail] = useState(initialGifterEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedTier = tiers.find((t) => t.slug === tier) ?? tiers[0];
  const totalCents = useMemo(
    () => giftAmountCents(tier, duration),
    [tier, duration],
  );
  const grossCents = selectedTier.monthlyCents * duration;
  const discountCents = grossCents - totalCents;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/gift/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier,
          duration,
          recipient_name: recipientName,
          recipient_email: recipientEmail,
          recipient_phone: recipientPhone,
          personal_note: personalNote,
          gifter_name: gifterName,
          gifter_email: gifterEmail,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.url) {
        setError(j.error ?? 'Could not start checkout. Try again.');
        return;
      }
      // Redirect to Stripe Checkout. We don't push() because Stripe
      // is a cross-origin redirect that the browser handles natively.
      window.location.href = j.url;
    } catch {
      setError('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Recipient block */}
      <fieldset className="space-y-3">
        <legend className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
          Recipient
        </legend>
        <label className="block">
          <span className="block text-[12.5px] text-ink-700 dark:text-cream-100/75 mb-1">
            Their name
          </span>
          <input
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            placeholder="Jane Smith"
            className="input text-[14px]"
            required
            maxLength={120}
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="block text-[12.5px] text-ink-700 dark:text-cream-100/75 mb-1">
            Their email
          </span>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            placeholder="jane@example.com"
            className="input text-[14px]"
            required
            maxLength={254}
            disabled={busy}
            autoComplete="off"
          />
          <p className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/55">
            We email the redemption link here once you pay.
          </p>
        </label>
        <label className="block">
          <span className="block text-[12.5px] text-ink-700 dark:text-cream-100/75 mb-1">
            Their phone <span className="text-ink-400">(optional)</span>
          </span>
          <input
            type="tel"
            value={recipientPhone}
            onChange={(e) => setRecipientPhone(e.target.value)}
            placeholder="+14155551234"
            className="input text-[14px] font-mono"
            disabled={busy}
            autoComplete="off"
            inputMode="tel"
          />
          <p className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/55">
            International format. We'll text them the link too when it's
            set.
          </p>
        </label>
        <label className="block">
          <span className="block text-[12.5px] text-ink-700 dark:text-cream-100/75 mb-1">
            Personal note <span className="text-ink-400">(optional)</span>
          </span>
          <textarea
            value={personalNote}
            onChange={(e) => setPersonalNote(e.target.value)}
            placeholder="Sis, you've been managing all this on your own. Here's a hand."
            rows={3}
            maxLength={600}
            className="input text-[14px] leading-relaxed"
            disabled={busy}
          />
          <p className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/55">
            Shown in their redemption email.
          </p>
        </label>
      </fieldset>

      <p data-show-in-app className="rounded-lg border border-ink-200 px-3 py-2 text-[13px] text-ink-600 dark:border-forest-700/50 dark:text-cream-100/70">
        Gifting is not available in the app.
      </p>
      {/* Tier */}
      <fieldset data-hide-on-ios className="space-y-2">
        <legend className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
          Plan
        </legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {tiers.map((t) => {
            const selected = t.slug === tier;
            return (
              <button
                type="button"
                key={t.slug}
                onClick={() => setTier(t.slug)}
                className={`text-left rounded-lg ring-1 p-3 transition-colors ${
                  selected
                    ? 'ring-gold-metal dark:ring-amber-500/60 bg-amber-50/40 dark:bg-amber-950/15'
                    : 'ring-ink-200 dark:ring-forest-700/40 hover:ring-forest-700/60'
                }`}
                disabled={busy}
              >
                <p className="font-semibold text-[13px] text-forest-900 dark:text-cream-100">
                  {t.name}
                </p>
                <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-0.5 font-mono">
                  {formatDollars(t.monthlyCents)} / month
                  {t.perSeat ? ' / seat' : ''}
                </p>
                <p className="text-[11.5px] text-ink-600 dark:text-cream-100/65 leading-snug mt-1.5">
                  {t.blurb}
                </p>
              </button>
            );
          })}
        </div>
        {selectedTier.perSeat ? (
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 leading-snug">
            Firm tier gifts cover one seat. The recipient can add more
            seats from their billing page once the subscription is
            active.
          </p>
        ) : null}
      </fieldset>

      {/* Duration */}
      <fieldset data-hide-on-ios className="space-y-2">
        <legend className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
          Duration
        </legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {durations.map((d) => {
            const selected = d.months === duration;
            return (
              <button
                type="button"
                key={d.months}
                onClick={() => setDuration(d.months)}
                className={`rounded-lg ring-1 p-3 text-[13px] transition-colors ${
                  selected
                    ? 'ring-gold-metal dark:ring-amber-500/60 bg-amber-50/40 dark:bg-amber-950/15 font-semibold'
                    : 'ring-ink-200 dark:ring-forest-700/40 hover:ring-forest-700/60'
                }`}
                disabled={busy}
              >
                {d.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Gifter contact - hidden when signed in since we already
          have everything we need from the session. */}
      {!signedIn && (
        <fieldset className="space-y-3">
          <legend className="text-[11px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
            Your details
          </legend>
          <label className="block">
            <span className="block text-[12.5px] text-ink-700 dark:text-cream-100/75 mb-1">
              Your name
            </span>
            <input
              type="text"
              value={gifterName}
              onChange={(e) => setGifterName(e.target.value)}
              placeholder="Optional"
              className="input text-[14px]"
              maxLength={120}
              disabled={busy}
              autoComplete="name"
            />
          </label>
          <label className="block">
            <span className="block text-[12.5px] text-ink-700 dark:text-cream-100/75 mb-1">
              Your email
            </span>
            <input
              type="email"
              value={gifterEmail}
              onChange={(e) => setGifterEmail(e.target.value)}
              placeholder="you@example.com"
              className="input text-[14px]"
              required
              maxLength={254}
              disabled={busy}
              autoComplete="email"
            />
            <p className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/55">
              Receipt + any support correspondence go here.
            </p>
          </label>
        </fieldset>
      )}

      {/* Total + submit */}
      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-4 space-y-2 bg-cream-50/40 dark:bg-forest-900/40">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-ink-700 dark:text-cream-100/75">
            {selectedTier.name} · {duration} {duration === 1 ? 'month' : 'months'}
          </span>
          <span className="font-mono text-[14px] text-ink-700 dark:text-cream-100/75">
            {formatDollars(grossCents)}
          </span>
        </div>
        {discountCents > 0 && (
          <div className="flex items-baseline justify-between text-[12px] text-emerald-700 dark:text-emerald-300">
            <span>Annual prepay discount (20%)</span>
            <span className="font-mono">- {formatDollars(discountCents)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between border-t border-ink-200/60 dark:border-forest-700/60 pt-2">
          <span className="font-semibold text-forest-900 dark:text-cream-100">
            Total today
          </span>
          <span className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 tabular-nums">
            {formatDollars(totalCents)}
          </span>
        </div>
      </div>
      {error && (
        <p className="text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
      <button type="submit" data-hide-on-ios className="btn-primary w-full" disabled={busy}>
        {busy ? 'Redirecting to checkout…' : `Continue to checkout`}
      </button>
      <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 leading-snug text-center">
        Stripe handles the payment. We never see your card. By
        continuing you agree to our{' '}
        <a className="underline" href="/terms">
          Terms
        </a>{' '}
        and{' '}
        <a className="underline" href="/privacy">
          Privacy Policy
        </a>
        .
      </p>
    </form>
  );
}
