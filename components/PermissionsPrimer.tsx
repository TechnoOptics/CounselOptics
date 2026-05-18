'use client';

/**
 * Permissions priming sheet. Mounts inside the app shell post-sign-in
 * and, on the FIRST launch on a native device only, explains and then
 * requests the OS permissions the app actually uses, up front, instead
 * of springing the raw system prompt the first time the user happens
 * to tap "dictate".
 *
 * Scope is deliberately limited to capabilities that are actually
 * wired into the native build:
 *   - Microphone  -> @capacitor-community/speech-recognition
 *                    (voice dictation, components/VoiceDictateButton)
 *   - Notifications -> web-push (case updates, components/PushOptIn)
 *   - Camera/Photos -> @capacitor/camera, paired with the exhibit
 *                      capture in app/cases/[id]/upload-form.tsx and
 *                      the NSCamera/NSPhotoLibrary Info.plist strings.
 *
 * NOT included on purpose:
 *   - Face ID / biometric: handled by BiometricEnrollPrompt at sign-in.
 *   - Location: no geolocation plugin and no native feature uses it
 *     (the file-exhibits jurisdiction sort uses opt-in web geolocation
 *     only). Requesting an unused permission does nothing and is an
 *     App Store Review rejection (Guideline 5.1.1 / 2.5.x).
 *
 * Will not show:
 *   - on web / desktop
 *   - after it has been shown once on this device (dismiss or enable)
 *
 * The user can always change any of these later in iOS/Android
 * Settings; this screen is a one-time courtesy, not a gate - "Not
 * now" is a first-class choice and never blocks the app.
 */

import { useEffect, useRef, useState } from 'react';
import { useModalLifecycle } from '@/lib/use-modal-lifecycle';
import { PopupPortal } from './PopupPortal';
import { MicrophoneIcon, CameraIcon, BellIcon } from './icons/PermissionIcons';
import { isNativeShell } from '@/lib/biometric';
// Lazy-load @capacitor/* at runtime - static imports pull native code
// into the SSR module graph for every page mounting the consumer
// shell (same rationale as BiometricEnrollPrompt / lib/biometric).
import type { Preferences as PreferencesType } from '@capacitor/preferences';

// Resolve to a PLAIN wrapper, never the Capacitor plugin proxy
// itself - an async fn returning the proxy makes the Promise
// machinery probe `.then` on it, which the Android proxy rejects
// with `"Preferences.then()" is not implemented on android`.
async function loadPreferences(): Promise<{ Preferences: typeof PreferencesType }> {
  const mod = await import('@capacitor/preferences');
  return { Preferences: mod.Preferences };
}

// Bump the version suffix if the set of primed permissions changes,
// so existing users see the new ones once. v2 adds Camera/Photos.
const PRIMED_KEY = 'advottic-perms-primed-v2';

export function PermissionsPrimer() {
  const [phase, setPhase] = useState<
    'hidden' | 'asking' | 'working' | 'done'
  >('hidden');
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalLifecycle({ enabled: phase !== 'hidden', focusRef: panelRef });

  useEffect(() => {
    let cancelled = false;
    async function evaluate() {
      if (!isNativeShell()) return;
      try {
        const { Preferences } = await loadPreferences();
        const { value } = await Preferences.get({ key: PRIMED_KEY });
        if (cancelled || value) return;
        setPhase('asking');
      } catch {
        // Preferences unavailable - skip silently rather than risk
        // re-prompting every launch.
      }
    }
    void evaluate();
    return () => {
      cancelled = true;
    };
  }, []);

  async function markPrimed() {
    try {
      const { Preferences } = await loadPreferences();
      await Preferences.set({ key: PRIMED_KEY, value: '1' });
    } catch {
      /* best-effort; worst case it shows once more next launch */
    }
  }

  async function requestMicrophone() {
    try {
      const { SpeechRecognition } = await import(
        '@capacitor-community/speech-recognition'
      );
      // checkPermissions first so we don't re-prompt if already granted
      // (some OS versions show a "denied" state we shouldn't override).
      const current = await SpeechRecognition.checkPermissions();
      if (current.speechRecognition !== 'granted') {
        await SpeechRecognition.requestPermissions();
      }
    } catch {
      // Plugin missing on an older shell, or user denied - the voice
      // dictation button still re-requests on first use, so this is
      // non-fatal.
    }
  }

  async function requestCamera() {
    try {
      const { Camera } = await import('@capacitor/camera');
      const current = await Camera.checkPermissions();
      // Only prompt for states still askable; never override a
      // user's explicit "denied" (the OS won't re-prompt anyway).
      const needsCamera = current.camera !== 'granted' && current.camera !== 'denied';
      const needsPhotos = current.photos !== 'granted' && current.photos !== 'denied';
      if (needsCamera || needsPhotos) {
        await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
      }
    } catch {
      // Plugin missing on an older shell - the HTML capture input in
      // upload-form.tsx still prompts on first use, so non-fatal.
    }
  }

  async function requestNotifications() {
    try {
      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        typeof Notification.requestPermission === 'function' &&
        Notification.permission === 'default'
      ) {
        await Notification.requestPermission();
      }
    } catch {
      /* non-fatal - PushOptIn re-requests when the user opts in */
    }
  }

  async function handleEnable() {
    setPhase('working');
    // Sequential, not Promise.all: stacked OS permission sheets get
    // coalesced/dropped by iOS. Mic, then camera/photos, then
    // notifications - each resolves before the next is shown.
    await requestMicrophone();
    await requestCamera();
    await requestNotifications();
    await markPrimed();
    setPhase('done');
    setTimeout(() => setPhase('hidden'), 1400);
  }

  async function handleSkip() {
    await markPrimed();
    setPhase('hidden');
  }

  if (phase === 'hidden') return null;

  return (
    <PopupPortal>
    <div
      role="dialog"
      aria-labelledby="perms-primer-title"
      aria-describedby="perms-primer-desc"
      className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-4"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        className="popup-panel w-full max-w-md p-6 space-y-4 animate-fade-up"
      >
        <div>
          <p className="eyebrow mb-1">Set up Advottic</p>
          <h2
            id="perms-primer-title"
            className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100"
          >
            Turn on a couple of things
          </h2>
          <p
            id="perms-primer-desc"
            className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed"
          >
            Advottic works best with these enabled. You can change them
            any time in Settings - this is just so you&#x2019;re not
            interrupted later.
          </p>
        </div>

        <ul className="space-y-3">
          <li className="flex gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gold-400/15 text-gold-300">
              <MicrophoneIcon className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900 dark:text-cream-100">
                Microphone
              </p>
              <p className="text-xs text-ink-600 dark:text-cream-100/70 leading-relaxed">
                Dictate case notes by voice instead of typing.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gold-400/15 text-gold-300">
              <CameraIcon className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900 dark:text-cream-100">
                Camera &amp; Photos
              </p>
              <p className="text-xs text-ink-600 dark:text-cream-100/70 leading-relaxed">
                Snap or attach documents, citations, and exhibits
                straight into a case.
              </p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gold-400/15 text-gold-300">
              <BellIcon className="h-[18px] w-[18px]" />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink-900 dark:text-cream-100">
                Notifications
              </p>
              <p className="text-xs text-ink-600 dark:text-cream-100/70 leading-relaxed">
                Get alerted when there&#x2019;s an update on your case.
              </p>
            </div>
          </li>
        </ul>

        {phase === 'working' && (
          <p className="text-sm text-ink-500">Opening permission prompts...</p>
        )}
        {phase === 'done' && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            All set. You can fine-tune these any time in Settings.
          </p>
        )}

        {(phase === 'asking' || phase === 'working') && (
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
            <button
              type="button"
              onClick={handleSkip}
              disabled={phase === 'working'}
              className="btn text-cream-100/75 hover:text-cream-100 hover:bg-cream-100/5"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={handleEnable}
              disabled={phase === 'working'}
              className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold"
            >
              Enable
            </button>
          </div>
        )}
      </div>
    </div>
    </PopupPortal>
  );
}
