'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { setIntakeWorkflowAction, setIntakeReminderAction } from '@/lib/firm-actions';
import { assignIntakeAction } from '@/lib/intake-conversation';
import type { IntakePerson } from '@/lib/intake-conversation-types';
import {
  INTAKE_WORKFLOW_STATES,
  INTAKE_PRIORITIES,
  WORKFLOW_LABEL,
  workflowColor,
  type IntakeWorkflowState,
} from '@/lib/intake-workflow';
import { pillInk } from '@/lib/pill-colors';
import { formatDateTimeNumeric } from '@/lib/format';

/**
 * How the legal team runs this ticket: the state it is in, who has it, how
 * urgent it is, and the three dates an in-house team works to.
 *
 * WHY IT IS IN THE MIDDLE and not in the rail with the rest of the firm's
 * operations. A conflict check is something the firm DOES about a request; a
 * status is what the request IS. Both sides of the screen refer to it, the
 * employee is shown a collapsed version of the same fact, and it is the first
 * thing anybody opening this page needs to know. So it heads the record rather
 * than sitting beside it.
 *
 * SAVING. The three selects save on change, because an operated surface should
 * not make somebody find a Save button for a field they have already set. The
 * two dates save on blur, once the whole value is typed rather than on each
 * keystroke of a partial year.
 *
 * The reminder is the exception and keeps an explicit control. It is the only
 * field here that sends something: the deadlines cron notifies the requester,
 * the legal team and the owner when it comes due. A date field that silently
 * emails a person the moment focus leaves it is a surprise, so setting one is
 * a decision somebody makes on purpose.
 */

/** One labelled field, at the density this screen is scanned at. */
function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

const CONTROL =
  'w-full rounded-lg border border-edge bg-surface-2 px-2.5 py-1.5 text-[13px] text-foreground transition-colors focus:border-edge-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/40 disabled:opacity-50';

export function TicketManagement({
  firmId,
  intakeId,
  state,
  assignee,
  people,
  priority,
  followUpOn,
  dueOn,
  reminderAt,
}: {
  firmId: string;
  intakeId: string;
  state: IntakeWorkflowState;
  assignee: IntakePerson | null;
  /** Everyone on the request. Only the legal side can be given it. */
  people: IntakePerson[];
  priority: string;
  /** yyyy-mm-dd, or '' when unset. */
  followUpOn: string;
  dueOn: string;
  /** ISO, or '' when unset. */
  reminderAt: string;
}) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [followUp, setFollowUp] = useState(followUpOn);
  const [due, setDue] = useState(dueOn);

  // ISO to the value <input type="datetime-local"> wants: local, no seconds.
  const toLocal = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
      d.getHours(),
    )}:${pad(d.getMinutes())}`;
  };
  const [when, setWhen] = useState(toLocal(reminderAt));

  const legal = people.filter((p) => p.side === 'legal');
  const tone = workflowColor(state);

  function save(
    fields: Parameters<typeof setIntakeWorkflowAction>[2],
    note: string,
  ) {
    setError(null);
    setSaved(null);
    start(async () => {
      const res = await setIntakeWorkflowAction(firmId, intakeId, fields);
      if (res.ok) {
        setSaved(note);
        router.refresh();
      } else {
        setError(res.error ?? t('That could not be saved.'));
      }
    });
  }

  function saveReminder(clear: boolean) {
    setError(null);
    setSaved(null);
    let iso = '';
    if (!clear) {
      const d = new Date(when);
      if (!when || Number.isNaN(d.getTime())) {
        setError(t('Pick a date and time for the reminder.'));
        return;
      }
      iso = d.toISOString();
    }
    start(async () => {
      const res = await setIntakeReminderAction(firmId, intakeId, iso);
      if (res.ok) {
        setSaved(clear ? t('Reminder cleared.') : t('Reminder set.'));
        if (clear) setWhen('');
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save the reminder.'));
      }
    });
  }

  return (
    /* The left edge carries the state's semantic colour. It is the one thing
       on this screen readable from the corner of the eye, it encodes something
       true rather than decorating, and it is deliberately NOT the accent:
       docs/DESIGN.md keeps good, warning and critical as their own hues so an
       alert never has to compete with gold. */
    <section
      className="card overflow-hidden border-l-2"
      style={{ borderLeftColor: pillInk(tone) }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
          <T>Ticket management</T>
        </h2>
        <span className="text-[11.5px] text-muted">
          {pending ? (
            <T>Saving</T>
          ) : error ? (
            <span className="text-danger-text" data-no-translate>
              {error}
            </span>
          ) : saved ? (
            <span data-no-translate>{saved}</span>
          ) : null}
        </span>
      </div>

      <div className="grid gap-x-4 gap-y-3.5 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={<T>Status</T>}>
          <select
            className={CONTROL}
            value={state}
            disabled={pending}
            onChange={(e) =>
              save({ workflowState: e.target.value }, t('Status saved.'))
            }
          >
            {INTAKE_WORKFLOW_STATES.map((s) => (
              <option key={s} value={s}>
                {t(WORKFLOW_LABEL[s])}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={<T>Assigned to</T>}
          hint={legal.length === 0 ? <T>Nobody on the legal team yet</T> : undefined}
        >
          <select
            className={CONTROL}
            value={assignee?.userId ?? ''}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              setError(null);
              setSaved(null);
              start(async () => {
                const res = await assignIntakeAction(intakeId, v || null);
                if (res.ok) {
                  setSaved(t('Assignee saved.'));
                  router.refresh();
                } else {
                  setError(res.error ?? t('That could not be saved.'));
                }
              });
            }}
          >
            <option value="">{t('Unassigned')}</option>
            {legal.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={<T>Priority</T>}>
          <select
            className={CONTROL}
            value={INTAKE_PRIORITIES.includes(priority as never) ? priority : ''}
            disabled={pending}
            onChange={(e) => save({ priority: e.target.value }, t('Priority saved.'))}
          >
            <option value="">{t('Not set')}</option>
            {INTAKE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(p)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={<T>Due</T>} hint={<T>What the team committed to</T>}>
          <input
            type="date"
            className={CONTROL}
            value={due}
            disabled={pending}
            onChange={(e) => setDue(e.target.value)}
            onBlur={() => due !== dueOn && save({ dueOn: due }, t('Due date saved.'))}
          />
        </Field>

        <Field label={<T>Follow up</T>} hint={<T>When to look at this again</T>}>
          <input
            type="date"
            className={CONTROL}
            value={followUp}
            disabled={pending}
            onChange={(e) => setFollowUp(e.target.value)}
            onBlur={() =>
              followUp !== followUpOn &&
              save({ followUpOn: followUp }, t('Follow-up date saved.'))
            }
          />
        </Field>

        <Field
          label={<T>Reminder</T>}
          hint={
            reminderAt ? (
              <span data-no-translate>{formatDateTimeNumeric(reminderAt)}</span>
            ) : (
              <T>Notifies you, the team and the requester</T>
            )
          }
        >
          {/* WRAPS, and that is not a detail. A datetime-local has a wide
              intrinsic minimum, and on one row beside two buttons it ran 106px
              past its column: the card clips, so the Set button was invisible
              and the reminder could not be set at all. Every test was green.
              The input takes the full line and the buttons fall below it. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="datetime-local"
              className={`${CONTROL} min-w-0`}
              value={when}
              disabled={pending}
              onChange={(e) => setWhen(e.target.value)}
            />
            <button
              type="button"
              onClick={() => saveReminder(false)}
              disabled={pending}
              className="btn-secondary shrink-0 !px-2.5 !py-1.5 text-[12px]"
            >
              {reminderAt ? <T>Update</T> : <T>Set</T>}
            </button>
            {reminderAt && (
              <button
                type="button"
                onClick={() => saveReminder(true)}
                disabled={pending}
                className="shrink-0 text-[12px] text-muted underline hover:text-foreground"
              >
                <T>Clear</T>
              </button>
            )}
          </div>
        </Field>
      </div>
    </section>
  );
}
