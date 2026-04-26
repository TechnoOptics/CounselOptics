'use client';

import { useEffect, useState } from 'react';

/**
 * PWA install button. Listens for the `beforeinstallprompt` event and
 * lets the user install the app to their home screen. Apple Safari does
 * not fire this event, so for iOS we surface inline guidance to use the
 * Share -> Add to Home Screen flow instead.
 *
 * The PWA manifest already configures the Advottic icon (icon-192.png /
 * icon-512.png + apple-icon.png), so the resulting home-screen icon is
 * the gold pillar mark on the forest tile.
 */
type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallAppButton() {
  const [prompt, setPrompt] = useState<DeferredPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<'web' | 'ios' | 'standalone'>('web');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = navigator.userAgent || '';
    const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari uses `navigator.standalone`, not the media query.
      (navigator as Navigator & { standalone?: boolean }).standalone === true;

    if (isStandalone) setPlatform('standalone');
    else if (isIos) setPlatform('ios');
    else setPlatform('web');

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setPrompt(e as DeferredPrompt);
    }
    function onInstalled() {
      setInstalled(true);
      setPrompt(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || platform === 'standalone') {
    return (
      <p className="inline-flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
        <CheckIcon /> Installed - launch from your home screen.
      </p>
    );
  }

  if (platform === 'ios') {
    return (
      <div className="rounded-xl border border-ink-200 dark:border-forest-700/50 bg-cream-50 dark:bg-forest-800/40 p-4 text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
        <p className="font-semibold text-forest-900 dark:text-cream-100 mb-1">
          On iPhone or iPad
        </p>
        <p>
          Tap the <strong>Share</strong> button{' '}
          <span aria-hidden className="inline-block translate-y-0.5 mx-0.5">
            <ShareIcon />
          </span>{' '}
          in Safari, then choose <strong>Add to Home Screen</strong>. The Advottic icon will
          appear next to your other apps.
        </p>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={!prompt}
      onClick={async () => {
        if (!prompt) return;
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === 'accepted') setInstalled(true);
        setPrompt(null);
      }}
      className="btn-primary disabled:opacity-60"
    >
      <DownloadIcon />
      {prompt ? 'Add Advottic to home screen' : 'Install option will appear here'}
    </button>
  );
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
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v12m0 0l-4-4m4 4l4-4M5 20h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13l4 4 10-10"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
