'use client';

import { useState, useTransition } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { isNativeApp } from '@/lib/platform';
import {
  createFirmApproach,
  regenerateFirmApproach,
  updateFirmApproach,
  deleteFirmApproach,
  type Approach,
} from '@/lib/firm-approach-actions';
import type { ApproachArgument } from '@/lib/approach-ai';

/**
 * Case Theory Console — the firm "prove-the-case" approach board, styled as a
 * premium investigative terminal. The lawyer opens an APPROACH VECTOR: the
 * theory they mean to prove, who is connected, and anything relevant. Advottic
 * marshals the matter's own evidence into a structured argument with cited
 * exhibits and a supporting timeline, saved as "Approach 01/02/03", editable
 * and re-runnable.
 *
 * AI-gated + graceful: the approach is always saved; when analysis is
 * unavailable the dossier shows a calm "awaiting analysis" state and a re-run
 * control, never a raw error. Pure presentation change over the existing
 * actions — no behavioural wiring changed.
 */

const AI_UNAVAILABLE = "Advottic's analysis is temporarily unavailable. Please try again shortly.";
function isUnavailable(msg: string | null | undefined): boolean {
  return !!msg && (msg === AI_UNAVAILABLE || /temporarily unavailable|add credits/i.test(msg));
}

/** Zero-padded dossier index: 1 -> "01". */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function ApproachBuilder({
  firmId,
  caseId,
  initial,
}: {
  firmId: string;
  caseId: string;
  initial: Approach[];
}) {
  const t = useT();
  const [approaches, setApproaches] = useState<Approach[]>(initial);
  const [open, setOpen] = useState(initial.length === 0);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [connections, setConnections] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    setNotice(null);
    if (!prompt.trim()) {
      setError(t('Lay out the theory you are setting out to prove.'));
      return;
    }
    startTransition(async () => {
      const res = await createFirmApproach(firmId, caseId, { title, prompt, connections });
      if (res.ok && res.approach) {
        setApproaches((list) => [...list, res.approach!]);
        setTitle('');
        setPrompt('');
        setConnections('');
        setOpen(false);
        if (res.generateError) {
          setNotice(
            isUnavailable(res.generateError)
              ? t('Approach saved. Advottic analysis is temporarily unavailable, add credits to assemble the argument, then re-run.')
              : res.generateError,
          );
        }
      } else {
        setError(res.error ?? t('Could not save the approach.'));
      }
    });
  }

  const onUpdated = (a: Approach) =>
    setApproaches((list) => list.map((x) => (x.id === a.id ? a : x)));
  const onRemoved = (id: string) =>
    setApproaches((list) => list.filter((x) => x.id !== id));

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-gold-metal/25 bg-forest-950 text-cream-100 shadow-[0_0_0_1px_rgba(198,161,91,0.04),0_24px_60px_-30px_rgba(0,0,0,0.8)]"
      style={{
        backgroundImage:
          'radial-gradient(120% 90% at 82% -10%, rgba(198,161,91,0.10), transparent 55%), linear-gradient(0deg, rgba(10,26,20,0.6), rgba(6,18,14,0.6))',
      }}
    >
      {/* Faint console grid + top scan line */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(198,161,91,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(198,161,91,0.05) 1px, transparent 1px)',
          backgroundSize: '38px 38px',
          maskImage: 'linear-gradient(180deg, black, transparent 70%)',
          WebkitMaskImage: 'linear-gradient(180deg, black, transparent 70%)',
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-metal/60 to-transparent" />

      <div className="relative p-5 sm:p-6 space-y-6">
        {/* Console header */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.28em] text-gold-metal/80">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-metal/70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold-metal" />
              </span>
              <T>Case theory console</T>
            </p>
            <h2 className="mt-1.5 font-display text-2xl font-medium tracking-tight text-cream-50">
              <T>Approaches</T>
            </h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-cream-100/60">
              <T>
                Open an approach, lay out the theory you mean to prove, and Advottic
                assembles the matter&apos;s evidence into a cited argument with its own
                supporting timeline. Run several theories side by side.
              </T>
            </p>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-cream-100/40">
            <span>{pad2(approaches.length)} <T>on file</T></span>
            {!open && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="group inline-flex items-center gap-1.5 rounded-md border border-gold-metal/40 bg-gold-metal/10 px-3 py-1.5 text-[11px] font-medium tracking-[0.14em] text-gold-metal transition-all hover:bg-gold-metal/20 hover:shadow-[0_0_18px_-4px_rgba(198,161,91,0.55)]"
              >
                <span className="text-[13px] leading-none">+</span>
                <T>New approach</T>
              </button>
            )}
          </div>
        </header>

        {/* New approach vector */}
        {open && (
          <div className="relative rounded-xl border border-gold-metal/25 bg-forest-900/50 p-4 sm:p-5">
            <CornerTicks />
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.26em] text-gold-metal/70">
              <T>New approach vector</T>
            </p>
            <div className="space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('Codename for this theory (e.g. Constructive eviction)')}
                className="w-full rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2 text-sm text-cream-50 placeholder:text-cream-100/35 outline-none transition-colors focus:border-gold-metal/50 focus:shadow-[0_0_0_3px_rgba(198,161,91,0.10)]"
                data-no-translate
              />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  'The theory you are proving. Example: The landlord knew about the mold for months and failed to act — tie together the inspection report (EX-03), the tenant emails, and the maintenance logs.',
                )}
                rows={4}
                className="w-full resize-y rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2.5 text-sm leading-relaxed text-cream-50 placeholder:text-cream-100/35 outline-none transition-colors focus:border-gold-metal/50 focus:shadow-[0_0_0_3px_rgba(198,161,91,0.10)]"
                data-no-translate
              />
              <div>
                <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold-metal/60">
                  <T>Connected parties</T>
                </p>
                <textarea
                  value={connections}
                  onChange={(e) => setConnections(e.target.value)}
                  placeholder={t(
                    'Who is connected and how — parties, witnesses, roles. Example: Jane Doe (tenant, claimant); Acme Property LLC (landlord, defendant); Bob Smith (building super, saw the leak).',
                  )}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2.5 text-sm leading-relaxed text-cream-50 placeholder:text-cream-100/35 outline-none transition-colors focus:border-gold-metal/50 focus:shadow-[0_0_0_3px_rgba(198,161,91,0.10)]"
                  data-no-translate
                />
              </div>
              {error && (
                <p className="font-mono text-[11.5px] text-rose-300" data-no-translate>
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                {approaches.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setError(null); }}
                    disabled={pending}
                    className="rounded-lg px-3 py-2 text-[13px] text-cream-100/70 hover:text-cream-100"
                  >
                    <T>Cancel</T>
                  </button>
                )}
                <button
                  type="button"
                  onClick={create}
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg border border-gold-metal/50 bg-gold-metal/15 px-4 py-2 text-[13px] font-medium text-gold-metal transition-all hover:bg-gold-metal/25 hover:shadow-[0_0_22px_-6px_rgba(198,161,91,0.7)] disabled:opacity-60"
                >
                  {pending ? (
                    <>
                      <Spinner />
                      <T>Assembling the argument…</T>
                    </>
                  ) : (
                    <T>Assemble the argument</T>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {notice && (
          <p className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            {notice}
          </p>
        )}

        {/* Dossiers */}
        {approaches.length === 0 && !open ? (
          <p className="font-mono text-[12px] italic text-cream-100/45">
            <T>No approaches on file. Open one to begin.</T>
          </p>
        ) : (
          <div className="space-y-4">
            {approaches.map((a, i) => (
              <ApproachCard
                key={a.id}
                index={i + 1}
                firmId={firmId}
                caseId={caseId}
                approach={a}
                onUpdated={onUpdated}
                onRemoved={onRemoved}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ApproachCard({
  index,
  firmId,
  caseId,
  approach,
  onUpdated,
  onRemoved,
}: {
  index: number;
  firmId: string;
  caseId: string;
  approach: Approach;
  onUpdated: (a: Approach) => void;
  onRemoved: (id: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(approach.title);
  const [prompt, setPrompt] = useState(approach.prompt);
  const [connections, setConnections] = useState(approach.connections);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const g = approach.generated;
  const assembled = !!g;

  function rerun(withPrompt?: string) {
    setError(null);
    startTransition(async () => {
      const res = await regenerateFirmApproach(firmId, caseId, approach.id, withPrompt);
      if (res.ok && res.approach) {
        onUpdated(res.approach);
        setEditing(false);
      } else {
        setError(res.error ?? t('Could not re-run.'));
      }
    });
  }

  function saveEdits() {
    setError(null);
    startTransition(async () => {
      const res = await updateFirmApproach(firmId, caseId, approach.id, { title, prompt, connections });
      if (res.ok) {
        onUpdated({ ...approach, title: title.trim(), prompt: prompt.trim(), connections: connections.trim() });
        setEditing(false);
      } else {
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  function remove() {
    if (typeof window !== 'undefined' && !window.confirm(t('Delete this approach? This cannot be undone.'))) return;
    startTransition(async () => {
      const res = await deleteFirmApproach(firmId, caseId, approach.id);
      if (res.ok) onRemoved(approach.id);
      else setError(res.error ?? t('Could not delete.'));
    });
  }

  // Court-ready packet for THIS approach: the assembled argument as the opening
  // narrative, then only the exhibits this approach marshals, embedded. Opens
  // through the in-app browser on native, a new tab on web.
  async function exportPacket() {
    const url = `/counsel/cases/${caseId}/approach/${approach.id}/export`;
    if (isNativeApp()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-cream-50/10 bg-forest-900/40">
      <CornerTicks />
      {/* Left status rail */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[3px] ${assembled ? 'bg-gold-metal' : 'bg-amber-500/60'}`}
        style={assembled ? { boxShadow: '0 0 14px 0 rgba(198,161,91,0.6)' } : undefined}
      />

      <div className="p-4 pl-5 sm:p-5 sm:pl-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-md border border-gold-metal/40 bg-gold-metal/10 px-2 py-1 font-mono text-[11px] font-semibold tracking-[0.12em] text-gold-metal">
              {`A-${pad2(index)}`}
            </span>
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold leading-tight text-cream-50" data-no-translate>
                {approach.title || t('Untitled approach')}
              </h3>
              <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em]">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${assembled ? 'bg-gold-metal' : 'bg-amber-400'}`} />
                <span className={assembled ? 'text-gold-metal/80' : 'text-amber-300/80'}>
                  {assembled ? <T>Argument assembled</T> : <T>Awaiting analysis</T>}
                </span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.12em]">
            {assembled && (
              <button
                type="button"
                onClick={exportPacket}
                disabled={pending}
                className="mr-1 inline-flex items-center gap-1.5 rounded-md border border-gold-metal/50 bg-gold-metal/15 px-2.5 py-1 text-gold-metal transition-all hover:bg-gold-metal/25 hover:shadow-[0_0_16px_-5px_rgba(198,161,91,0.7)] disabled:opacity-50"
              >
                <span aria-hidden className="text-[12px] leading-none">⬇</span>
                <T>Export packet</T>
              </button>
            )}
            <RailButton onClick={() => setEditing((v) => !v)} disabled={pending}>
              {editing ? <T>Cancel</T> : <T>Edit</T>}
            </RailButton>
            <RailButton onClick={() => rerun()} disabled={pending}>
              {pending ? <T>Working…</T> : (assembled ? <T>Re-run</T> : <T>Assemble</T>)}
            </RailButton>
            <RailButton onClick={remove} disabled={pending} tone="danger">
              <T>Delete</T>
            </RailButton>
          </div>
        </div>

        {editing ? (
          <div className="space-y-2 rounded-lg border border-cream-50/10 bg-forest-950/50 p-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2 text-sm text-cream-50 outline-none focus:border-gold-metal/50"
              data-no-translate
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={t('The theory you are proving')}
              className="w-full resize-y rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2.5 text-sm leading-relaxed text-cream-50 outline-none focus:border-gold-metal/50"
              data-no-translate
            />
            <textarea
              value={connections}
              onChange={(e) => setConnections(e.target.value)}
              rows={3}
              placeholder={t('Connected parties — who is involved and how')}
              className="w-full resize-y rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2.5 text-sm leading-relaxed text-cream-50 outline-none focus:border-gold-metal/50"
              data-no-translate
            />
            <div className="flex justify-end gap-2">
              <button onClick={saveEdits} disabled={pending} className="rounded-lg px-3 py-1.5 text-[13px] text-cream-100/75 hover:text-cream-100">
                <T>Save</T>
              </button>
              <button onClick={() => rerun(prompt)} disabled={pending} className="inline-flex items-center gap-2 rounded-lg border border-gold-metal/50 bg-gold-metal/15 px-3 py-1.5 text-[13px] font-medium text-gold-metal hover:bg-gold-metal/25">
                {pending && <Spinner />}
                <T>Save and re-run</T>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <blockquote className="border-l-2 border-gold-metal/40 pl-3 text-[13px] italic leading-relaxed text-cream-100/75" data-no-translate>
              {approach.prompt}
            </blockquote>
            {approach.connections.trim() && (
              <div className="rounded-lg border border-cream-50/10 bg-forest-950/40 px-3 py-2">
                <p className="mb-0.5 font-mono text-[9.5px] uppercase tracking-[0.18em] text-gold-metal/60">
                  <T>Connected parties</T>
                </p>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-cream-100/75" data-no-translate>
                  {approach.connections}
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          isUnavailable(error) ? (
            <p className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
              <T>Advottic analysis is temporarily unavailable. Add credits to run, then re-run this approach.</T>
            </p>
          ) : (
            <p className="font-mono text-[11.5px] text-rose-300" data-no-translate>{error}</p>
          )
        )}

        {g ? (
          <GeneratedArgument g={g} />
        ) : (
          !editing && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/20 bg-amber-500/[0.07] px-4 py-3 text-[12.5px] text-amber-200/90">
              <span aria-hidden className="mt-0.5 text-[14px]">◇</span>
              <T>The argument has not been assembled yet. Add Advottic credits, then Assemble to build it from the evidence on file.</T>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** Console section label with a hairline lead-in. */
function ConsoleLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-gold-metal/70">
      <span aria-hidden className="h-px w-4 bg-gold-metal/40" />
      {children}
    </p>
  );
}

function GeneratedArgument({ g }: { g: ApproachArgument }) {
  return (
    <div className="space-y-5 border-t border-cream-50/10 pt-4">
      {g.thesis && (
        <div>
          <ConsoleLabel><T>Thesis</T></ConsoleLabel>
          <p className="rounded-lg border border-gold-metal/20 bg-gold-metal/[0.06] px-3.5 py-3 text-[14px] font-medium leading-relaxed text-cream-50" data-no-translate>
            {g.thesis}
          </p>
        </div>
      )}

      {g.argument && (
        <div>
          <ConsoleLabel><T>Argument</T></ConsoleLabel>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-cream-100/85" data-no-translate>
            {g.argument}
          </p>
        </div>
      )}

      {g.exhibits.length > 0 && (
        <div>
          <ConsoleLabel><T>Exhibits marshalled</T></ConsoleLabel>
          <ul className="space-y-1.5">
            {g.exhibits.map((e, i) => (
              <li key={i} className="flex gap-2.5 rounded-md bg-forest-950/40 px-2.5 py-1.5 text-[13px]">
                {e.exhibit ? (
                  <span className="h-fit shrink-0 rounded bg-gold-metal px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-forest-950" data-no-translate>
                    {e.exhibit}
                  </span>
                ) : (
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-cream-100/40" />
                )}
                <span className="leading-relaxed text-cream-100/85" data-no-translate>
                  <span className="font-medium text-cream-50">{e.title}</span>
                  {e.why && <span className="text-cream-100/60"> — {e.why}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {g.timeline.length > 0 && <TimelinePanel timeline={g.timeline} />}

      {g.gaps.length > 0 && (
        <div>
          <ConsoleLabel><T>Gaps to close</T></ConsoleLabel>
          <ul className="space-y-1.5 text-[13px] text-cream-100/85">
            {g.gaps.map((gap, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-none rotate-45 bg-amber-400" />
                <span className="leading-relaxed" data-no-translate>{gap}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type ApproachTimelineEntry = ApproachArgument['timeline'][number];

type ParsedWhen = {
  key: string;
  monthLabel: string;
  day: number | null;
  sortMs: number;
  relative: boolean;
};

/**
 * Best-effort parse of an approach timeline entry's free-text `when` ("March
 * 2024", "2024-03-15", "months prior") into a calendar bucket. Parseable dates
 * group by month; a day chip appears only when the text actually carried a day
 * number (so a bare "March 2024" isn't misrendered as the 1st). Anything the
 * model expressed relatively falls into a trailing "relative / undated" bucket.
 * The raw `when` string is always shown verbatim, so this never misstates it.
 */
function parseWhen(when: string | null | undefined): ParsedWhen {
  const raw = (when ?? '').trim();
  const monthOf = (d: Date) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  const relative: ParsedWhen = { key: '~relative', monthLabel: '', day: null, sortMs: Number.POSITIVE_INFINITY, relative: true };
  if (!raw) return relative;

  // Explicit ISO-ish forms are parsed component-wise as LOCAL dates, so an
  // ISO "2024-03-15" isn't rolled back a day by the UTC-midnight/local-read
  // trap, and a bare year isn't mislabelled by it.
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw))) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return { key: `${m[1]}-${m[2]}`, monthLabel: monthOf(d), day: +m[3], sortMs: d.getTime(), relative: false };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(raw))) {
    const d = new Date(+m[1], +m[2] - 1, 1);
    return { key: `${m[1]}-${m[2]}`, monthLabel: monthOf(d), day: null, sortMs: d.getTime(), relative: false };
  }
  if ((m = /^(\d{4})$/.exec(raw))) {
    const d = new Date(+m[1], 0, 1);
    return { key: `${m[1]}-00`, monthLabel: m[1], day: null, sortMs: d.getTime(), relative: false };
  }

  // Worded dates ("March 2024", "March 15, 2024") — let Date parse them (these
  // parse as local, no UTC trap). A day chip only when the text carried a day.
  const ms = new Date(raw).getTime();
  if (!Number.isNaN(ms)) {
    const d = new Date(ms);
    const hasDay = /[A-Za-z]{3,}/.test(raw) && /\b(3[01]|[12]\d|0?[1-9])\b/.test(raw);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      monthLabel: monthOf(d),
      day: hasDay ? d.getDate() : null,
      sortMs: ms,
      relative: false,
    };
  }
  return relative;
}

/**
 * The approach's supporting timeline, as a List (vertical rail) or a Calendar
 * (month-grouped agenda). The calendar is the approach's OWN chronology — only
 * the events Advottic marshalled for this theory — grouped into month blocks in
 * chronological order, with day chips where the date is day-precise.
 */
function TimelinePanel({ timeline }: { timeline: ApproachTimelineEntry[] }) {
  const t = useT();
  const [mode, setMode] = useState<'list' | 'calendar'>('list');

  const months = (() => {
    const groups: { key: string; label: string; relative: boolean; sortMs: number; items: { tl: ApproachTimelineEntry; day: number | null }[] }[] = [];
    const byKey = new Map<string, number>();
    timeline.forEach((tl) => {
      const p = parseWhen(tl.when);
      let gi = byKey.get(p.key);
      if (gi === undefined) {
        gi = groups.length;
        byKey.set(p.key, gi);
        groups.push({ key: p.key, label: p.monthLabel, relative: p.relative, sortMs: p.sortMs, items: [] });
      }
      groups[gi].items.push({ tl, day: p.day });
    });
    return groups.sort((a, b) => a.sortMs - b.sortMs);
  })();

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <ConsoleLabel><T>Supporting timeline</T></ConsoleLabel>
        <div className="inline-flex overflow-hidden rounded-md border border-cream-50/12 font-mono text-[10px] uppercase tracking-[0.14em]">
          {(['list', 'calendar'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`px-2.5 py-1 transition-colors ${
                mode === m
                  ? 'bg-gold-metal/20 text-gold-metal'
                  : 'text-cream-100/55 hover:text-cream-100'
              }`}
            >
              {m === 'list' ? <T>List</T> : <T>Calendar</T>}
            </button>
          ))}
        </div>
      </div>

      {mode === 'list' ? (
        <ol className="relative space-y-3 border-l border-gold-metal/25 pl-4">
          {timeline.map((tl, i) => (
            <li key={i} className="relative">
              <span
                aria-hidden
                className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-forest-900 bg-gold-metal"
                style={{ boxShadow: '0 0 10px 0 rgba(198,161,91,0.55)' }}
              />
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-gold-metal/70" data-no-translate>{tl.when}</p>
              <p className="text-[13.5px] font-medium text-cream-50" data-no-translate>{tl.title}</p>
              {tl.significance && (
                <p className="text-[13px] leading-relaxed text-cream-100/70" data-no-translate>{tl.significance}</p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-3">
          {months.map((mo) => (
            <div key={mo.key} className="rounded-lg border border-cream-50/10 bg-forest-950/40">
              <div className="flex items-center gap-2 border-b border-cream-50/10 px-3 py-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold-metal" />
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-gold-metal/80">
                  {mo.relative ? t('Relative / undated') : mo.label}
                </p>
                <span className="ml-auto font-mono text-[10px] text-cream-100/40">{mo.items.length}</span>
              </div>
              <ul className="divide-y divide-cream-50/[0.06]">
                {mo.items.map(({ tl, day }, i) => (
                  <li key={i} className="flex gap-3 px-3 py-2">
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border font-mono leading-none ${
                        day != null
                          ? 'border-gold-metal/40 bg-gold-metal/10 text-gold-metal'
                          : 'border-cream-50/10 bg-forest-900/40 text-cream-100/40'
                      }`}
                    >
                      {day != null ? (
                        <span className="text-[14px] font-semibold">{day}</span>
                      ) : (
                        <span className="text-[13px]">◇</span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-gold-metal/60" data-no-translate>{tl.when}</p>
                      <p className="text-[13.5px] font-medium text-cream-50" data-no-translate>{tl.title}</p>
                      {tl.significance && (
                        <p className="text-[12.5px] leading-relaxed text-cream-100/70" data-no-translate>{tl.significance}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Decorative corner brackets for the console panels. */
function CornerTicks() {
  const c = 'pointer-events-none absolute h-2.5 w-2.5 border-gold-metal/35';
  return (
    <>
      <span aria-hidden className={`${c} left-1.5 top-1.5 border-l border-t`} />
      <span aria-hidden className={`${c} right-1.5 top-1.5 border-r border-t`} />
      <span aria-hidden className={`${c} bottom-1.5 left-1.5 border-b border-l`} />
      <span aria-hidden className={`${c} bottom-1.5 right-1.5 border-b border-r`} />
    </>
  );
}

function RailButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2 py-1 transition-colors disabled:opacity-50 ${
        tone === 'danger'
          ? 'text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-200'
          : 'text-cream-100/60 hover:bg-cream-50/10 hover:text-cream-50'
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-gold-metal/30 border-t-gold-metal"
    />
  );
}
