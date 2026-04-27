'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { recordConsentAction } from '@/lib/actions';
import { SUPPORTED_LANGUAGES } from '@/lib/types';

/**
 * Layout-level consent popup. Renders only when the server says
 * `needsConsent`. After successful submission the modal hides itself
 * and triggers `router.refresh()` so the layout re-fetches the profile,
 * which now has consentedAt set, and the modal stays gone.
 */
export function ConsentModal({
  fallbackName,
}: {
  fallbackName: string;
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>('en');

  // Best-effort default to the browser's preferred language if it matches
  // one we support. Otherwise stay on English.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (SUPPORTED_LANGUAGES.some((l) => l.code === browserLang)) {
      setLanguage(browserLang);
    }
  }, []);

  if (hidden) return null;

  function onSubmit(formData: FormData) {
    setError(null);
    // Force a hidden displayName field if the form didn't include one.
    if (!formData.get('displayName')) {
      formData.set('displayName', fallbackName);
    }
    startTransition(async () => {
      try {
        await recordConsentAction(formData);
        // Land first-time users on /cases (their dashboard) rather than
        // wherever the consent popup happened to fire. Common entry path
        // is "Start your case file" CTA -> /cases/new -> sign-in -> back
        // to /cases/new with the consent modal on top; without this
        // bounce they'd be staring at the new-case wizard before they
        // even know there's a dashboard. /cases gracefully handles the
        // empty-state with a "Create your first case" card.
        setHidden(true);
        router.push('/cases?welcome=1');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not save consent.';
        // Next.js redirect throws a synthetic "NEXT_REDIRECT" error - treat as success.
        if (/NEXT_REDIRECT|NEXT_NOT_FOUND/.test(msg)) {
          setHidden(true);
          router.push('/cases?welcome=1');
          return;
        }
        setError(msg);
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Consent and representation"
      className="fixed inset-0 z-[55] flex items-start justify-center px-4 py-6 sm:py-10 overflow-y-auto"
    >
      {/* Hard backdrop. No click-out: choice required. */}
      <div className="absolute inset-0 bg-forest-950/82 backdrop-blur-md animate-fade-in" />
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-gold-300/40 bg-white shadow-card-hover overflow-hidden animate-fade-up"
        style={{
          boxShadow:
            '0 0 0 1px rgba(213,187,126,0.4), 0 22px 60px -12px rgba(15,45,36,0.55), 0 0 80px rgba(213,187,126,0.18)',
        }}
      >
        {/* Brand strip */}
        <div className="brand-mark text-cream-200 px-6 py-5">
          <p className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
            Welcome to Advottic
          </p>
          <h2 className="text-xl md:text-2xl font-semibold tracking-tight text-cream-100 mt-1">
            One quick consent before you start.
          </h2>
          <p className="text-cream-100/80 text-sm mt-1.5 max-w-xl leading-relaxed">
            We need your representation status and acceptance of our terms before any case
            data is created on your behalf. This is a one-time step.
          </p>
        </div>

        <form action={onSubmit} className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <input type="hidden" name="displayName" value={fallbackName} />
          <input type="hidden" name="language" value={language} />

          <div>
            <label className="label" htmlFor="language">
              Preferred language
            </label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="input max-w-xs"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-ink-500 mt-1.5">
              Saved to your profile so the app honors it across devices. You can change this
              anytime in Profile settings.
            </p>
          </div>

          <fieldset>
            <legend className="label mb-2">How are you representing yourself?</legend>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  v: 'self_represented',
                  title: 'Self-represented',
                  desc: 'Representing myself - no attorney yet.',
                },
                {
                  v: 'represented',
                  title: 'Represented',
                  desc: 'I have an attorney and want to organize for them.',
                },
                {
                  v: 'counsel',
                  title: "I'm counsel",
                  desc: 'I am an attorney working on a client matter.',
                },
                {
                  v: 'user',
                  title: 'Just exploring',
                  desc: 'Not sure yet - I want to look around first.',
                },
              ].map((o) => (
                <label
                  key={o.v}
                  className="flex flex-col rounded-lg border border-ink-200 bg-white p-4 cursor-pointer hover:border-gold-500 has-[:checked]:border-forest-900 has-[:checked]:ring-2 has-[:checked]:ring-forest-900/20"
                >
                  <input
                    type="radio"
                    name="representation"
                    value={o.v}
                    required
                    className="sr-only peer"
                  />
                  <span className="font-semibold text-ink-950 text-sm peer-checked:text-forest-900">
                    {o.title}
                  </span>
                  <span className="text-xs text-ink-600 mt-1 leading-relaxed">{o.desc}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-4 text-sm text-ink-800 leading-relaxed space-y-3 max-h-56 overflow-y-auto">
            <p className="font-semibold text-ink-950">
              You acknowledge and agree to the following:
            </p>
            <ol className="list-decimal list-outside pl-5 space-y-2 text-[13px]">
              <li>
                <strong>Not legal advice.</strong> Advottic provides general legal information,
                case organization, and an informed assistant for issue spotting. It is{' '}
                <em>not a law firm</em>, does not provide legal advice, and does not create an
                attorney-client relationship. Suggestions may be incomplete, outdated, or
                wrong. Consult a licensed attorney before acting. If you face possible
                incarceration, request a public defender at your first court appearance - a
                free constitutional right.
              </li>
              <li>
                <strong>Security &amp; privacy.</strong> Encrypted in transit (TLS) and at rest
                (AES-256). Access is restricted to authorized personnel. Assistant and review
                features send your case content to a trusted processing partner under
                strict commercial terms; your content is not used to improve outside services.
                Export or delete your data any time from Profile.
              </li>
              <li>
                <strong>Limitation of liability.</strong> To the fullest extent permitted by
                law, total cumulative liability is limited to the greater of $100 USD or the
                amount paid in the prior 12 months. No indirect or consequential damages.
              </li>
              <li>
                <strong>Binding individual arbitration; class-action and jury waivers.</strong>{' '}
                Any dispute will be resolved by{' '}
                <em>final, binding, individual arbitration</em> seated in Minnesota under MN
                law. <strong>You waive jury trial</strong> and{' '}
                <strong>waive class-action / mass-action / representative participation</strong>.
                Small-claims actions in Scott County, MN remain available.
              </li>
              <li>
                <strong>Acceptable use.</strong> Will not use Advottic to commit illegal acts,
                fabricate / destroy evidence, harass others, or upload content without rights.
              </li>
            </ol>
            <p className="text-xs text-ink-500 mt-2">
              Full text:{' '}
              <Link href="/terms" target="_blank" className="underline">
                Terms
              </Link>{' '}
              ·{' '}
              <Link href="/privacy" target="_blank" className="underline">
                Privacy
              </Link>{' '}
              ·{' '}
              <Link href="/cookies" target="_blank" className="underline">
                Cookies
              </Link>
            </p>
          </div>

          <label className="flex items-start gap-3 text-sm text-ink-800 cursor-pointer">
            <input
              type="checkbox"
              name="consent"
              required
              className="mt-1 h-4 w-4 rounded border-ink-300 text-forest-900 focus:ring-forest-900"
            />
            <span className="leading-relaxed">
              I have read and agree to the items above, the{' '}
              <Link href="/terms" target="_blank" className="underline">
                Terms of Use
              </Link>{' '}
              and{' '}
              <Link href="/privacy" target="_blank" className="underline">
                Privacy Policy
              </Link>
              , including the{' '}
              <strong>binding arbitration, class-action waiver, and jury-trial waiver</strong>.
            </span>
          </label>

          {error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
              {error}
            </p>
          )}

          <div className="flex justify-end pt-1">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? 'Saving...' : 'Approve & continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
