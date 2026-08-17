'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  updateFirmMatterPrefixAction,
  updateFirmRequestPrefixAction,
  updateFirmSurfaceOverrideAction,
  updateFirmSurfaceSettingsAction,
  updateFirmTypeAction,
  updateFirmTicketPrefixAction,
} from '@/lib/firm-settings-actions';
import { FIRM_TYPES, FIRM_TYPE_DESCRIPTION, FIRM_TYPE_LABEL, type FirmType } from '@/lib/firm-types';
import type { SurfaceSource, WorkspaceSurface } from '@/lib/firm-workspace';
import { T, useT } from '@/components/i18n/LocaleProvider';

type SurfaceChoice = 'default' | 'show' | 'hide';

/** The stored answer, turned back into the control's three states. */
function choiceFor(source: SurfaceSource, hidden: boolean): SurfaceChoice {
  if (source !== 'override') return 'default';
  return hidden ? 'hide' : 'show';
}

/**
 * Owner/admin controls for the shape of the workspace: what kind of legal team
 * this is, and which surfaces that team has.
 *
 * The type sets the DEFAULTS. Each surface then has three states rather than a
 * checkbox, because "hidden" and "hidden because that is the default for an
 * in-house team" are different facts and an owner has to be able to tell them
 * apart before deciding whether to change anything.
 *
 * Saves immediately on change (optimistic) and refreshes so the rail, the
 * search box and the vocabulary reflect the choice without a manual reload.
 */
export function FirmSurfaceToggles({
  firmId,
  initial,
}: {
  firmId: string;
  initial: {
    hideSearch: boolean;
    firmType: FirmType;
    hideTimeBilling: boolean;
    hideGrowth: boolean;
    source: Record<WorkspaceSurface, SurfaceSource>;
    ticketPrefix: string;
    requestPrefix: string;
    matterPrefix: string;
  };
}) {
  const t = useT();
  const router = useRouter();
  const [hideSearch, setHideSearch] = useState(initial.hideSearch);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function save(next: { hideSearch: boolean }) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await updateFirmSurfaceSettingsAction(firmId, next);
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        // Roll back the optimistic UI on failure.
        setHideSearch(initial.hideSearch);
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  return (
    /* No card: the settings page wraps this in a PanelCard. */
    <div className="space-y-4">
      <FirmTypeField firmId={firmId} initial={initial.firmType} />
      <SurfaceChoiceField
        firmId={firmId}
        surface="timeBilling"
        firmType={initial.firmType}
        hidden={initial.hideTimeBilling}
        source={initial.source.timeBilling}
        title={<T>Time, billing and trust</T>}
        description={
          <T>
            Time entries, invoices and the trust ledger. A legal team that does
            not invoice anyone has no use for these.
          </T>
        }
      />
      <SurfaceChoiceField
        firmId={firmId}
        surface="growth"
        firmType={initial.firmType}
        hidden={initial.hideGrowth}
        source={initial.source.growth}
        title={<T>Leads and referrals</T>}
        description={
          <T>
            Inbound work from the Advottic directory, and co-counsel referrals
            with fee splits.
          </T>
        }
      />
      <Toggle
        checked={hideSearch}
        disabled={pending}
        onChange={(v) => {
          setHideSearch(v);
          save({ hideSearch: v });
        }}
        title={<T>Hide the global search</T>}
        description={
          <T>
            Removes the Ask Advottic search box from the top of every
            Counsel page for everyone in your workspace.
          </T>
        }
      />
      <PrefixField
        fieldId="ticket-prefix"
        initial={initial.ticketPrefix}
        save={(next) => updateFirmTicketPrefixAction(firmId, next)}
        label={<T>Ticket number prefix</T>}
        description={
          <T>
            The letters in front of every ticket number. Changing it does not
            renumber anything already filed.
          </T>
        }
        example={<T>Documents will be numbered</T>}
      />
      <PrefixField
        fieldId="request-prefix"
        initial={initial.requestPrefix}
        save={(next) => updateFirmRequestPrefixAction(firmId, next)}
        label={<T>Request reference prefix</T>}
        description={
          <T>
            The letters in front of every legal request reference, the one your
            colleagues quote when they ask about a request. Changing it does not
            change a reference already issued.
          </T>
        }
        example={<T>New requests will be numbered</T>}
      />
      <PrefixField
        fieldId="matter-prefix"
        initial={initial.matterPrefix}
        save={(next) => updateFirmMatterPrefixAction(firmId, next)}
        label={<T>Matter reference prefix</T>}
        description={
          <T>
            The letters in front of every matter reference, the one your firm
            quotes on the phone and in a filing. Changing it does not renumber
            a matter that is already open.
          </T>
        }
        example={<T>New matters will be numbered</T>}
      />
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
      {ok && !error && (
        <p className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
          <T>Saved.</T>
        </p>
      )}
    </div>
  );
}

/**
 * What kind of legal team this is.
 *
 * It was asked once, at onboarding, and then never again, so a workspace that
 * was set up wrong stayed wrong. Changing it here re-derives the defaults and
 * the vocabulary across the whole workspace on the next render.
 */
function FirmTypeField({
  firmId,
  initial,
}: {
  firmId: string;
  initial: FirmType;
}) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState<FirmType>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function commit(next: FirmType) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await updateFirmTypeAction(firmId, next);
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        setValue(previous);
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  return (
    <div className="rounded-lg ring-1 ring-edge p-3.5">
      <label
        htmlFor="firm-type"
        className="block text-sm font-medium text-foreground"
      >
        <T>What kind of legal team this is</T>
      </label>
      <p className="mt-0.5 text-[12px] text-muted leading-relaxed">
        <T>
          This sets the starting point for which surfaces your workspace has and
          what things are called. Every one of them can be changed below.
          Changing the type never removes anything you have filed.
        </T>
      </p>
      <select
        id="firm-type"
        value={value}
        disabled={pending}
        onChange={(e) => commit(e.target.value as FirmType)}
        className="mt-2 w-full max-w-sm rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-foreground"
      >
        {FIRM_TYPES.map((ft) => (
          <option key={ft} value={ft}>
            {t(FIRM_TYPE_LABEL[ft])}
          </option>
        ))}
      </select>
      <p className="mt-2 max-w-xl text-[12px] text-muted leading-relaxed">
        {t(FIRM_TYPE_DESCRIPTION[value])}
      </p>
      {error && (
        <p className="mt-2 text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
      {ok && !error && (
        <p className="mt-2 text-[12.5px] text-emerald-700 dark:text-emerald-300">
          <T>Saved.</T>
        </p>
      )}
    </div>
  );
}

/**
 * One surface group, in three states.
 *
 * Not a checkbox, deliberately. A checkbox can say hidden or shown; it cannot
 * say WHY, and the why is the whole point of deriving a default from the type.
 * An owner needs to see "hidden, because that is the default for an in-house
 * team" and be able to answer "no, we do bill some matters" without that
 * answer being lost the next time the default changes.
 */
function SurfaceChoiceField({
  firmId,
  surface,
  firmType,
  hidden,
  source,
  title,
  description,
}: {
  firmId: string;
  surface: WorkspaceSurface;
  firmType: FirmType;
  hidden: boolean;
  source: SurfaceSource;
  title: React.ReactNode;
  description: React.ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState<SurfaceChoice>(choiceFor(source, hidden));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fieldId = `surface-${surface}`;

  function commit(next: SurfaceChoice) {
    if (next === value) return;
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const res = await updateFirmSurfaceOverrideAction(firmId, surface, next);
      if (res.ok) router.refresh();
      else {
        setValue(previous);
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  // The default for THIS type, stated plainly, so the "Workspace default"
  // option is not a choice made blind.
  const defaultIsHidden = firmType === 'corporate' || firmType === 'government';

  return (
    <div className="rounded-lg ring-1 ring-edge p-3.5">
      <label htmlFor={fieldId} className="block text-sm font-medium text-foreground">
        {title}
      </label>
      <p className="mt-0.5 text-[12px] text-muted leading-relaxed">{description}</p>
      <select
        id={fieldId}
        value={value}
        disabled={pending}
        onChange={(e) => commit(e.target.value as SurfaceChoice)}
        className="mt-2 w-full max-w-sm rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm text-foreground"
      >
        <option value="default">
          {defaultIsHidden
            ? t('Workspace default (hidden)')
            : t('Workspace default (shown)')}
        </option>
        <option value="show">{t('Always show')}</option>
        <option value="hide">{t('Always hide')}</option>
      </select>
      <p className="mt-2 text-[12px] text-muted leading-relaxed">
        {source === 'override' ? (
          <T>You set this yourself, so it stays whatever the workspace type is.</T>
        ) : source === 'legacy' ? (
          <T>
            Currently hidden by the older Time &amp; Billing switch. Choose the
            workspace default or Always show to clear it.
          </T>
        ) : hidden ? (
          <T>Hidden, because that is the default for this kind of legal team.</T>
        ) : (
          <T>Shown, because that is the default for this kind of legal team.</T>
        )}
      </p>
      <p className="mt-1 text-[12px] text-muted leading-relaxed">
        <T>
          Hiding a surface hides it and refuses its pages. It does not delete
          anything already filed there, and showing it again brings all of it
          back.
        </T>
      </p>
      {error && (
        <p className="mt-2 text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  );
}

/**
 * A per-firm reference prefix: the letters in front of a series of numbers.
 *
 * One component for both series (tickets and matters) rather than two nearly
 * identical ones, because they differ only in their words and in which action
 * they save through. The label, the description and the example line are
 * passed in already wrapped in <T> so each stays a literal string the counsel
 * i18n pass can see.
 *
 * Saved on blur rather than on every keystroke, because this is a value the
 * firm types rather than a switch they flip, and a save per character would
 * store half-typed prefixes. The server normalises what it stores and hands
 * the stored form back, so the field then shows what will actually appear on
 * documents rather than what was typed.
 */
function PrefixField({
  fieldId,
  initial,
  save,
  label,
  description,
  example,
}: {
  fieldId: string;
  initial: string;
  save: (next: string) => Promise<{ ok: boolean; error?: string; prefix?: string }>;
  label: React.ReactNode;
  description: React.ReactNode;
  example: React.ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState<string>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function commit() {
    const next = value.trim();
    if (next === saved) return;
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await save(next);
      if (res.ok) {
        setValue(res.prefix ?? next);
        setSaved(res.prefix ?? next);
        setOk(true);
        router.refresh();
      } else {
        setValue(saved);
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  return (
    <div className="rounded-lg ring-1 ring-edge p-3.5">
      <label htmlFor={fieldId} className="block text-sm font-medium text-foreground">
        {label}
      </label>
      <p className="mt-0.5 text-[12px] text-muted leading-relaxed">{description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input
          id={fieldId}
          type="text"
          value={value}
          disabled={pending}
          maxLength={8}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          onBlur={commit}
          className="w-32 rounded-lg border border-edge bg-surface px-3 py-1.5 text-sm font-mono uppercase text-foreground"
        />
        <span className="text-[12px] text-muted">
          {example}{' '}
          <span className="font-mono" data-no-translate>
            {`${(value.trim() || saved).toUpperCase()}-0000001`}
          </span>
        </span>
      </div>
      {error && (
        <p className="mt-2 text-[12.5px] text-rose-700 dark:text-rose-300">{error}</p>
      )}
      {ok && !error && (
        <p className="mt-2 text-[12.5px] text-emerald-700 dark:text-emerald-300">
          <T>Saved.</T>
        </p>
      )}
    </div>
  );
}

function Toggle({
  checked,
  disabled,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg ring-1 ring-edge p-3.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-none accent-gold-500"
      />
      <span>
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="block text-[12px] text-muted mt-0.5 leading-relaxed">
          {description}
        </span>
      </span>
    </label>
  );
}
