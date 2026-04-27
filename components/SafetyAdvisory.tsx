'use client';

import { useEffect, useState } from 'react';
import { detectSafety, type SafetyCategory } from '@/lib/safety';
import {
  detectRegion,
  EMERGENCY,
  SUICIDE,
  DOMESTIC_VIOLENCE,
  SEXUAL_VIOLENCE,
  CHILD_SAFETY,
  type Region,
} from '@/lib/hotlines';

/**
 * Inline alert that appears beneath any free-form text field where the
 * user is describing what happened (case description, smart-assist
 * narrative). When the text contains cues suggesting urgency - threats,
 * injury, self-harm, child safety, sexual violence - we surface a
 * banner that:
 *
 *   1. Asks if they are safe right now.
 *   2. Offers a tap-to-call link to 911 (and category-specific
 *      hotlines like 988, the National Domestic Violence Hotline,
 *      Childhelp, RAINN).
 *   3. Suggests filing a police report or applying for a protective
 *      order at the courthouse, with the gentle reminder that
 *      Advottic helps build the paper trail once they are safe.
 *   4. Explicitly tells the reader they can ignore the banner if it
 *      doesn't apply - we're erring on the side of false positives.
 *
 * The banner is dismissible per session so a repeat offender word in
 * one description doesn't haunt the user forever, but it re-renders
 * whenever the underlying text changes substantially.
 */
export function SafetyAdvisory({ text }: { text: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [region, setRegion] = useState<Region>('US');
  // Detect region client-side from navigator.language. SSR renders
  // the US default; the effect re-renders with the right region the
  // first paint after hydration.
  useEffect(() => {
    setRegion(detectRegion());
  }, []);
  const hits = detectSafety(text);
  if (hits.length === 0 || dismissed) return null;

  const cats = new Set<SafetyCategory>(hits.map((h) => h.category));
  const showInjury = cats.has('injury');
  const showSelfHarm = cats.has('self_harm');
  const showDV = cats.has('in_danger');
  const showChild = cats.has('child_safety');
  const showSexual = cats.has('sexual_violence');

  const emergency = EMERGENCY[region];
  const suicide = showSelfHarm ? SUICIDE[region] : null;
  const dv = showDV ? DOMESTIC_VIOLENCE[region] : null;
  const sv = showSexual ? SEXUAL_VIOLENCE[region] : null;
  const child = showChild ? CHILD_SAFETY[region] : null;

  return (
    <aside
      role="alert"
      aria-live="polite"
      className="mt-3 rounded-xl border-2 border-rose-400 bg-rose-50 dark:border-rose-500/60 dark:bg-rose-950/35 shadow-md animate-fade-in"
    >
      <div className="p-4 sm:p-5 flex items-start gap-3">
        <span
          className="flex-none mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-rose-600 text-white text-lg font-bold shadow-sm"
          aria-hidden
        >
          !
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-rose-900 dark:text-rose-100 text-[15px]">
              Are you safe right now?
            </p>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="text-[11px] uppercase tracking-wider text-rose-700/80 hover:text-rose-900 dark:text-rose-200/70 dark:hover:text-rose-100"
              aria-label="Dismiss safety advisory"
            >
              Hide
            </button>
          </div>
          <p className="text-sm text-rose-900/85 dark:text-rose-100/85 mt-1.5 leading-relaxed">
            What you described sounds urgent. Advottic helps you build a paper trail, but it
            cannot replace emergency help. If you or someone else is in immediate danger,
            please call your local emergency number first - Advottic will still be here
            when you are safe.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={`tel:${emergency.tel}`}
              className="inline-flex items-center gap-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-2 text-sm font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-rose-300"
            >
              <PhoneIcon /> {emergency.label}
            </a>
            {suicide && <HotlineLink tel={suicide.tel} label={suicide.label} />}
            {dv && <HotlineLink tel={dv.tel} label={dv.label} />}
            {sv && <HotlineLink tel={sv.tel} label={sv.label} />}
            {child && <HotlineLink tel={child.tel} label={child.label} />}
          </div>

          {showInjury && (
            <p className="mt-3 text-sm font-semibold text-rose-900 dark:text-rose-100">
              You mentioned being hurt. If you cannot get to safety on your own, ask the 911
              dispatcher to send help to your address. Stay on the line until they tell you
              it is safe to hang up.
            </p>
          )}

          <details className="mt-3 group">
            <summary className="text-[12px] font-semibold uppercase tracking-wider text-rose-900 dark:text-rose-100 cursor-pointer hover:underline">
              What else you can do today
            </summary>
            <ul className="mt-2 list-disc pl-5 text-[13px] space-y-1.5 text-rose-900/85 dark:text-rose-100/85 leading-relaxed">
              <li>
                <strong>File a police report.</strong> Even if you do not want to press
                charges, a contemporaneous report creates an official record of what
                happened. Ask the officer for a case / incident number and a copy.
              </li>
              <li>
                <strong>Write a sworn statement (affidavit) while it is fresh.</strong>{' '}
                Date it, sign it, list what happened in chronological order, and keep a
                copy somewhere safe. Advottic can help you organize it later.
              </li>
              <li>
                <strong>Apply for a protective order.</strong> Most county courthouses
                accept emergency / temporary restraining order applications same-day.
                Bring any threatening texts, voicemails, photos, or messages with you.
              </li>
              <li>
                <strong>Save evidence now.</strong> Screenshot threatening messages,
                photograph injuries, save voicemails. Store copies somewhere the other
                person cannot access (a friend&apos;s email, cloud storage on a new
                account).
              </li>
              <li>
                <strong>Make a safety plan.</strong> Identify a trusted person, a place
                you can go, and a way out. The hotlines above can walk you through this
                step by step at any hour.
              </li>
            </ul>
          </details>

          <p className="mt-3 text-[11px] text-rose-900/65 dark:text-rose-100/65">
            Advottic noticed wording that suggests urgency. This is information, not legal
            advice - if it does not apply to your matter, you can hide this notice and
            keep filling out the form.
          </p>
        </div>
      </div>
    </aside>
  );
}

function HotlineLink({ tel, label }: { tel: string; label: string }) {
  return (
    <a
      href={`tel:${tel}`}
      className="inline-flex items-center gap-2 rounded-lg bg-white text-rose-900 ring-1 ring-rose-300 hover:bg-rose-100 px-3.5 py-2 text-sm font-semibold dark:bg-forest-900 dark:text-rose-100 dark:ring-rose-500/40 dark:hover:bg-forest-800"
    >
      <PhoneIcon /> {label}
    </a>
  );
}

function PhoneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 4h3l2 5-2 1a11 11 0 005 5l1-2 5 2v3a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
