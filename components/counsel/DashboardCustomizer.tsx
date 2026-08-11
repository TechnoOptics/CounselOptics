'use client';

import { useState, useTransition } from 'react';
import { Dialog } from '@/components/Dialog';
import {
  COUNSEL_METRIC_GROUPS,
  COUNSEL_TILES,
  COUNSEL_TILE_CATEGORIES,
  DEFAULT_ENABLED_TILES,
  mergeHiddenMetrics,
  type CounselMetricMeta,
  type CounselTileId,
} from '@/lib/counsel-dashboard';
import { updateCounselDashboardPreferencesAction } from '@/lib/dashboard-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * "Choose what you see" - the dashboard's own control over its contents.
 *
 * IT IS NAMED FOR WHAT IT DOES NOW, WHICH IS NOT WHAT IT USED TO DO. The
 * button said "Customize dashboard" and opened a dialog that could reorder
 * page sections and could not switch off a single number:
 *
 *   "When you click on configure dashboard, that's supposed to configure
 *    the tiles on the dashboard, not the list menu items. That part is
 *    wrong. You should be able to choose the metric items you would like to
 *    view and those you would like to hide."
 *
 * The thing a person points at and calls a tile is a FIGURE. So figures come
 * first here and are the dialog's headline job, grouped exactly as the
 * dashboard groups them and under the same band names. The old promise was
 * the honest problem: "Customize dashboard" is what the whole dashboard's
 * control should be called, and it was attached to a control over one
 * quarter of it.
 *
 * PANELS ARE STILL HERE, second. Rearranging the blocks under the figures is
 * a real thing people use, and deleting a working capability to make room
 * for a new one is not a fix. It is below the figures, under its own
 * heading, so the ordering answers "which of these did you mean?" before the
 * reader has to.
 *
 * WHAT IT IS ALLOWED TO OFFER IS DECIDED ON THE SERVER. The page passes the
 * figures and panels this viewer's role and workspace can actually show, so
 * this component never has to know that `staff` cannot read matters or that
 * an in-house team has no billing page. What it does have to know is that
 * its answer is PARTIAL: mergeHiddenMetrics carries a choice it could not
 * offer back into the payload, so switching billing off for a month does not
 * quietly un-hide a figure somebody hid.
 *
 * Reorder is up / down arrows rather than drag-and-drop, on purpose - it
 * works on touch, with a keyboard, and with a screen reader, and adds no
 * dependency.
 */
export function DashboardCustomizer({
  initialEnabled,
  initialHiddenMetrics,
  metrics,
  offerablePanels,
}: {
  /** The user's saved panel list, RAW - including any this viewer is not
   *  offered, which stay in state and are saved back untouched. */
  initialEnabled: CounselTileId[];
  /** The user's saved hidden figures, raw, for the same reason. */
  initialHiddenMetrics: string[];
  /** The figures this viewer can be offered, in dashboard order. */
  metrics: CounselMetricMeta[];
  /** The panel ids this viewer can be offered. */
  offerablePanels: string[];
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<CounselTileId[]>(initialEnabled);
  const [hidden, setHidden] = useState<string[]>(initialHiddenMetrics);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const offerable = new Set(offerablePanels);
  const visibleCatalog = COUNSEL_TILES.filter((tile) => offerable.has(tile.id));
  const enabledSet = new Set(enabled);
  const hiddenSet = new Set(hidden);
  const shownMetrics = metrics.length - metrics.filter((m) => hiddenSet.has(m.id)).length;

  function toggleMetric(id: string) {
    setHidden((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function togglePanel(id: CounselTileId) {
    setEnabled((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function move(id: CounselTileId, direction: -1 | 1) {
    setEnabled((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + direction;
      if (target < 0 || target >= next.length) return next;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next;
    });
  }

  function reset() {
    setEnabled([...DEFAULT_ENABLED_TILES]);
    setHidden([]);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateCounselDashboardPreferencesAction({
        enabled,
        // Only an answer for the figures this dialog actually drew. What it
        // could not offer is carried through rather than forgotten.
        hiddenMetrics: mergeHiddenMetrics(
          initialHiddenMetrics,
          metrics.map((m) => m.id),
          hidden,
        ),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-forest-700/40 bg-forest-900/40 px-3 py-1.5 text-[12.5px] text-cream-100/80 transition-colors hover:bg-forest-800/60 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <SlidersIcon />
        <T>Choose what you see</T>
      </button>

      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          ariaLabel={t('Choose what you see')}
          size="md"
        >
          <div className="p-4">
            <div className="flex items-start justify-between gap-3 border-b border-forest-700/40 pb-3">
              <div>
                <p className="text-base font-medium text-cream-100">
                  <T>Choose what you see</T>
                </p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-cream-100/60">
                  <T>
                    Switch off any figure you do not want, then pick the
                    panels underneath them. Welcome and Ask Advottic always
                    stay at the top.
                  </T>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="-m-1 rounded p-1 leading-none text-cream-100/55 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
                aria-label={t('Close')}
              >
                <CloseIcon />
              </button>
            </div>

            {/* ---- Figures. First, because this is what the control is for. */}
            <section className="mt-4" aria-labelledby="dash-figures">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3
                  id="dash-figures"
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-text"
                >
                  <T>Figures</T>
                </h3>
                <p className="text-[11px] text-cream-100/55">
                  {shownMetrics} <T>of</T> {metrics.length} <T>shown</T>
                </p>
              </div>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-cream-100/60">
                <T>
                  The numbers across the top of your dashboard and on the
                  board below them.
                </T>
              </p>

              <div className="mt-2.5 space-y-3">
                {COUNSEL_METRIC_GROUPS.map((group) => {
                  const items = metrics.filter((m) => m.group === group.id);
                  if (items.length === 0) return null;
                  return (
                    <div key={group.id}>
                      <GroupHeading label={group.label} blurb={group.blurb} />
                      <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                        {items.map((m) => (
                          <li key={m.id}>
                            <ChoiceRow
                              label={m.label}
                              on={!hiddenSet.has(m.id)}
                              onToggle={() => toggleMetric(m.id)}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <div className="mt-2 flex items-center gap-3">
                <BareButton
                  label="Show every figure"
                  onClick={() => setHidden([])}
                />
                <BareButton
                  label="Hide every figure"
                  onClick={() => setHidden(metrics.map((m) => m.id))}
                />
              </div>
            </section>

            {/* ---- Panels. Second, and still fully here. */}
            <section
              className="mt-5 border-t border-forest-700/40 pt-4"
              aria-labelledby="dash-panels"
            >
              <h3
                id="dash-panels"
                className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent-text"
              >
                <T>Panels</T>
              </h3>
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-cream-100/60">
                <T>
                  The cards below the figures. Add the ones you use and put
                  them in the order you want.
                </T>
              </p>

              {enabled.length > 0 ? (
                <div className="mt-2.5">
                  <p className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-cream-100/60">
                    <T>On your dashboard</T> ({enabled.length})
                  </p>
                  <ul className="space-y-1">
                    {enabled.map((id, i) => {
                      const meta = visibleCatalog.find((x) => x.id === id);
                      if (!meta) return null;
                      // Bound to its own name so the wrap reads `label`,
                      // which is the reviewed static form on the counsel
                      // i18n allowlist. Every value is a catalog literal.
                      const label = meta.label;
                      return (
                        <li
                          key={id}
                          className="flex items-center gap-2 rounded-md bg-forest-900/40 px-2 py-1.5 ring-1 ring-forest-700/40"
                        >
                          <span className="flex-1 text-[13px] text-cream-100">
                            <T>{label}</T>
                          </span>
                          <IconButton
                            onClick={() => move(id, -1)}
                            disabled={i === 0}
                            label={`${t('Move up')}: ${t(label)}`}
                          >
                            <UpIcon />
                          </IconButton>
                          <IconButton
                            onClick={() => move(id, 1)}
                            disabled={i === enabled.length - 1}
                            label={`${t('Move down')}: ${t(label)}`}
                          >
                            <DownIcon />
                          </IconButton>
                          <button
                            type="button"
                            onClick={() => togglePanel(id)}
                            className="rounded px-1.5 text-[11px] text-danger-text focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
                            aria-label={`${t('Remove')}: ${t(label)}`}
                          >
                            <T>Remove</T>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="mt-2.5 text-[12px] text-cream-100/55">
                  <T>
                    No panels chosen. Your figures and Ask Advottic still
                    show.
                  </T>
                </p>
              )}

              <div className="mt-3 space-y-3">
                {COUNSEL_TILE_CATEGORIES.map((cat) => {
                  const items = visibleCatalog.filter(
                    (x) => x.category === cat.id,
                  );
                  if (items.length === 0) return null;
                  return (
                    <div key={cat.id}>
                      <GroupHeading label={cat.label} blurb={cat.description} />
                      <ul className="mt-1.5 space-y-1">
                        {items.map((tile) => (
                          <li key={tile.id}>
                            <ChoiceRow
                              label={tile.label}
                              description={tile.description}
                              on={enabledSet.has(tile.id)}
                              onToggle={() => togglePanel(tile.id)}
                            />
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>

            {error && (
              <p className="mt-3 text-[12px] text-danger-text">{error}</p>
            )}

            <div className="mt-4 flex items-center justify-between gap-2 border-t border-forest-700/40 pt-3">
              <BareButton label="Reset to defaults" onClick={reset} />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className="rounded-md px-3 py-1.5 text-[12.5px] text-cream-100/70 transition-colors hover:bg-cream-100/5 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
                >
                  <T>Cancel</T>
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="btn-primary px-3 py-1.5 text-[12.5px] focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 disabled:opacity-50"
                >
                  {pending ? <T>Saving...</T> : <T>Save</T>}
                </button>
              </div>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * One switch. The same row for a figure and for a panel, because they are
 * the same decision - the only difference is that a panel carries a line of
 * description and a figure's name is the whole of it.
 *
 * `aria-pressed` rather than a checkbox input so the whole row is the target
 * (44px at 375px) without a label-for dance, and the pressed state is what a
 * screen reader announces.
 */
function ChoiceRow({
  label,
  description,
  on,
  onToggle,
}: {
  label: string;
  description?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
        on ? 'bg-gold-500/10 ring-1 ring-gold-500/30' : 'hover:bg-cream-100/5'
      }`}
    >
      <span
        className={`mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded border ${
          on
            ? 'border-gold-400 bg-gold-400 text-forest-950'
            : 'border-cream-100/40'
        }`}
        aria-hidden
      >
        {on ? <CheckIcon /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] text-cream-100">
          <T>{label}</T>
        </span>
        {description ? (
          <span className="block text-[11px] leading-snug text-cream-100/55">
            <T>{description}</T>
          </span>
        ) : null}
      </span>
    </button>
  );
}

function GroupHeading({ label, blurb }: { label: string; blurb: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cream-100/55">
        <T>{label}</T>
      </p>
      <p className="text-[11px] text-cream-100/60">
        <T>{blurb}</T>
      </p>
    </div>
  );
}

function BareButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded text-[12px] text-cream-100/55 underline underline-offset-2 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
    >
      <T>{label}</T>
    </button>
  );
}

function IconButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded px-1 text-cream-100/50 hover:text-cream-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 disabled:opacity-30"
      aria-label={label}
    >
      {children}
    </button>
  );
}

/**
 * Sliders, not a pencil. A pencil says "edit the thing you are looking at";
 * this control chooses which things there are.
 */
function SlidersIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}
function UpIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 15l6-6 6 6" />
    </svg>
  );
}
function DownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}
