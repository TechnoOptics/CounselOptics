'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

/**
 * Court deadline calculator. Pick an event (you were served,
 * hearing date) and we count forward or backward by the rule
 * the user picks. The most-asked patterns at the consumer level:
 *
 *   "I was served on Monday, when do I have to file an answer"
 *   "Trial is in 30 days, when's the discovery deadline"
 *   "Statute of limitations expires Friday, when must I file"
 *
 * This client-only widget covers the time math. The SOL checker
 * at /tools/statute-of-limitations covers the lookup. Together
 * they own the "deadline" intent.
 */

type Direction = 'forward' | 'backward';

type Rule = {
  id: string;
  label: string;
  days: number;
  direction: Direction;
  detail: string;
};

// Federal Rules of Civil Procedure baselines. State variants are
// noted inline so the user knows when to second-check their state.
const RULES: Rule[] = [
  {
    id: 'answer-fed',
    label: 'Answer to a federal civil complaint (FRCP 12(a))',
    days: 21,
    direction: 'forward',
    detail:
      'Federal rule. Most state courts also use 20-30 days. Service waiver triggers 60 days.',
  },
  {
    id: 'answer-state-30',
    label: 'Answer in most state civil courts (typical 30 days)',
    days: 30,
    direction: 'forward',
    detail:
      'CA, NY, TX, FL, IL all use 30 days from personal service in most civil matters. Confirm your state code.',
  },
  {
    id: 'answer-small-claims',
    label: 'Small claims response window (typical)',
    days: 14,
    direction: 'forward',
    detail:
      'Small claims windows are short, often 10-14 days. State-specific - see resources/states.',
  },
  {
    id: 'appeal-civil',
    label: 'Notice of appeal in state civil case (typical 30 days)',
    days: 30,
    direction: 'forward',
    detail:
      'Some states use 14 or 60 days. Strict deadline - missing it usually waives the right to appeal.',
  },
  {
    id: 'appeal-federal',
    label: 'Notice of appeal, federal civil case (FRAP 4(a)(1)(A))',
    days: 30,
    direction: 'forward',
    detail:
      'Federal civil appeal deadline. United States party triggers 60-day deadline instead.',
  },
  {
    id: 'discovery-deadline-trial',
    label: 'Discovery cutoff before trial (typical 30 days before)',
    days: 30,
    direction: 'backward',
    detail:
      'Many courts close discovery 30 days before trial. Local rules vary.',
  },
  {
    id: 'pretrial-conference',
    label: 'Pretrial conference before trial (typical 14 days before)',
    days: 14,
    direction: 'backward',
    detail:
      'Many courts hold a final pretrial 7-14 days before trial. Local rules vary.',
  },
  {
    id: 'motion-hearing',
    label: 'Notice of motion before hearing (typical 14 days before)',
    days: 14,
    direction: 'backward',
    detail:
      'Many courts require 14-21 days notice for a motion. Local rules vary.',
  },
  {
    id: 'sol-personal-injury',
    label:
      'Personal injury statute of limitations deadline (typical 2 years)',
    days: 730,
    direction: 'forward',
    detail:
      'Pick a date the injury occurred, we count forward 2 years. See /tools/statute-of-limitations for exact state rules.',
  },
];

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function rollForwardOffWeekend(d: Date): Date {
  let out = new Date(d);
  while (isWeekend(out)) {
    out.setDate(out.getDate() + 1);
  }
  return out;
}

function rollBackOffWeekend(d: Date): Date {
  let out = new Date(d);
  while (isWeekend(out)) {
    out.setDate(out.getDate() - 1);
  }
  return out;
}

function todayLocalIso(): string {
  // Build YYYY-MM-DD in local time so <input type="date"> stays
  // consistent for the user. Avoid Date.now() to keep this
  // deterministic for the harness.
  return new Date().toISOString().slice(0, 10);
}

export function CourtDeadlineCalculator() {
  const [eventDate, setEventDate] = useState<string>(todayLocalIso());
  const [ruleId, setRuleId] = useState<string>('answer-state-30');
  const [rollWeekend, setRollWeekend] = useState<boolean>(true);

  const rule = useMemo(
    () => RULES.find((r) => r.id === ruleId) ?? RULES[0],
    [ruleId],
  );

  const result = useMemo(() => {
    if (!eventDate) return null;
    // Parse as local date to avoid TZ drift one-day-off bug.
    const [y, m, d] = eventDate.split('-').map(Number);
    if (!y || !m || !d) return null;
    const base = new Date(y, m - 1, d);
    const offset = rule.direction === 'forward' ? rule.days : -rule.days;
    const out = new Date(base);
    out.setDate(out.getDate() + offset);
    const rolled = rollWeekend
      ? rule.direction === 'forward'
        ? rollForwardOffWeekend(out)
        : rollBackOffWeekend(out)
      : out;
    const wasRolled = rolled.getTime() !== out.getTime();
    return { date: rolled, wasRolled, raw: out };
  }, [eventDate, rule, rollWeekend]);

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Event date
          </span>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="w-full rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-3 py-2.5 text-[15px] text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-metal"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[12px] font-mono uppercase tracking-[0.18em] text-ink-500 dark:text-cream-100/55">
            Deadline type
          </span>
          <select
            value={ruleId}
            onChange={(e) => setRuleId(e.target.value)}
            className="w-full rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950/60 px-3 py-2.5 text-[15px] text-forest-900 dark:text-cream-100 focus:outline-none focus:ring-2 focus:ring-gold-metal"
          >
            {RULES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-[13.5px] text-ink-700 dark:text-cream-100/80">
        <input
          type="checkbox"
          checked={rollWeekend}
          onChange={(e) => setRollWeekend(e.target.checked)}
          className="rounded"
        />
        Roll off weekends (most courts treat a Saturday or Sunday
        deadline as falling on the next business day)
      </label>

      {result && (
        <div className="rounded-xl ring-1 ring-gold-metal/30 bg-gradient-to-br from-cream-50/60 to-cream-50/20 dark:from-forest-900/60 dark:to-forest-900/20 p-6 sm:p-7 space-y-3">
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
            Deadline
          </p>
          <p className="font-display text-[28px] sm:text-[36px] leading-tight text-forest-900 dark:text-cream-100">
            {formatDate(result.date)}
          </p>
          {result.wasRolled && (
            <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70 italic">
              Originally fell on {formatDate(result.raw)} (a
              weekend). Rolled to the next business day.
            </p>
          )}
          <p className="text-[14px] text-ink-700 dark:text-cream-100/80">
            {rule.direction === 'forward' ? 'That is ' : 'That is '}
            {rule.days} {rule.days === 1 ? 'day' : 'days'}{' '}
            {rule.direction === 'forward' ? 'after' : 'before'}{' '}
            {formatDate(new Date(eventDate + 'T00:00:00'))}.
          </p>
          <p className="text-[13px] text-ink-600 dark:text-cream-100/70 italic border-l-2 border-gold-metal/40 pl-3">
            {rule.detail}
          </p>
          <p className="text-[12.5px] text-ink-500 dark:text-cream-100/55 pt-2 border-t border-ink-200/60 dark:border-forest-700/40">
            Informational only. Local rules can shorten or extend
            this window. Service method (personal, mail, waiver)
            also affects the clock. Confirm with your state code
            and a licensed attorney before relying on a date.
          </p>
        </div>
      )}

      <div className="text-[13px] text-ink-600 dark:text-cream-100/70 pt-2">
        Next:{' '}
        <Link href="/tools/statute-of-limitations" className="underline">
          look up your statute of limitations
        </Link>{' '}
        or{' '}
        <Link href="/sign-in?next=/cases/new" className="underline">
          open a case file in Advottic
        </Link>
        .
      </div>
    </section>
  );
}
