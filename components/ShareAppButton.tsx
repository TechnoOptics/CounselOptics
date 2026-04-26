'use client';

import { useEffect, useState } from 'react';

const DEFAULT_SHARE_URL = 'https://advottic.com/welcome';
const DEFAULT_TITLE = 'Advottic - get your case in order';
const DEFAULT_TEXT =
  'I\'ve been using Advottic to organize my case file before meeting with an attorney. Open this on your phone to install it and try it free:';

/**
 * Share-the-app surface. Distinct from collaborator invites: this just
 * tells a friend about Advottic and gives them an install link.
 *
 * Tries the native Web Share Sheet first (one-tap to text/whatsapp/etc.
 * on iOS + Android). If the browser doesn't have it, falls back to
 * three explicit options: copy link, open mail client, open SMS app.
 *
 * The destination is /welcome which renders the install + sign-in CTA.
 */
export function ShareAppButton({
  className = '',
  variant = 'primary',
}: {
  className?: string;
  variant?: 'primary' | 'secondary';
}) {
  const [open, setOpen] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    setCanNativeShare(typeof navigator.share === 'function');
  }, []);

  const url = computeUrl();

  async function nativeShare() {
    if (typeof navigator === 'undefined' || !('share' in navigator)) return;
    try {
      await navigator.share({ title: DEFAULT_TITLE, text: DEFAULT_TEXT, url });
      setOpen(false);
    } catch {
      // user cancelled or share unsupported - fall back to inline panel
      setOpen(true);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  const baseBtn =
    variant === 'primary'
      ? 'btn-primary'
      : 'btn-secondary';

  return (
    <>
      <button
        type="button"
        onClick={() => (canNativeShare ? nativeShare() : setOpen(true))}
        className={`${baseBtn} ${className}`}
      >
        <ShareIcon />
        Share Advottic
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-6 bg-forest-950/55 backdrop-blur-sm animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="relative w-full sm:max-w-md bg-white dark:bg-forest-900 rounded-t-2xl sm:rounded-2xl shadow-card-hover ring-1 ring-forest-200 dark:ring-forest-700/60 overflow-hidden animate-fade-up">
            <div className="brand-mark px-6 py-4 text-cream-200">
              <p className="text-[10px] tracking-[0.28em] uppercase font-semibold text-gold-300">
                Share the app
              </p>
              <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-cream-100 mt-0.5">
                Send a friend the install link.
              </h2>
            </div>

            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
                They will land on a quick welcome page that walks them through{' '}
                <strong>Sign in</strong> and{' '}
                <strong>Add to home screen</strong> so the Advottic icon appears next to their
                other apps.
              </p>

              <div className="rounded-lg bg-ink-50 dark:bg-forest-800/60 px-3 py-2.5 flex items-center justify-between gap-2">
                <code className="font-mono text-[12px] text-ink-700 dark:text-cream-100/80 truncate">
                  {url}
                </code>
                <button
                  type="button"
                  onClick={copy}
                  className="text-[11px] uppercase tracking-wider font-semibold text-forest-900 dark:text-gold-300 hover:opacity-80 px-2 py-1"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`sms:?&body=${encodeURIComponent(`${DEFAULT_TEXT} ${url}`)}`}
                  className="btn bg-forest-900 text-cream-100 hover:bg-forest-800 dark:bg-gold-metal dark:text-forest-950 dark:hover:brightness-110 font-semibold"
                >
                  <ChatIcon />
                  Text
                </a>
                <a
                  href={`mailto:?subject=${encodeURIComponent(DEFAULT_TITLE)}&body=${encodeURIComponent(`${DEFAULT_TEXT}\n\n${url}\n\n— sent from Advottic`)}`}
                  className="btn-secondary"
                >
                  <MailIcon />
                  Email
                </a>
              </div>

              {canNativeShare && (
                <button
                  type="button"
                  onClick={nativeShare}
                  className="w-full btn-ghost text-sm border border-ink-200 dark:border-forest-700/60"
                >
                  <ShareIcon />
                  Open device share sheet
                </button>
              )}

              <p className="text-[11px] text-ink-500 dark:text-cream-100/55 text-center">
                Sharing the app does NOT share your case files. Use the Sharing tab on a case
                to invite a collaborator instead.
              </p>
            </div>

            <div className="px-6 py-3 bg-ink-50/60 dark:bg-forest-950/60 border-t border-ink-100 dark:border-forest-700/40 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="btn-ghost text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function computeUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_SHARE_URL;
  // Prefer the configured production URL over the current origin so a
  // share link sent from preview/dev still goes to prod.
  const env =
    typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_SITE_URL?.trim();
  const origin = env || window.location.origin;
  return `${origin.replace(/\/$/, '')}/welcome`;
}

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3v12m0-12l-4 4m4-4l4 4M5 13v6a2 2 0 002 2h10a2 2 0 002-2v-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
