import { T } from '@/components/i18n/LocaleProvider';
import type { CaseEvidenceAnalytics, NameCount } from '@/lib/case-analytics';

/* Live evidence analytics for a matter. Server-rendered from
   getCaseEvidenceAnalytics on each (force-dynamic) page load, so it reflects
   the current de-duplicated, freshly-analysed set with no client fetch. Charts
   are hand-rolled SVG/CSS (no chart dependency) in a gold + neutral palette;
   deliberately no green, per the firm-surface rule. */

const GOLD = '#B9922F';
const GOLD_MID = '#D5BB7E';
const GOLD_SOFT = '#E8D9B5';
const NEUTRAL = '#9C968B';

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / 1_000_000;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function yearFrom(iso: string | null): string | null {
  return iso && iso.length >= 4 ? iso.slice(0, 4) : null;
}

function Kpi({ label, value, sub }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-cream-50/70 dark:bg-forest-900/40 border border-ink-100 dark:border-forest-700/40 px-4 py-3.5">
      <div className="text-[12px] font-medium text-ink-500 dark:text-cream-100/55">{label}</div>
      <div className="mt-1 font-display text-[26px] leading-none tracking-[-0.01em] text-forest-900 dark:text-cream-100 tabular-nums">
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-ink-400 dark:text-cream-100/40">{sub}</div> : null}
    </div>
  );
}

function Panel({ title, hint, children }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/70 dark:bg-forest-900/40 border border-ink-100 dark:border-forest-700/40 p-4">
      <div className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">{title}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-ink-400 dark:text-cream-100/40">{hint}</div> : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Horizontal bar list, sequential gold. Values are counts. */
function BarList({ rows, color = GOLD }: { rows: NameCount[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,7.5rem)_1fr_2rem] items-center gap-2">
          <div className="truncate text-[12px] text-forest-800 dark:text-cream-100/80" title={r.name}>
            {r.name}
          </div>
          <div className="h-2.5 rounded-sm bg-ink-100/70 dark:bg-forest-800/60 overflow-hidden">
            <div className="h-full rounded-sm" style={{ width: `${(r.n / max) * 100}%`, backgroundColor: color }} />
          </div>
          <div className="text-right text-[12px] tabular-nums text-ink-500 dark:text-cream-100/60">{r.n}</div>
        </div>
      ))}
    </div>
  );
}

/** A ring gauge for the analyzed share, with segment legend beside it. */
function StatusRing({ a }: { a: CaseEvidenceAnalytics }) {
  const total = Math.max(1, a.total);
  const inProgress = a.status.running + a.status.pending + a.status.skipped;
  const na = a.status.error;
  const segs = [
    { v: a.status.done, c: GOLD },
    { v: inProgress, c: GOLD_SOFT },
    { v: na, c: NEUTRAL },
  ].filter((s) => s.v > 0);
  const r = 42;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 -rotate-90" role="img" aria-label="Analysis status ring">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="11" className="text-ink-100 dark:text-forest-800/70" />
        {segs.map((s, i) => {
          const len = (s.v / total) * circ;
          const el = (
            <circle
              key={i}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={s.c}
              strokeWidth="11"
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="space-y-1.5">
        <div className="font-display text-2xl leading-none text-forest-900 dark:text-cream-100 tabular-nums">
          {a.analyzedPct}%
        </div>
        <div className="text-[11px] text-ink-400 dark:text-cream-100/45 mb-1"><T>analyzed</T></div>
        <LegendRow color={GOLD} label={<T>Analyzed</T>} n={a.status.done} />
        {inProgress > 0 ? <LegendRow color={GOLD_SOFT} label={<T>In progress</T>} n={inProgress} /> : null}
        {na > 0 ? <LegendRow color={NEUTRAL} label={<T>Not analyzable</T>} n={na} /> : null}
      </div>
    </div>
  );
}

function LegendRow({ color, label, n }: { color: string; label: React.ReactNode; n: number }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-forest-800 dark:text-cream-100/80">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
      <span>{label}</span>
      <span className="tabular-nums text-ink-500 dark:text-cream-100/55">{n}</span>
    </div>
  );
}

/** Relevance split as a single stacked bar + counts. */
function RelevanceBar({ a }: { a: CaseEvidenceAnalytics }) {
  const { high, medium, low, scored, avg } = a.relevance;
  const t = Math.max(1, scored);
  const parts = [
    { v: high, c: GOLD, label: <T>High</T> },
    { v: medium, c: GOLD_MID, label: <T>Medium</T> },
    { v: low, c: NEUTRAL, label: <T>Low</T> },
  ];
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-display text-2xl leading-none text-forest-900 dark:text-cream-100 tabular-nums">
          {avg ?? '--'}
        </span>
        <span className="text-[12px] text-ink-400 dark:text-cream-100/45"><T>avg score / 100</T></span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {parts.map((p, i) =>
          p.v > 0 ? <div key={i} style={{ width: `${(p.v / t) * 100}%`, backgroundColor: p.c }} /> : null,
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        {parts.map((p, i) => (
          <LegendRow key={i} color={p.c} label={p.label} n={p.v} />
        ))}
      </div>
    </div>
  );
}

/** Evidence-by-year columns. */
function YearColumns({ rows }: { rows: { year: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="flex items-end gap-1.5 h-40" role="img" aria-label="Evidence items by year">
      {rows.map((r) => (
        <div key={r.year} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0">
          <span className="text-[10px] tabular-nums text-ink-400 dark:text-cream-100/40">{r.n}</span>
          <div
            className="w-full rounded-t-[3px] min-h-[3px]"
            style={{ height: `${(r.n / max) * 100}%`, backgroundColor: GOLD }}
            title={`${r.year}: ${r.n}`}
          />
          <span className="text-[9px] tabular-nums text-ink-400 dark:text-cream-100/40 rotate-0 truncate w-full text-center">
            {r.year.slice(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EvidenceDashboard({ analytics: a }: { analytics: CaseEvidenceAnalytics }) {
  if (a.total === 0) return null;
  const typeParts = [
    { label: 'images', n: a.types.images },
    { label: 'emails', n: a.types.emails },
    { label: 'video', n: a.types.videos },
    { label: 'docs', n: a.types.pdfs + a.types.documents },
    { label: 'other', n: a.types.other },
  ].filter((p) => p.n > 0);
  const span =
    a.earliest && a.latest
      ? Math.max(0, Number(yearFrom(a.latest)) - Number(yearFrom(a.earliest)))
      : 0;

  return (
    <section id="case-dashboard" className="scroll-mt-24 space-y-4 border-t border-ink-100 dark:border-forest-700/40 pt-8">
      <div>
        <p className="eyebrow mb-1"><T>Overview</T></p>
        <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Evidence dashboard</T>
        </h2>
        <p className="text-sm text-ink-500 dark:text-cream-100/55 mt-1 max-w-2xl leading-relaxed">
          <T>
            A live read of everything on file for this matter: what has been uploaded and analyzed, how relevant it is, and what it covers. Updates automatically as evidence comes in.
          </T>
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label={<T>Total items</T>}
          value={a.total.toLocaleString()}
          sub={typeParts.map((p, i) => (
            <span key={p.label}>
              {i > 0 ? ' · ' : ''}
              {p.n} {p.label}
            </span>
          ))}
        />
        <Kpi label={<T>Analyzed</T>} value={a.status.done.toLocaleString()} sub={<>{a.analyzedPct}% <T>complete</T></>} />
        <Kpi label={<T>High relevance</T>} value={a.relevance.high.toLocaleString()} sub={a.relevance.avg != null ? <><T>avg</T> {a.relevance.avg}/100</> : undefined} />
        <Kpi label={<T>Data volume</T>} value={fmtBytes(a.totalBytes)} sub={<>{a.duplicates} <T>duplicates</T></>} />
        <Kpi label={<T>Date span</T>} value={span > 0 ? <>{span} <span className="text-[15px] text-ink-400 dark:text-cream-100/40"><T>yrs</T></span></> : '--'} sub={a.earliest && a.latest ? `${yearFrom(a.earliest)} - ${yearFrom(a.latest)}` : <T>no dates yet</T>} />
        <Kpi label={<T>People</T>} value={a.entities.people.toLocaleString()} sub={<>{a.entities.organizations} <T>orgs</T> · {a.entities.locations} <T>places</T></>} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Panel title={<T>Processing status</T>} hint={<T>where every item stands</T>}>
          <StatusRing a={a} />
        </Panel>
        <Panel title={<T>Relevance to the matter</T>} hint={<><T>AI-scored across</T> {a.relevance.scored} <T>items</T></>}>
          <RelevanceBar a={a} />
        </Panel>
      </div>

      {a.byYear.length > 1 ? (
        <Panel title={<T>Evidence timeline</T>} hint={<>{a.dated} <T>dated items, by year they occurred</T></>}>
          <YearColumns rows={a.byYear} />
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {a.folders.length > 0 ? (
          <Panel title={<T>By folder</T>} hint={<T>auto-filed on analysis</T>}>
            <BarList rows={a.folders} />
          </Panel>
        ) : null}
        {a.docTypes.length > 0 ? (
          <Panel title={<T>By document type</T>} hint={<T>what each item depicts</T>}>
            <BarList rows={a.docTypes} color={GOLD_MID} />
          </Panel>
        ) : null}
      </div>
    </section>
  );
}
