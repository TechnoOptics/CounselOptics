'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LocaleTime } from '@/components/LocaleTime';
import {
  extendTrialAction,
  grantTrialAction,
  resetTrialAction,
  setSeatLimitAction,
  setSuspendedAction,
  setTrialTierAction,
  type TrialActionResult,
} from '@/lib/firm-trial-actions';
import { tierSlugLabel } from '@/lib/trial-entitlement';

/**
 * The HQ trials view: every organization that is on a trial clock or closed,
 * with the five levers that move it.
 *
 * Two things this file is arranged to make unmistakable, because both are
 * commercial and both are easy to get wrong at a glance.
 *
 * 1. EXTEND AND RESTART ARE DIFFERENT. Extend adds days to the end date that
 *    is already stored; restart sets a new one counted from today. On a trial
 *    that lapsed last week those produce different dates, and the gap is
 *    revenue. They are two separately headed blocks with their own verbs
 *    rather than two entries in one menu, and each states its own base date in
 *    the sentence under it.
 *
 * 2. A SUSPENDED ORGANIZATION WITH A FUTURE END DATE IS NOT A BUG. Suspension
 *    outranks the dates, so the row has to say why a future date sits beside a
 *    closed organization instead of leaving the operator to guess.
 *
 * The controls send a NUMBER OF DAYS and never a date. A zone-less date string
 * from a picker is read as UTC midnight or as server-local time depending on
 * its shape, and neither is what the operator meant.
 */

/**
 * Mirrors the server bounds in lib/firm-trial-actions.ts. These set the input
 * attributes and produce a message without a round trip. The server holds the
 * copy that decides anything, because a direct caller never runs this file.
 */
const MIN_TRIAL_DAYS = 1;
const MAX_TRIAL_DAYS = 365;
/**
 * One seat, not zero, because the column carries
 * `check (seat_limit is null or seat_limit > 0)`. Offering zero in the input
 * invites a value the database refuses, and that refusal surfaces as a
 * generic "Unavailable. Please try again.", which reads as transient when it
 * is permanent. "No limit" is the Remove the limit button, not a zero.
 */
const MIN_SEAT_LIMIT = 1;
const MAX_SEAT_LIMIT = 10_000;
const DEFAULT_DAYS = '14';

const DAYS_ERROR = `Enter a whole number of days between ${MIN_TRIAL_DAYS} and ${MAX_TRIAL_DAYS}.`;
const SEATS_ERROR = `Enter a whole number of seats between ${MIN_SEAT_LIMIT} and ${MAX_SEAT_LIMIT}, or remove the limit.`;

export type TrialFirmView = {
  id: string;
  name: string;
  slug: string;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  seatLimit: number | null;
  memberCount: number;
  state: 'active' | 'export_only';
  /**
   * The plan level the trial runs at, as stored, or null for none.
   *
   * Raw rather than pre-labelled, and `known` says whether it is still one of
   * the levels this build sells. A level that has fallen out of the price
   * table grants nothing, and the operator has to SEE that rather than read a
   * tidy label for a plan that is doing nothing.
   */
  trialTier: string | null;
  trialTierKnown: boolean;
  /** Who last moved this trial, and when. */
  lastActorEmail: string | null;
  lastActionAt: string | null;
  /**
   * Whole days from now until the end date, negative once it has passed, and
   * null when there is no end date.
   *
   * Computed on the server and passed down rather than derived here. Both
   * renders then read the same number, so hydration cannot disagree about what
   * day it is, which is the same reason LocaleTime exists.
   */
  daysRemaining: number | null;
};

/**
 * The plan levels a trial may run at, handed down from the server because the
 * list is derived from the price table in lib/entitlements.ts. Hard-coding it
 * in the browser would be a second copy of the entitlement vocabulary.
 */
export type TierOption = { slug: string; label: string };

export type StartableFirm = {
  id: string;
  name: string;
  slug: string;
  /**
   * True when the owner's subscription is active or in a Stripe trial.
   *
   * Carried purely so the operator is told before granting. A trial end date
   * closes an organization once it passes whatever the billing says, so
   * putting one on a paying customer arms a shutoff on a date nobody is
   * watching.
   */
  billingActive: boolean;
};

function parseDays(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) return null;
  if (value < MIN_TRIAL_DAYS || value > MAX_TRIAL_DAYS) return null;
  return value;
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

  function run(call: () => Promise<TrialActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await call();
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return { pending, error, setError, run };
}

export function TrialConsole({
  rows,
  startable,
  tierOptions,
  unavailable,
}: {
  rows: TrialFirmView[];
  startable: StartableFirm[];
  tierOptions: TierOption[];
  /**
   * The trials list could not be read. This is NOT the same as an empty list,
   * and the difference is destructive: "no organization is on a clock" plus a
   * Start a trial control that now offers every organization is an invitation
   * to grant a second trial to one that already has one.
   *
   * So a failed read says so and offers nothing. The organizations are still
   * reachable from the table below, and the action layer refuses a grant on an
   * organization that already has an end date, so nothing here is the last
   * line of defence. It is the honest one.
   */
  unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <div className="card p-8 text-center text-sm text-cream-100/70">
        <p>Could not load the trials list.</p>
        <p className="mt-1 text-[12px] text-cream-100/50">
          Reload in a moment. Starting a trial stays unavailable until the list
          loads, so an organization already on a clock cannot be given a second
          one by mistake.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-cream-100/70">
          No organization is on a trial clock right now.
          {startable.length > 0 && ' Start one below.'}
        </div>
      ) : (
        <div
          className="card overflow-x-auto overflow-y-hidden"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-forest-900/50 border-b border-forest-700/40">
              <tr className="text-left">
                <Th>Organization</Th>
                <Th>Trial ends</Th>
                <Th>Remaining</Th>
                <Th>Plan level</Th>
                <Th>Seats</Th>
                <Th>State</Th>
                <Th>Controls</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-forest-700/40">
              {rows.map((row) => (
                <TrialRow key={row.id} row={row} tierOptions={tierOptions} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StartTrialForm firms={startable} />

      <p className="text-[11px] text-cream-100/50 leading-relaxed max-w-3xl">
        Export only means the organization keeps everything it has put into the
        product and can still export it at any time. Access ends on the date
        shown, and nothing here removes an organization's data.
      </p>
      <p className="text-[11px] text-cream-100/50 leading-relaxed max-w-3xl">
        A plan level decides what a trial organization can do. It never changes
        what a paying organization gets: a live subscription always wins, so a
        level set on a paying account sits idle until the subscription lapses.
      </p>
    </div>
  );
}

function TrialRow({
  row,
  tierOptions,
}: {
  row: TrialFirmView;
  tierOptions: TierOption[];
}) {
  const [open, setOpen] = useState(false);
  const suspended = row.suspendedAt !== null;
  const endsInFuture = row.daysRemaining !== null && row.daysRemaining > 0;
  const panelId = `trial-panel-${row.id}`;

  return (
    <>
      <tr className="hover:bg-forest-800/30 align-top">
        <Td>
          <div className="font-medium text-cream-100">{row.name}</div>
          <div className="text-xs text-cream-100/50 font-mono">/{row.slug}</div>
        </Td>

        <Td>
          {row.trialEndsAt ? (
            <>
              <LocaleTime
                iso={row.trialEndsAt}
                mode="date"
                className="text-[13px] text-cream-100/85"
              />
              {suspended && endsInFuture && (
                <div className="mt-0.5 text-[11px] text-amber-200/75 leading-snug">
                  Not in effect while suspended.
                </div>
              )}
            </>
          ) : (
            <span className="text-[13px] text-cream-100/40">No end date</span>
          )}
        </Td>

        <Td>
          <Remaining days={row.daysRemaining} muted={suspended} />
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
          <div className="text-[13px] tabular-nums text-cream-100/85">
            {row.seatLimit === null
              ? row.memberCount
              : `${row.memberCount} of ${row.seatLimit}`}
          </div>
          {row.seatLimit === null && (
            <div className="text-[11px] text-cream-100/45">No limit set</div>
          )}
          {row.seatLimit !== null && row.memberCount >= row.seatLimit && (
            <div className="mt-0.5 text-[11px] text-amber-200/75 leading-snug">
              At the limit. Nobody else can be added.
            </div>
          )}
        </Td>

        <Td>
          <StateBadge state={row.state} />
          {suspended ? (
            <div className="mt-1 text-[11px] text-cream-100/60 leading-snug max-w-[220px]">
              Suspended{' '}
              <LocaleTime iso={row.suspendedAt} mode="date" />. Stays closed
              until it is restored.
            </div>
          ) : (
            row.state === 'export_only' && (
              <div className="mt-1 text-[11px] text-cream-100/60 leading-snug max-w-[220px]">
                The trial has ended.
              </div>
            )
          )}
        </Td>

        <Td>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="rounded-md border border-gold-500/30 px-2.5 py-1 text-[12px] font-medium text-cream-100/85 transition-colors hover:border-gold-500/60 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60"
          >
            {open ? 'Close' : 'Manage'}
          </button>
        </Td>
      </tr>

      {open && (
        <tr id={panelId} className="bg-forest-900/40">
          <td colSpan={7} className="px-4 py-4">
            <TrialPanel row={row} tierOptions={tierOptions} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The four levers for one organization, plus the note that goes on the record
 * with whichever one is used.
 */
function TrialPanel({
  row,
  tierOptions,
}: {
  row: TrialFirmView;
  tierOptions: TierOption[];
}) {
  const [note, setNote] = useState('');
  const trimmedNote = note.trim() ? note.trim() : null;

  return (
    <div className="space-y-4">
      <div className="max-w-xl">
        <label
          htmlFor={`note-${row.id}`}
          className="block text-[11px] font-semibold uppercase tracking-wider text-cream-100/55 mb-1"
        >
          Note for the record
        </label>
        <input
          id={`note-${row.id}`}
          type="text"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why this change is being made. Optional."
          className="input"
        />
        <p className="mt-1 text-[11px] text-cream-100/45">
          Saved with whichever change you make below, alongside your name and
          the time.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ExtendBlock row={row} note={trimmedNote} />
        <RestartBlock row={row} note={trimmedNote} />
        <TierBlock row={row} note={trimmedNote} options={tierOptions} />
        <SeatsBlock row={row} note={trimmedNote} />
        <AccessBlock row={row} note={trimmedNote} />
      </div>
    </div>
  );
}

/**
 * Extend. Deliberately the quieter of the two date blocks: it is the routine
 * one, and it is the one whose result depends on a date already on file.
 */
function ExtendBlock({
  row,
  note,
}: {
  row: TrialFirmView;
  note: string | null;
}) {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const { pending, error, setError, run } = useTrialAction();

  if (!row.trialEndsAt) {
    return (
      <Block title="Extend the current trial" accent="neutral">
        <p className="text-[12px] text-cream-100/55 leading-relaxed">
          There is no end date to extend. Use Restart the trial to put this
          organization on a clock.
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
    run(() => extendTrialAction({ firmId: row.id, days: parsed, note }));
  }

  return (
    <Block title="Extend the current trial" accent="neutral">
      <p className="text-[12px] text-cream-100/55 leading-relaxed">
        Adds days to the end date already on file (
        <LocaleTime iso={row.trialEndsAt} mode="date" />
        ), not to today.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <DaysInput
          id={`extend-${row.id}`}
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
 * Restart. Carries the accent because it is the one that discards the stored
 * end date, and the sentence names its base date out loud.
 *
 * TWO THINGS ABOUT SHORTENING, and they are separate. Restarting a trial that
 * has 200 days left at 14 days takes 186 days away. That is a magnitude
 * consequence of a correctly labelled action, not a mislabelled action, so the
 * fix is to SHOW the date being replaced rather than to put a confirm in front
 * of every restart. A blanket second step on a lever that is usually harmless
 * only trains the operator to click through it, which is precisely what would
 * make the harmful case slip past.
 *
 * So: the block always names what is on file, and it asks a second time only
 * when the number entered lands earlier than that date.
 */
function RestartBlock({
  row,
  note,
}: {
  row: TrialFirmView;
  note: string | null;
}) {
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [confirming, setConfirming] = useState(false);
  const { pending, error, setError, run } = useTrialAction();

  const parsed = parseDays(days);
  // Both numbers are whole days measured from the same server clock, so they
  // compare directly. daysRemaining is null when there is no date on file, and
  // nothing is being shortened in that case.
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
    run(() => resetTrialAction({ firmId: row.id, days: value, note }));
  }

  return (
    <Block title="Restart the trial" accent="amber">
      <p className="text-[12px] text-cream-100/55 leading-relaxed">
        Replaces the end date with one counted from today, whatever it is now.
        {row.suspendedAt !== null && ' This does not reopen a suspended organization.'}
      </p>
      {row.trialEndsAt ? (
        <p className="text-[12px] text-cream-100/55 leading-relaxed">
          Currently ends <LocaleTime iso={row.trialEndsAt} mode="date" />
          <RemainingPhrase days={row.daysRemaining} />.
        </p>
      ) : (
        <p className="text-[12px] text-cream-100/55 leading-relaxed">
          There is no end date on file. This one starts the clock.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <DaysInput
          id={`restart-${row.id}`}
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
            <span className="text-[12px] text-amber-100/85">
              That ends the trial sooner than the date on file. Restart at{' '}
              {parsed} day{parsed === 1 ? '' : 's'}?
            </span>
            <button
              type="button"
              onClick={() => commit(parsed)}
              disabled={pending}
              className="rounded-lg border border-amber-400/50 bg-amber-500/10 px-3 py-1.5 text-[13px] font-medium text-amber-100 transition-colors hover:bg-amber-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 disabled:opacity-50"
            >
              {pending ? 'Restarting' : 'Yes, restart'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="text-[12px] text-cream-100/60 underline underline-offset-2 transition-colors hover:text-cream-100"
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
 * The plan level, and who set it, in the row an operator scans.
 *
 * A level that is no longer one this build sells is shown AS a problem rather
 * than tidied away, because the resolver grants nothing for it. Rendering it
 * as a plain label would leave an organization looking provisioned while it
 * had no entitlement at all.
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
        <span className="text-[13px] text-cream-100/40">No level set</span>
      ) : known ? (
        <span className="badge text-[10px] tracking-wider bg-gold-500/15 text-gold-200 border border-gold-500/30">
          {tierSlugLabel(tier)}
        </span>
      ) : (
        <div>
          <span className="badge text-[10px] tracking-wider bg-amber-950/40 text-amber-100 border border-amber-400/30">
            {tier}
          </span>
          <div className="mt-0.5 text-[11px] text-amber-200/75 leading-snug">
            Not a plan this build sells, so it grants nothing. Set a level from
            the list.
          </div>
        </div>
      )}
      {actorEmail && (
        <div className="mt-1 text-[11px] text-cream-100/50 leading-snug break-words">
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
 * The plan level lever.
 *
 * The options come down from the server because the list is derived from the
 * price table. The select therefore cannot offer a level the action would
 * refuse, and it cannot go stale against it either.
 *
 * The block states out loud that this cannot touch a paying organization. That
 * is not reassurance copy, it is the operating model: lib/trial-entitlement.ts
 * resolves a live subscription ahead of any trial, so the level an operator
 * sets here does nothing at all until the subscription lapses.
 */
function TierBlock({
  row,
  note,
  options,
}: {
  row: TrialFirmView;
  note: string | null;
  options: TierOption[];
}) {
  const [tier, setTier] = useState(row.trialTier ?? '');
  const { pending, error, run } = useTrialAction();

  return (
    <Block title="Plan level" accent="neutral">
      <p className="text-[12px] text-cream-100/55 leading-relaxed">
        What this trial can do. A live subscription always wins, so setting a
        level never changes what a paying organization gets.
      </p>
      {!row.trialEndsAt && (
        <p className="text-[12px] text-cream-100/55 leading-relaxed">
          There is no end date on file, so a level would have no window to
          apply in. Restart the trial first.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label
            htmlFor={`tier-${row.id}`}
            className="text-[11px] uppercase tracking-wider text-cream-100/50"
          >
            Level
          </label>
          <select
            id={`tier-${row.id}`}
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
              setTrialTierAction({
                firmId: row.id,
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

function SeatsBlock({
  row,
  note,
}: {
  row: TrialFirmView;
  note: string | null;
}) {
  const [seats, setSeats] = useState(
    row.seatLimit === null ? '' : String(row.seatLimit),
  );
  const { pending, error, setError, run } = useTrialAction();

  function save() {
    const value = Number.parseInt(seats, 10);
    if (
      !Number.isInteger(value) ||
      value < MIN_SEAT_LIMIT ||
      value > MAX_SEAT_LIMIT
    ) {
      setError(SEATS_ERROR);
      return;
    }
    run(() => setSeatLimitAction({ firmId: row.id, seatLimit: value, note }));
  }

  return (
    <Block title="Seat limit" accent="neutral">
      <p className="text-[12px] text-cream-100/55 leading-relaxed">
        Checked when the organization adds a member. Lowering it never removes
        anyone already in place; it only stops the next person being added. The
        smallest limit is one seat. To lift the cap entirely, remove it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col gap-1">
          <label
            htmlFor={`seats-${row.id}`}
            className="text-[11px] uppercase tracking-wider text-cream-100/50"
          >
            Seats
          </label>
          <input
            id={`seats-${row.id}`}
            type="number"
            inputMode="numeric"
            min={MIN_SEAT_LIMIT}
            max={MAX_SEAT_LIMIT}
            step={1}
            value={seats}
            disabled={pending}
            onChange={(e) => setSeats(e.target.value)}
            className="input w-24 py-1.5 tabular-nums"
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="btn-secondary text-[13px] py-1.5"
        >
          {pending ? 'Saving' : 'Save limit'}
        </button>
        {row.seatLimit !== null && (
          <button
            type="button"
            onClick={() => {
              setSeats('');
              run(() =>
                setSeatLimitAction({ firmId: row.id, seatLimit: null, note }),
              );
            }}
            disabled={pending}
            className="text-[12px] text-cream-100/60 underline underline-offset-2 transition-colors hover:text-cream-100 disabled:opacity-50"
          >
            Remove the limit
          </button>
        )}
      </div>
      <FieldError message={error} />
    </Block>
  );
}

/**
 * Suspend and restore. Suspend asks twice, because it closes a live customer
 * account and the row it sits in looks much like every other row.
 */
function AccessBlock({
  row,
  note,
}: {
  row: TrialFirmView;
  note: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const { pending, error, run } = useTrialAction();
  const suspended = row.suspendedAt !== null;

  if (suspended) {
    return (
      <Block title="Access" accent="neutral">
        <p className="text-[12px] text-cream-100/55 leading-relaxed">
          This organization is closed. Restoring reopens it, and the trial end
          date on file applies again from that moment.
        </p>
        <button
          type="button"
          onClick={() =>
            run(() =>
              setSuspendedAction({ firmId: row.id, suspended: false, note }),
            )
          }
          disabled={pending}
          className="btn-secondary text-[13px] py-1.5 self-start"
        >
          {pending ? 'Restoring' : 'Restore access'}
        </button>
        <FieldError message={error} />
      </Block>
    );
  }

  return (
    <Block title="Access" accent="rose">
      <p className="text-[12px] text-cream-100/55 leading-relaxed">
        Suspending closes the organization to everything except exporting its
        own work. Its data stays in place, and restoring reopens it.
      </p>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-cream-100/75">
            Suspend {row.name}?
          </span>
          <button
            type="button"
            onClick={() =>
              run(() =>
                setSuspendedAction({ firmId: row.id, suspended: true, note }),
              )
            }
            disabled={pending}
            className="rounded-lg border border-rose-400/50 bg-rose-500/10 px-3 py-1.5 text-[13px] font-medium text-rose-100 transition-colors hover:bg-rose-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60 disabled:opacity-50"
          >
            {pending ? 'Suspending' : 'Yes, suspend'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-[12px] text-cream-100/60 underline underline-offset-2 transition-colors hover:text-cream-100"
          >
            Keep it open
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn-secondary text-[13px] py-1.5 self-start"
        >
          Suspend
        </button>
      )}
      <FieldError message={error} />
    </Block>
  );
}

/**
 * Starting a trial is its own control rather than a row action, because an
 * organization with no trial has no row: the list above holds only the ones
 * already on a clock or closed.
 */
function StartTrialForm({ firms }: { firms: StartableFirm[] }) {
  const [firmId, setFirmId] = useState('');
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [note, setNote] = useState('');
  const { pending, error, setError, run } = useTrialAction();

  const chosen = firms.find((f) => f.id === firmId) ?? null;

  if (firms.length === 0) return null;

  function submit() {
    if (!firmId) {
      setError('Choose an organization first.');
      return;
    }
    const parsed = parseDays(days);
    if (parsed === null) {
      setError(DAYS_ERROR);
      return;
    }
    run(() =>
      grantTrialAction({
        firmId,
        days: parsed,
        note: note.trim() ? note.trim() : null,
      }),
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold text-cream-100">
          Start a trial
        </h3>
        <p className="text-[12px] text-cream-100/55">
          {firms.length} organization{firms.length === 1 ? ' is' : 's are'} not
          on a trial clock. Starting one sets an end date counted from today.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1 min-w-[220px]">
          <label
            htmlFor="start-trial-firm"
            className="text-[11px] uppercase tracking-wider text-cream-100/50"
          >
            Organization
          </label>
          <select
            id="start-trial-firm"
            value={firmId}
            disabled={pending}
            onChange={(e) => setFirmId(e.target.value)}
            className="input py-1.5"
          >
            <option value="">Choose an organization</option>
            {firms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} (/{f.slug})
                {f.billingActive ? ' · billing active' : ''}
              </option>
            ))}
          </select>
        </div>
        <DaysInput
          id="start-trial-days"
          label="Days from today"
          value={days}
          onChange={setDays}
          disabled={pending}
        />
        <div className="flex flex-col gap-1 flex-1 min-w-[220px]">
          <label
            htmlFor="start-trial-note"
            className="text-[11px] uppercase tracking-wider text-cream-100/50"
          >
            Note for the record
          </label>
          <input
            id="start-trial-note"
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
        <p className="text-[12px] text-amber-100/85 leading-relaxed max-w-3xl">
          {chosen.name} has a live subscription. A trial end date closes an
          organization once it passes, whatever the billing says, so this would
          set a date that puts a paying customer into export only. Start one
          here only if that is the intent.
        </p>
      )}
      <FieldError message={error} />
    </div>
  );
}

/**
 * The one figure on the page an operator scans for, so it is the one thing set
 * larger than the rest of the row.
 *
 * A suspended organization gets the muted tone whatever its number says. A
 * green "24 days left" beside a closed organization is the reading this view
 * exists to prevent.
 */
function Remaining({ days, muted }: { days: number | null; muted: boolean }) {
  if (days === null) {
    return <span className="text-[13px] text-cream-100/40">Not on a clock</span>;
  }
  if (days <= 0) {
    const ago = Math.abs(days);
    return (
      <div>
        <div className="text-[15px] font-semibold text-rose-200">Ended</div>
        <div className="text-[11px] text-cream-100/50">
          {ago === 0 ? 'today' : `${ago} day${ago === 1 ? '' : 's'} ago`}
        </div>
      </div>
    );
  }
  const tone = muted
    ? 'text-cream-100/45'
    : days <= 7
      ? 'text-amber-200'
      : 'text-emerald-200';
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-xl font-semibold tabular-nums ${tone}`}>
        {days}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-cream-100/45">
        {days === 1 ? 'day left' : 'days left'}
      </span>
    </div>
  );
}

function StateBadge({ state }: { state: TrialFirmView['state'] }) {
  return state === 'active' ? (
    <span className="badge text-[10px] tracking-wider bg-emerald-950/40 text-emerald-100 border border-emerald-400/30">
      Open
    </span>
  ) : (
    <span className="badge text-[10px] tracking-wider bg-rose-950/40 text-rose-100 border border-rose-400/30">
      Export only
    </span>
  );
}

/**
 * One control group. The accent is the only thing separating extend from
 * restart at a glance, so it carries real meaning here rather than decoration:
 * neutral for the routine levers, amber for the one that discards a stored
 * date, rose for the one that closes an account.
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
      className={`flex flex-col gap-2 rounded-lg border border-forest-700/50 border-l-2 bg-forest-900/40 p-3 ${edge}`}
    >
      <h4 className="text-[12px] font-semibold uppercase tracking-wider text-cream-100/75">
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
        className="text-[11px] uppercase tracking-wider text-cream-100/50"
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
 * `empty:hidden` keeps it out of the layout until it has something to say, and
 * a hidden element is not a flex item, so it does not open a gap either.
 *
 * aria-live alone, with no role. role="status" IS a live region with an
 * implicit polite setting, so naming both was one thing said twice.
 */
function FieldError({ message }: { message: string | null }) {
  return (
    <p
      aria-live="polite"
      className="text-[11px] text-rose-200 leading-snug empty:hidden"
    >
      {message}
    </p>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-cream-100/55">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-top">{children}</td>;
}
