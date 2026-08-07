'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LocaleTime } from '@/components/LocaleTime';
import { tierSlugLabel } from '@/lib/trial-entitlement';
import {
  clearUserTrialAction,
  extendUserTrialAction,
  grantUserTrialAction,
  resetUserTrialAction,
  setUserTrialTierAction,
  type UserTrialActionResult,
} from '@/lib/user-trial-actions';

/**
 * The HQ trials view for INDIVIDUAL users: everyone on a trial clock, with the
 * levers that move it. The organization equivalent is
 * app/admin/firms/trial-controls.tsx, and this mirrors it deliberately.
 *
 * Three things this file is arranged to make unmistakable:
 *
 * 1. EXTEND AND RESTART ARE DIFFERENT. Extend adds days to the end date
 *    already on file; restart sets a new one counted from today. On a trial
 *    that lapsed last week those produce different dates, and the gap is
 *    revenue. Two separately headed blocks with their own verbs, each stating
 *    its own base date.
 *
 * 2. A PAID SUBSCRIPTION ALWAYS WINS. Every row shows what the account is
 *    ACTUALLY entitled to, so an operator can see at a glance that the trial
 *    they are looking at is doing nothing because the person pays.
 *
 * 3. NOTHING HERE DELETES ANYTHING. A trial ending ends access on a date. The
 *    copy says so, and says to download before then, because under this design
 *    the data stays exactly where it is.
 *
 * The controls send a NUMBER OF DAYS and never a date. A zone-less date string
 * from a picker is read as UTC midnight or as server-local time depending on
 * its shape, and neither is what the operator meant.
 */

/**
 * Mirrors the server bounds in lib/user-trial-actions.ts. These set the input
 * attributes and produce a message without a round trip. The server holds the
 * copy that decides anything, because a direct caller never runs this file.
 */
const MIN_TRIAL_DAYS = 1;
const MAX_TRIAL_DAYS = 365;
const DEFAULT_DAYS = '14';

const DAYS_ERROR = `Enter a whole number of days between ${MIN_TRIAL_DAYS} and ${MAX_TRIAL_DAYS}.`;

export type UserTrialView = {
  id: string;
  email: string | null;
  displayName: string | null;
  trialEndsAt: string | null;
  /**
   * Whole days from now until the end date, negative once it has passed, and
   * null when there is no end date. Computed on the server so both renders
   * read the same number and hydration cannot disagree about what day it is.
   */
  daysRemaining: number | null;
  /** The level as stored, and whether it is still one this build sells. */
  trialTier: string | null;
  trialTierKnown: boolean;
  /**
   * What the account is entitled to RIGHT NOW, with the paid subscription
   * taking precedence. 'paid' means the trial is inert.
   */
  resolvedSource: 'paid' | 'trial' | 'none';
  resolvedTier: string | null;
  /** Who last moved this trial, and when. */
  lastActorEmail: string | null;
  lastActionAt: string | null;
};

export type StartableUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  /**
   * True when the person's subscription is active or in a Stripe trial.
   *
   * Carried purely so the operator is told before granting. A trial on a
   * paying account cannot change what they get, so it is usually not what was
   * intended.
   */
  billingActive: boolean;
};

export type TierOption = { slug: string; label: string };

function parseDays(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) return null;
  if (value < MIN_TRIAL_DAYS || value > MAX_TRIAL_DAYS) return null;
  return value;
}

function personLabel(row: { email: string | null; displayName: string | null; id: string }) {
  return row.displayName || row.email || row.id.slice(0, 8);
}

/**
 * One pending flag and one error line per control group, plus the refresh that
 * pulls the new state back down. Every action returns the same shape, so the
 * caller only supplies the call.
 */
function useTrialAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(call: () => Promise<UserTrialActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return { pending, error, setError, run };
}

export function UserTrialConsole({
  rows,
  startable,
  tierOptions,
  unavailable,
}: {
  rows: UserTrialView[];
  startable: StartableUser[];
  tierOptions: TierOption[];
  /**
   * The trials list could not be read. This is NOT the same as an empty list,
   * and the difference is destructive: "nobody is on a clock" plus a Start a
   * trial control that now offers everyone is an invitation to grant a second
   * trial to somebody who already has one.
   */
  unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <div className="card p-6 text-center text-sm text-ink-600 dark:text-cream-100/70">
        <p>Could not load the user trials list.</p>
        <p className="mt-1 text-[12px] text-ink-500 dark:text-cream-100/50">
          Reload in a moment. Starting a trial stays unavailable until the list
          loads, so somebody already on a clock cannot be given a second one by
          mistake.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-600 dark:text-cream-100/70">
          Nobody is on a trial clock right now.
          {startable.length > 0 && ' Start one below.'}
        </div>
      ) : (
        <div
          className="card overflow-x-auto overflow-y-hidden"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-ink-50 dark:bg-forest-900/50 border-b border-ink-200 dark:border-forest-700/40">
              <tr className="text-left">
                <Th>User</Th>
                <Th>Trial ends</Th>
                <Th>Remaining</Th>
                <Th>Plan level</Th>
                <Th>In effect</Th>
                <Th>Controls</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 dark:divide-forest-700/40">
              {rows.map((row) => (
                <UserTrialRow key={row.id} row={row} tierOptions={tierOptions} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StartTrialForm users={startable} />

      <p className="text-[11px] text-ink-500 dark:text-cream-100/50 leading-relaxed max-w-3xl">
        A trial ends access on the date shown. Everything the person has put
        into the product stays exactly where it is, and they can download it
        before and after that date.
      </p>
      <p className="text-[11px] text-ink-500 dark:text-cream-100/50 leading-relaxed max-w-3xl">
        A plan level decides what a trial account can do. It never changes what
        a paying customer gets: a live subscription always wins, so a level set
        on a paying account sits idle until the subscription lapses.
      </p>
    </div>
  );
}

function UserTrialRow({
  row,
  tierOptions,
}: {
  row: UserTrialView;
  tierOptions: TierOption[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = `user-trial-panel-${row.id}`;

  return (
    <>
      <tr className="hover:bg-ink-50/40 dark:hover:bg-forest-800/30 align-top">
        <Td>
          <div className="font-medium text-ink-950 dark:text-cream-100">
            {personLabel(row)}
          </div>
          {row.email && (
            <div className="text-xs text-ink-500 dark:text-cream-100/55">
              {row.email}
            </div>
          )}
        </Td>

        <Td>
          {row.trialEndsAt ? (
            <LocaleTime
              iso={row.trialEndsAt}
              mode="date"
              className="text-[13px] text-ink-800 dark:text-cream-100/85"
            />
          ) : (
            <span className="text-[13px] text-ink-400 dark:text-cream-100/40">
              No end date
            </span>
          )}
        </Td>

        <Td>
          <Remaining days={row.daysRemaining} muted={row.resolvedSource === 'paid'} />
        </Td>

        <Td>
          <TierCell
            tier={row.trialTier}
            known={row.trialTierKnown}
            actorEmail={row.lastActorEmail}
            actionAt={row.lastActionAt}
          />
        </Td>

        <Td>
          <EffectBadge source={row.resolvedSource} tier={row.resolvedTier} />
        </Td>

        <Td>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="rounded-md border border-gold-500/30 px-2.5 py-1 text-[12px] font-medium text-ink-800 dark:text-cream-100/85 transition-colors hover:border-gold-500/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60"
          >
            {open ? 'Close' : 'Manage'}
          </button>
        </Td>
      </tr>

      {open && (
        <tr id={panelId} className="bg-ink-50/60 dark:bg-forest-900/40">
          <td colSpan={6} className="px-4 py-4">
            <TrialPanel row={row} tierOptions={tierOptions} />
          </td>
        </tr>
      )}
    </>
  );
}

/** The four levers for one person, plus the note that goes on the record. */
function TrialPanel({
  row,
  tierOptions,
}: {
  row: UserTrialView;
  tierOptions: TierOption[];
}) {
  const [note, setNote] = useState('');
  const trimmedNote = note.trim() ? note.trim() : null;

  return (
    <div className="space-y-4">
      <div className="max-w-xl">
        <label
          htmlFor={`user-note-${row.id}`}
          className="block text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55 mb-1"
        >
          Note for the record
        </label>
        <input
          id={`user-note-${row.id}`}
          type="text"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this change is being made. Optional."
          className="input"
        />
        <p className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/45">
          Saved with whichever change you make below, alongside your name and
          the time.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ExtendBlock row={row} note={trimmedNote} />
        <RestartBlock row={row} note={trimmedNote} />
        <TierBlock row={row} note={trimmedNote} options={tierOptions} />
        <ClearBlock row={row} note={trimmedNote} />
      </div>
    </div>
  );
}

/**
 * Extend. The routine lever, and the one whose result depends on a date
 * already on file, so the sentence names that date.
 */
function ExtendBlock({ row, note }: { row: UserTrialView; note: string | null }) {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const { pending, error, setError, run } = useTrialAction();

  if (!row.trialEndsAt) {
    return (
      <Block title="Extend the current trial" accent="neutral">
        <p className="text-[12px] text-ink-600 dark:text-cream-100/55 leading-relaxed">
          There is no end date to extend. Use Restart the trial to put this
          person on a clock.
        </p>
      </Block>
    );
  }

  function submit() {
    const parsed = parseDays(days);
    if (parsed === null) {
      setError(DAYS_ERROR);
      return;
    }
    run(() => extendUserTrialAction({ userId: row.id, days: parsed, note }));
  }

  return (
    <Block title="Extend the current trial" accent="neutral">
      <p className="text-[12px] text-ink-600 dark:text-cream-100/55 leading-relaxed">
        Adds days to the end date already on file (
        <LocaleTime iso={row.trialEndsAt} mode="date" />
        ), not to today.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <DaysInput
          id={`user-extend-${row.id}`}
          label="Days to add"
          value={days}
          onChange={setDays}
          disabled={pending}
        />
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="btn-secondary text-[13px] py-1.5"
        >
          {pending ? 'Extending' : 'Extend'}
        </button>
      </div>
      <FieldError message={error} />
    </Block>
  );
}

/**
 * Restart. Carries the accent because it discards the stored end date, and it
 * asks a second time only when the number entered lands earlier than the date
 * on file. A blanket confirm on a usually harmless lever only trains the
 * operator to click through it.
 */
function RestartBlock({ row, note }: { row: UserTrialView; note: string | null }) {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [confirming, setConfirming] = useState(false);
  const { pending, error, setError, run } = useTrialAction();

  const parsed = parseDays(days);
  const shortens =
    parsed !== null && row.daysRemaining !== null && parsed < row.daysRemaining;

  function start() {
    if (parsed === null) {
      setError(DAYS_ERROR);
      return;
    }
    if (shortens && !confirming) {
      setConfirming(true);
      return;
    }
    commit(parsed);
  }

  function commit(value: number) {
    setConfirming(false);
    run(() => resetUserTrialAction({ userId: row.id, days: value, note }));
  }

  return (
    <Block title="Restart the trial" accent="amber">
      <p className="text-[12px] text-ink-600 dark:text-cream-100/55 leading-relaxed">
        Replaces the end date with one counted from today, whatever it is now.
      </p>
      {row.trialEndsAt ? (
        <p className="text-[12px] text-ink-600 dark:text-cream-100/55 leading-relaxed">
          Currently ends <LocaleTime iso={row.trialEndsAt} mode="date" />
          <RemainingPhrase days={row.daysRemaining} />.
        </p>
      ) : (
        <p className="text-[12px] text-ink-600 dark:text-cream-100/55 leading-relaxed">
          There is no end date on file. This one starts the clock.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <DaysInput
          id={`user-restart-${row.id}`}
          label="Days from today"
          value={days}
          onChange={(next) => {
            // A new number is a new decision, so a confirm agreed against the
            // old one does not carry over.
            setConfirming(false);
            setDays(next);
          }}
          disabled={pending}
        />
        {confirming && parsed !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-amber-800 dark:text-amber-100/85">
              That ends the trial sooner than the date on file. Restart at{' '}
              {parsed} day{parsed === 1 ? '' : 's'}?
            </span>
            <button
              type="button"
              onClick={() => commit(parsed)}
              disabled={pending}
              className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-1.5 text-[13px] font-medium text-amber-800 dark:text-amber-100 transition-colors hover:bg-amber-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 disabled:opacity-50"
            >
              {pending ? 'Restarting' : 'Yes, restart'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="text-[12px] text-ink-600 dark:text-cream-100/60 underline underline-offset-2"
            >
              Keep the current date
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={pending}
            className="btn-secondary text-[13px] py-1.5"
          >
            {pending ? 'Restarting' : 'Restart'}
          </button>
        )}
      </div>
      <FieldError message={error} />
    </Block>
  );
}

/**
 * The plan level lever.
 *
 * The options come down from the server because the list is derived from the
 * price table in lib/entitlements.ts, so the select cannot offer a level the
 * action would refuse and cannot drift against it either.
 */
function TierBlock({
  row,
  note,
  options,
}: {
  row: UserTrialView;
  note: string | null;
  options: TierOption[];
}) {
  const [tier, setTier] = useState(row.trialTier ?? '');
  const { pending, error, run } = useTrialAction();

  return (
    <Block title="Plan level" accent="neutral">
      <p className="text-[12px] text-ink-600 dark:text-cream-100/55 leading-relaxed">
        What this trial can do. A live subscription always wins, so setting a
        level never changes what a paying customer gets.
      </p>
      {!row.trialEndsAt && (
        <p className="text-[12px] text-ink-600 dark:text-cream-100/55 leading-relaxed">
          There is no end date on file, so a level would have no window to
          apply in. Restart the trial first.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label
            htmlFor={`user-tier-${row.id}`}
            className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-cream-100/50"
          >
            Level
          </label>
          <select
            id={`user-tier-${row.id}`}
            value={tier}
            disabled={pending}
            onChange={(e) => setTier(e.target.value)}
            className="input py-1.5"
          >
            <option value="">No level</option>
            {options.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() =>
            run(() =>
              setUserTrialTierAction({
                userId: row.id,
                tierSlug: tier === '' ? null : tier,
                note,
              }),
            )
          }
          disabled={pending}
          className="btn-secondary text-[13px] py-1.5"
        >
          {pending ? 'Saving' : 'Save level'}
        </button>
      </div>
      <FieldError message={error} />
    </Block>
  );
}

/**
 * Ending the trial. Asks twice, because it takes trial access away on the spot
 * and the row it sits in looks much like every other row.
 *
 * The copy is a correctness statement, not reassurance: nothing on this path
 * removes anything. Access ends, the work stays, and it stays downloadable.
 */
function ClearBlock({ row, note }: { row: UserTrialView; note: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useTrialAction();

  return (
    <Block title="End the trial" accent="rose">
      <p className="text-[12px] text-ink-600 dark:text-cream-100/55 leading-relaxed">
        Takes this person off the trial clock now and clears the plan level.
        Their work stays in place and stays downloadable. Use this when a trial
        was started on the wrong account.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-ink-700 dark:text-cream-100/75">
            End the trial for {personLabel(row)}?
          </span>
          <button
            type="button"
            onClick={() => run(() => clearUserTrialAction({ userId: row.id, note }))}
            disabled={pending}
            className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-1.5 text-[13px] font-medium text-rose-700 dark:text-rose-100 transition-colors hover:bg-rose-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60 disabled:opacity-50"
          >
            {pending ? 'Ending' : 'Yes, end it'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-[12px] text-ink-600 dark:text-cream-100/60 underline underline-offset-2"
          >
            Keep the trial
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn-secondary text-[13px] py-1.5 self-start"
        >
          End the trial
        </button>
      )}
      <FieldError message={error} />
    </Block>
  );
}

/**
 * Starting a trial is its own control rather than a row action, because
 * somebody with no trial has no row: the list above holds only the people
 * already on a clock.
 */
function StartTrialForm({ users }: { users: StartableUser[] }) {
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [note, setNote] = useState('');
  const { pending, error, setError, run } = useTrialAction();

  const chosen = users.find((u) => u.id === userId) ?? null;

  if (users.length === 0) return null;

  function submit() {
    if (!userId) {
      setError('Choose a user first.');
      return;
    }
    const parsed = parseDays(days);
    if (parsed === null) {
      setError(DAYS_ERROR);
      return;
    }
    run(() =>
      grantUserTrialAction({
        userId,
        days: parsed,
        note: note.trim() ? note.trim() : null,
      }),
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold text-ink-950 dark:text-cream-100">
          Start a trial
        </h3>
        <p className="text-[12px] text-ink-600 dark:text-cream-100/55">
          Sets an end date counted from today. Set the plan level afterwards
          from Manage, so the trial runs at the level you intend.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 min-w-[240px]">
          <label
            htmlFor="start-user-trial-user"
            className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-cream-100/50"
          >
            User
          </label>
          <select
            id="start-user-trial-user"
            value={userId}
            disabled={pending}
            onChange={(e) => setUserId(e.target.value)}
            className="input py-1.5"
          >
            <option value="">Choose a user</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {personLabel(u)}
                {u.billingActive ? ' · billing active' : ''}
              </option>
            ))}
          </select>
        </div>
        <DaysInput
          id="start-user-trial-days"
          label="Days from today"
          value={days}
          onChange={setDays}
          disabled={pending}
        />
        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <label
            htmlFor="start-user-trial-note"
            className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-cream-100/50"
          >
            Note for the record
          </label>
          <input
            id="start-user-trial-note"
            type="text"
            value={note}
            maxLength={500}
            disabled={pending}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional"
            className="input py-1.5"
          />
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="btn-secondary text-[13px] py-1.5"
        >
          {pending ? 'Starting' : 'Start trial'}
        </button>
      </div>
      {chosen?.billingActive && (
        <p className="text-[12px] text-amber-800 dark:text-amber-100/85 leading-relaxed max-w-3xl">
          {personLabel(chosen)} has a live subscription, which always wins over
          a trial. A trial started here would sit idle until that subscription
          lapses.
        </p>
      )}
      <FieldError message={error} />
    </div>
  );
}

/** ", 24 days left" and its two edge cases, for a sentence to end on. */
function RemainingPhrase({ days }: { days: number | null }) {
  if (days === null) return null;
  if (days > 0) {
    return <>, {days} day{days === 1 ? '' : 's'} left</>;
  }
  if (days === 0) return <>, ending today</>;
  const ago = Math.abs(days);
  return <>, ended {ago} day{ago === 1 ? '' : 's'} ago</>;
}

/**
 * The one figure an operator scans for, so it is the one thing set larger than
 * the rest of the row. A trial that a paid subscription overrides gets the
 * muted tone whatever its number says.
 */
function Remaining({ days, muted }: { days: number | null; muted: boolean }) {
  if (days === null) {
    return (
      <span className="text-[13px] text-ink-400 dark:text-cream-100/40">
        Not on a clock
      </span>
    );
  }
  if (days <= 0) {
    const ago = Math.abs(days);
    return (
      <div>
        <div className="text-[15px] font-semibold text-rose-600 dark:text-rose-200">
          Ended
        </div>
        <div className="text-[11px] text-ink-500 dark:text-cream-100/50">
          {ago === 0 ? 'today' : `${ago} day${ago === 1 ? '' : 's'} ago`}
        </div>
      </div>
    );
  }
  const tone = muted
    ? 'text-ink-400 dark:text-cream-100/45'
    : days <= 7
      ? 'text-amber-600 dark:text-amber-200'
      : 'text-emerald-700 dark:text-emerald-200';
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-xl font-semibold tabular-nums ${tone}`}>{days}</span>
      <span className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-cream-100/45">
        {days === 1 ? 'day left' : 'days left'}
      </span>
    </div>
  );
}

/**
 * The plan level, and who set it.
 *
 * A level that is no longer one this build sells is shown AS a problem rather
 * than tidied away, because the resolver grants nothing for it. Rendering it
 * as a plain label would leave an account looking provisioned while it had no
 * entitlement at all.
 */
function TierCell({
  tier,
  known,
  actorEmail,
  actionAt,
}: {
  tier: string | null;
  known: boolean;
  actorEmail: string | null;
  actionAt: string | null;
}) {
  return (
    <div className="max-w-[200px]">
      {tier === null ? (
        <span className="text-[13px] text-ink-400 dark:text-cream-100/40">
          No level set
        </span>
      ) : known ? (
        <span className="badge text-[10px] tracking-wider bg-gold-500/15 text-gold-700 dark:text-gold-200 border border-gold-500/30">
          {tierSlugLabel(tier)}
        </span>
      ) : (
        <div>
          <span className="badge text-[10px] tracking-wider bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-400/30">
            {tier}
          </span>
          <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-200/75 leading-snug">
            Not a plan this build sells, so it grants nothing. Set a level from
            the list.
          </div>
        </div>
      )}
      {actorEmail && (
        <div className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/50 leading-snug break-words">
          Set by {actorEmail}
          {actionAt && (
            <>
              {' '}
              <LocaleTime iso={actionAt} mode="date" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the account is ACTUALLY on, which is the question the whole surface is
 * for. 'paid' here means the trial beside it is doing nothing.
 */
function EffectBadge({
  source,
  tier,
}: {
  source: UserTrialView['resolvedSource'];
  tier: string | null;
}) {
  if (source === 'paid') {
    return (
      <div className="max-w-[200px]">
        <span className="badge text-[10px] tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-100 dark:border-emerald-400/30">
          Paid{tier ? `: ${tierSlugLabel(tier)}` : ''}
        </span>
        <div className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/55 leading-snug">
          The subscription wins, so the trial is not doing anything.
        </div>
      </div>
    );
  }
  if (source === 'trial') {
    return (
      <span className="badge text-[10px] tracking-wider bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/40 dark:text-sky-100 dark:border-sky-400/30">
        Trial{tier ? `: ${tierSlugLabel(tier)}` : ''}
      </span>
    );
  }
  return (
    <div className="max-w-[200px]">
      <span className="badge text-[10px] tracking-wider bg-ink-100 text-ink-700 dark:bg-forest-800/40 dark:text-cream-100/70">
        Nothing
      </span>
      <div className="mt-1 text-[11px] text-ink-500 dark:text-cream-100/55 leading-snug">
        No subscription, and the trial is not granting a level.
      </div>
    </div>
  );
}

/**
 * One control group. The accent carries meaning rather than decoration:
 * neutral for the routine levers, amber for the one that discards a stored
 * date, rose for the one that ends access.
 */
function Block({
  title,
  accent,
  children,
}: {
  title: string;
  accent: 'neutral' | 'amber' | 'rose';
  children: React.ReactNode;
}) {
  const edge =
    accent === 'amber'
      ? 'border-l-amber-400/60'
      : accent === 'rose'
        ? 'border-l-rose-400/60'
        : 'border-l-gold-500/30';
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border border-ink-200 dark:border-forest-700/50 border-l-2 bg-white dark:bg-forest-900/40 p-3 ${edge}`}
    >
      <h4 className="text-[12px] font-semibold uppercase tracking-wider text-ink-600 dark:text-cream-100/75">
        {title}
      </h4>
      {children}
    </div>
  );
}

function DaysInput({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-cream-100/50"
      >
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={MIN_TRIAL_DAYS}
        max={MAX_TRIAL_DAYS}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="input w-24 py-1.5 tabular-nums"
      />
    </div>
  );
}

/**
 * The live region is rendered whether or not there is a message, because a
 * region that appears at the same moment as its text is often not announced.
 * `empty:hidden` keeps it out of the layout until it has something to say.
 */
function FieldError({ message }: { message: string | null }) {
  return (
    <p
      aria-live="polite"
      className="text-[11px] text-rose-600 dark:text-rose-200 leading-snug empty:hidden"
    >
      {message}
    </p>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
}
