'use client';

import { useEffect, useRef, useState } from 'react';

type Testimonial = {
  quote: string;
  name: string;
  context: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "I walked into court with a binder for the first time in my life and a judge actually said the word 'organized.' That word changed how the rest of the hearing went.",
    name: 'Marisol R.',
    context: 'Self-represented, landlord-tenant',
  },
  {
    quote:
      "The Advottic Review surfaced a procedural defense I didn't know existed. My attorney told me later it shaved months off the timeline.",
    name: 'David K.',
    context: 'Small-business owner, contract dispute',
  },
  {
    quote:
      'Bella explained what an Answer is, what a motion is, and why deadlines matter - in plain English, in five minutes. I stopped feeling lost.',
    name: 'Tracy P.',
    context: 'First-time defendant',
  },
  {
    quote:
      "I gathered eight exhibits in a weekend instead of months. Photos, texts, emails - all numbered, all categorized. It honestly felt like having a paralegal in my pocket.",
    name: 'Jonathan A.',
    context: 'Civil claimant, family matter',
  },
  {
    quote:
      'The countdown to my hearing reminded me to file my Answer the day before it was due. That single nudge saved me from a default judgment.',
    name: 'Priya V.',
    context: 'Pro se respondent',
  },
  {
    quote:
      "Going through this alone was the scariest part. Having a tool that didn't talk down to me, but also didn't pretend to be my lawyer, made the difficult days workable.",
    name: 'M. Hassan',
    context: 'Harassment / restraining order',
  },
  {
    quote:
      "I'm an attorney and I asked my client to use Advottic before our intake. Best 30 minutes of prep I've ever gotten from a client. Saw the whole picture instantly.",
    name: 'Counselor L.',
    context: 'Solo practitioner',
  },
  {
    quote:
      "Exporting the case packet PDF and emailing it to the lawyer was the moment I stopped feeling like I was drowning. One file. The whole story.",
    name: 'Renée G.',
    context: 'Employment dispute',
  },
  {
    quote:
      'The list of subpoena targets Advottic Review gave me - records I never would have thought to ask for - was the difference between a he-said/she-said case and a paper-trail case.',
    name: 'Anonymous',
    context: 'Civil claimant, fraud',
  },
];

/**
 * Auto-scrolling testimonial strip that **pauses on user interaction**
 * and **resumes after 4 seconds of inactivity**. Implementation:
 *
 * - The strip is a horizontally-scrollable div with `overflow-x: auto`
 *   so the user can scroll/swipe by hand at any time.
 * - A requestAnimationFrame loop nudges scrollLeft forward by ~30 px/s.
 *   Scrolling, hovering, focusing, or touching the strip flips a
 *   `paused` flag that suspends the loop.
 * - When scrollLeft passes the halfway mark we wrap back to 0
 *   seamlessly (the testimonial array is duplicated so the visible
 *   content stays unbroken across the wrap).
 * - 4-second inactivity timer resumes the loop after the user is
 *   done interacting.
 */
export function TestimonialMarquee() {
  const items = [...TESTIMONIALS, ...TESTIMONIALS];
  const trackRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, force] = useState(0);

  // Auto-scroll loop. Runs on every paint while not paused, advancing
  // scrollLeft by ~0.5 px per frame at 60fps = ~30 px/s. Skipped
  // entirely when the user prefers reduced motion - they can still
  // swipe / scroll the strip by hand.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      pausedRef.current = true;
      return;
    }

    let raf = 0;
    let lastT = 0;
    function step(t: number) {
      raf = requestAnimationFrame(step);
      const node = trackRef.current;
      if (!node) return;
      if (pausedRef.current) {
        lastT = t;
        return;
      }
      if (lastT === 0) lastT = t;
      const dt = t - lastT;
      lastT = t;
      node.scrollLeft += (dt / 1000) * 30;
      const half = node.scrollWidth / 2;
      if (node.scrollLeft >= half) node.scrollLeft -= half;
    }
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  function pause() {
    pausedRef.current = true;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    force((n) => n + 1); // re-render so the visual pause indicator updates
  }
  function scheduleResume() {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    // 4 seconds of inactivity before the carousel takes over again -
    // long enough that a user reading a card isn't yanked away.
    resumeTimer.current = setTimeout(() => {
      pausedRef.current = false;
      force((n) => n + 1);
    }, 4000);
  }

  return (
    <section className="relative" aria-label="What people say about Advottic">
      <div className="text-center mb-6">
        <p className="eyebrow justify-center mb-2">Voices</p>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-forest-900 dark:text-cream-100">
          Real users in difficult times. Better days afterwards.
        </h2>
        <p className="text-sm text-ink-500 mt-2 max-w-2xl mx-auto">
          A few of the things people have told us about how Advottic helped them advocate for
          themselves, learn the system, or just stop feeling alone in the file.
        </p>
        <div className="mt-3 inline-flex items-center gap-2">
          <p className="text-[10.5px] uppercase tracking-[0.22em] text-ink-400">
            {pausedRef.current ? 'Paused' : 'Auto-scrolling'}
          </p>
          <button
            type="button"
            // Explicit toggle so keyboard and touch users have a clear
            // affordance to stop the marquee; complements the hover /
            // focus pause that already exists for mouse + screen-reader
            // navigation.
            onClick={() => {
              if (resumeTimer.current) {
                window.clearTimeout(resumeTimer.current);
                resumeTimer.current = null;
              }
              pausedRef.current = !pausedRef.current;
              force((n) => n + 1);
            }}
            aria-pressed={pausedRef.current}
            aria-label={pausedRef.current ? 'Resume auto-scroll' : 'Pause auto-scroll'}
            className="inline-flex items-center justify-center h-5 w-5 rounded-full ring-1 ring-ink-200 dark:ring-cream-100/30 text-ink-500 dark:text-cream-100/65 hover:text-forest-900 dark:hover:text-cream-100 hover:ring-forest-700 dark:hover:ring-cream-100/70 transition-colors"
          >
            {pausedRef.current ? (
              <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                <path d="M3 1.5 L10 6 L3 10.5 Z" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
                <rect x="3" y="2" width="2" height="8" rx="0.5" />
                <rect x="7" y="2" width="2" height="8" rx="0.5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div
        ref={trackRef}
        onMouseEnter={pause}
        onMouseLeave={scheduleResume}
        onFocus={pause}
        onBlur={scheduleResume}
        onTouchStart={pause}
        onTouchEnd={scheduleResume}
        onScroll={() => {
          // any scroll input is treated as a pause; we'll resume
          // after the inactivity timer.
          if (!pausedRef.current) {
            pausedRef.current = true;
            force((n) => n + 1);
          }
          scheduleResume();
        }}
        className="marquee-mask flex gap-4 py-4 overflow-x-auto overflow-y-hidden no-scrollbar cursor-grab active:cursor-grabbing"
        style={{ scrollSnapType: 'x proximity' }}
      >
        {items.map((t, i) => (
          <article
            key={i}
            className="flex-none w-[320px] md:w-[360px] rounded-2xl border border-ink-200 bg-white dark:bg-forest-900 dark:border-forest-700/40 p-5 shadow-card"
            style={{ scrollSnapAlign: 'start' }}
          >
            <p className="text-sm text-ink-800 dark:text-cream-100/85 leading-relaxed">
              <span className="text-gold-500 text-xl leading-none mr-1 align-[-2px]">&ldquo;</span>
              {t.quote}
              <span className="text-gold-500 text-xl leading-none ml-1 align-[-2px]">&rdquo;</span>
            </p>
            <div className="mt-4 pt-3 border-t border-ink-100 dark:border-forest-700/40 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-forest-900 dark:text-cream-100 truncate">
                  {t.name}
                </p>
                <p className="text-xs text-ink-500 dark:text-cream-100/55 truncate">
                  {t.context}
                </p>
              </div>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-gold-700 dark:text-gold-300">
                Advottic
              </span>
            </div>
          </article>
        ))}
      </div>

      <p className="text-[11px] text-ink-400 mt-3 text-center max-w-2xl mx-auto">
        Names changed or shortened on request. Quotes lightly edited for length and clarity.
        Outcomes vary - past results aren&apos;t a promise of future ones.
      </p>
    </section>
  );
}
