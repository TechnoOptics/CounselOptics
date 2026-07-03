'use client';

import { useRef, useState } from 'react';
import { TurnstileWidget } from '@/components/turnstile-widget';

const TURNSTILE_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/**
 * Public, unauthenticated evidence/testimonial submission form. Posts
 * directly to the API route (not a Next.js server action) because this
 * needs to work for a visitor with no Advottic session at all - the route
 * is the trust boundary (rate limiting, magic-byte file validation,
 * service-role writes), not this component.
 */
export function EvidenceForm({ slug }: { slug: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [fileLabel, setFileLabel] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const formData = new FormData(e.currentTarget);
      formData.set('turnstileToken', turnstileToken ?? '');
      const res = await fetch(`/api/community/${slug}/witness/evidence`, {
        method: 'POST',
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Could not submit. Please try again.');
      }
      setDone(true);
      formRef.current?.reset();
      setFileLabel('');
      setTurnstileToken(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit. Please try again.');
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="card p-6 text-center">
        <p className="font-display text-xl text-forest-900 dark:text-cream-100">
          Thank you — this was shared privately with the organizer and their attorney.
        </p>
        <button type="button" className="btn-secondary mt-4" onClick={() => setDone(false)}>
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="card p-5 sm:p-6 space-y-5">
      <div>
        <label className="label" htmlFor="fullName">
          Your name (optional)
        </label>
        <input
          id="fullName"
          name="fullName"
          type="text"
          maxLength={200}
          className="input"
          placeholder="Leave blank to stay anonymous"
        />
      </div>

      <div>
        <label className="label" htmlFor="testimonialText">
          What would you like to share?
        </label>
        <textarea
          id="testimonialText"
          name="testimonialText"
          rows={5}
          maxLength={10000}
          className="input"
          placeholder="What you witnessed, know about the case, or want the attorney to consider"
        />
      </div>

      <div>
        <label className="label" htmlFor="file-main">
          Photo or document (optional)
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="file-main" className="btn-secondary cursor-pointer">
            Choose file
          </label>
          <label
            htmlFor="file-camera"
            className="btn-secondary cursor-pointer inline-flex items-center gap-1.5"
            title="Take a photo with your camera"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4 7h3l2-2h6l2 2h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            Take photo
          </label>
          <span className="text-sm text-ink-500 truncate">{fileLabel || 'No file selected'}</span>
        </div>
        <input
          id="file-main"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          onChange={(e) => setFileLabel(e.currentTarget.files?.[0]?.name ?? '')}
        />
        <input
          id="file-camera"
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (!f) return;
            const main = formRef.current?.querySelector<HTMLInputElement>('input[name="file"]');
            if (main) {
              const dt = new DataTransfer();
              dt.items.add(f);
              main.files = dt.files;
              setFileLabel(f.name);
            }
            e.currentTarget.value = '';
          }}
        />
        <p className="text-xs text-ink-500 dark:text-cream-100/55 mt-1.5">
          JPEG, PNG, WebP, or PDF. Up to 25MB.
        </p>
      </div>

      <TurnstileWidget onToken={setTurnstileToken} />

      {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

      <button
        type="submit"
        className="btn-primary w-full justify-center"
        disabled={pending || (TURNSTILE_CONFIGURED && !turnstileToken)}
      >
        {pending ? 'Submitting…' : 'Submit privately'}
      </button>
      <p className="text-xs text-ink-500 dark:text-cream-100/55 text-center leading-relaxed">
        This submission is never shown publicly. Only the organizer and their attorney can view
        it.
      </p>
    </form>
  );
}
