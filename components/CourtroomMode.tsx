'use client';

/**
 * Courtroom Mode - flagship feature.
 *
 * A focused, calm, offline-resilient companion for the day of a
 * hearing. Everything the litigant needs in one distraction-free
 * full-screen takeover: their three key points, one-tap exhibit
 * access, a grounding breath, a pre-hearing checklist, etiquette
 * reminders, and a discreet speaking timer.
 *
 * Self-contained: all case data is passed at load and state lives
 * in localStorage, so it keeps working if the courthouse has no
 * signal. Premium dark brand surface, slow and steady motion -
 * designed to lower the heart rate, not raise it.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PopupPortal } from './PopupPortal';

type Ex = { id: string; label: string; fileName: string; category?: string | null };

const CHECKLIST = [
  'Photo ID and any case/reference numbers',
  'Printed copies of every exhibit you may reference',
  'Your three key points (below) - know them cold',
  'Arrive 30+ minutes early; clear security with time to spare',
  'Silence your phone before you enter the courtroom',
  'Dress as for an important interview; remove hats/sunglasses',
];

const ETIQUETTE = [
  'Stand when the judge enters and when you address the court.',
  'Call the judge "Your Honor." Be brief; answer what is asked.',
  'Never interrupt - let them finish, then respond calmly.',
  'Speak to the judge, not to the other party. Stay level.',
  'It is fine to say "I don’t know" or ask to clarify a question.',
];

export function CourtroomMode({
  caseId,
  caseTitle,
  hearingAt,
  hearingLocation,
  seedPoints,
  exhibits,
}: {
  caseId: string;
  caseTitle: string;
  hearingAt: string | null;
  hearingLocation: string | null;
  seedPoints: string;
  exhibits: Ex[];
}) {
  const kKey = `courtroom:${caseId}:points`;
  const cKey = `courtroom:${caseId}:checks`;

  const [points, setPoints] = useState<string[]>(['', '', '']);
  const [checks, setChecks] = useState<boolean[]>(
    () => CHECKLIST.map(() => false),
  );
  const [breathing, setBreathing] = useState(false);
  const [phase, setPhase] = useState<'In' | 'Hold' | 'Out'>('In');
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  // Hydrate from localStorage (seed key points from hearing notes).
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(kKey) || 'null');
      if (Array.isArray(p) && p.length === 3) setPoints(p);
      else if (seedPoints) {
        const seed = seedPoints
          .split(/\n|•|;|\. /)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3);
        setPoints([seed[0] || '', seed[1] || '', seed[2] || '']);
      }
      const c = JSON.parse(localStorage.getItem(cKey) || 'null');
      if (Array.isArray(c) && c.length === CHECKLIST.length) setChecks(c);
    } catch {
      /* ignore */
    }
  }, [kKey, cKey, seedPoints]);

  function savePoints(next: string[]) {
    setPoints(next);
    try {
      localStorage.setItem(kKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  function toggleCheck(i: number) {
    const next = checks.map((v, idx) => (idx === i ? !v : v));
    setChecks(next);
    try {
      localStorage.setItem(cKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  // Breathing cycle: 4s in, 4s hold, 6s out.
  useEffect(() => {
    if (!breathing) return;
    let alive = true;
    async function loop() {
      while (alive) {
        setPhase('In');
        await wait(4000, () => alive);
        if (!alive) break;
        setPhase('Hold');
        await wait(4000, () => alive);
        if (!alive) break;
        setPhase('Out');
        await wait(6000, () => alive);
      }
    }
    loop();
    return () => {
      alive = false;
    };
  }, [breathing]);

  // Speaking timer.
  useEffect(() => {
    if (running) {
      tick.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } else if (tick.current) {
      clearInterval(tick.current);
    }
    return () => {
      if (tick.current) clearInterval(tick.current);
    };
  }, [running]);

  const countdown = hearingAt ? buildCountdown(hearingAt) : null;
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <PopupPortal dark={false}>
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-gradient-to-b from-forest-950 via-forest-900 to-forest-950 text-cream-100">
      <div className="mx-auto max-w-2xl px-5 py-6 pb-24 space-y-7">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] font-semibold text-gold-300">
              Courtroom Mode
            </p>
            <h1 className="font-display text-2xl font-medium mt-1 leading-tight">
              {caseTitle}
            </h1>
            {countdown && (
              <p className="text-sm text-cream-100/70 mt-1">
                {countdown}
                {hearingLocation ? ` · ${hearingLocation}` : ''}
              </p>
            )}
          </div>
          <Link
            href={`/cases/${caseId}`}
            aria-label="Exit Courtroom Mode"
            className="rounded-full p-2 text-cream-100/60 hover:text-cream-100 hover:bg-cream-100/10 transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </Link>
        </div>

        {/* Breath */}
        <div className="rounded-2xl bg-forest-900/60 ring-1 ring-cream-100/5 p-6 flex flex-col items-center">
          <button
            type="button"
            onClick={() => setBreathing((b) => !b)}
            className="relative h-40 w-40 flex items-center justify-center"
            aria-label="Toggle breathing guide"
          >
            <span
              className={`absolute inset-0 rounded-full bg-gradient-to-br from-gold-400/30 to-forest-500/20 transition-transform ease-in-out ${
                breathing
                  ? phase === 'In'
                    ? 'scale-100 duration-[4000ms]'
                    : phase === 'Hold'
                      ? 'scale-100 duration-700'
                      : 'scale-50 duration-[6000ms]'
                  : 'scale-75 duration-700'
              }`}
            />
            <span className="relative text-center">
              <span className="block text-lg font-semibold">
                {breathing ? phase : 'Breathe'}
              </span>
              <span className="block text-[11px] text-cream-100/55 mt-1">
                {breathing ? 'tap to stop' : 'tap to begin'}
              </span>
            </span>
          </button>
        </div>

        {/* Three key points */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-gold-300 mb-3">
            Your three key points
          </h2>
          <div className="space-y-2">
            {points.map((p, i) => (
              <div key={i} className="flex items-start gap-3">
                <span className="mt-2 h-6 w-6 flex-none rounded-full bg-gold-400/15 text-gold-300 text-xs font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <textarea
                  value={p}
                  onChange={(e) => {
                    const next = [...points];
                    next[i] = e.target.value;
                    savePoints(next);
                  }}
                  rows={2}
                  placeholder={`Key point ${i + 1} - say it in one breath`}
                  className="flex-1 resize-none rounded-xl bg-forest-950/60 ring-1 ring-cream-100/10 focus:ring-gold-400/50 focus:outline-none px-3 py-2 text-sm text-cream-100 placeholder:text-cream-100/35"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Exhibits quick access */}
        {exhibits.length > 0 && (
          <section>
            <h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-gold-300 mb-3">
              Exhibits - one tap
            </h2>
            <div className="grid gap-2">
              {exhibits.map((e) => (
                <a
                  key={e.id}
                  href={`/api/files/${e.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl bg-forest-900/50 hover:bg-forest-800/60 ring-1 ring-cream-100/5 px-4 py-3 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate">
                      {e.label}
                    </span>
                    <span className="block text-[11px] text-cream-100/50 truncate">
                      {e.fileName}
                    </span>
                  </span>
                  {e.category && (
                    <span className="flex-none text-[10px] uppercase tracking-wide text-gold-300/80">
                      {e.category}
                    </span>
                  )}
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Checklist */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-gold-300 mb-3">
            Before you walk in
          </h2>
          <div className="space-y-1.5">
            {CHECKLIST.map((item, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleCheck(i)}
                className="w-full flex items-start gap-3 text-left rounded-lg px-3 py-2 hover:bg-cream-100/5 transition-colors"
              >
                <span
                  className={`mt-0.5 h-5 w-5 flex-none rounded-md flex items-center justify-center ring-1 transition-colors ${
                    checks[i]
                      ? 'bg-gold-400 ring-gold-400 text-forest-950'
                      : 'ring-cream-100/25 text-transparent'
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M5 13l4 4L19 7"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span
                  className={`text-sm leading-relaxed ${
                    checks[i]
                      ? 'text-cream-100/45 line-through'
                      : 'text-cream-100/85'
                  }`}
                >
                  {item}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* Etiquette */}
        <section>
          <h2 className="text-xs uppercase tracking-[0.18em] font-semibold text-gold-300 mb-3">
            In the room
          </h2>
          <ul className="space-y-2">
            {ETIQUETTE.map((t, i) => (
              <li
                key={i}
                className="text-sm text-cream-100/80 leading-relaxed pl-4 relative"
              >
                <span className="absolute left-0 top-2 h-1 w-1 rounded-full bg-gold-400" />
                {t}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-cream-100/40 mt-3 leading-relaxed">
            General courtroom guidance, not legal advice. Local rules
            vary - follow the court&rsquo;s and any instructions you are
            given.
          </p>
        </section>
      </div>

      {/* Discreet speaking timer - fixed bottom bar */}
      <div className="fixed inset-x-0 bottom-0 bg-forest-950/95 backdrop-blur border-t border-cream-100/10 px-5 py-3 pb-[calc(env(safe-area-inset-bottom)+12px)] flex items-center justify-between">
        <span className="tabular-nums text-2xl font-semibold tracking-tight">
          {mm}:{ss}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSeconds(0);
              setRunning(false);
            }}
            className="text-xs font-medium text-cream-100/60 hover:text-cream-100 px-3 py-2"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            className={`btn text-sm font-semibold ${
              running
                ? 'bg-cream-100/10 text-cream-100 hover:bg-cream-100/20'
                : 'bg-gold-400 hover:bg-gold-300 text-forest-950'
            }`}
          >
            {running ? 'Pause' : 'Start speaking'}
          </button>
        </div>
      </div>
    </div>
    </PopupPortal>
  );
}

function wait(ms: number, alive: () => boolean) {
  return new Promise<void>((res) => {
    const id = setTimeout(res, ms);
    const check = setInterval(() => {
      if (!alive()) {
        clearTimeout(id);
        clearInterval(check);
        res();
      }
    }, 200);
    setTimeout(() => clearInterval(check), ms + 50);
  });
}

function buildCountdown(iso: string): string {
  const diff = Date.parse(iso) - Date.now();
  if (Number.isNaN(diff)) return '';
  if (diff < 0) return 'Hearing time has passed - stay calm and present';
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `Hearing in ${d} day${d === 1 ? '' : 's'}`;
  if (h >= 1) return `Hearing in ${h} hour${h === 1 ? '' : 's'}`;
  const m = Math.max(1, Math.floor(diff / 60_000));
  return `Hearing in ${m} minute${m === 1 ? '' : 's'} - you are ready`;
}
