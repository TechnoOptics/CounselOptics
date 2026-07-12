import Link from 'next/link';
import { T } from '@/components/i18n/LocaleProvider';
import type { CaseEvidenceAnalytics, NameCount } from '@/lib/case-analytics';

/* Live evidence analytics for a matter. Server-rendered from
   getCaseEvidenceAnalytics on each (force-dynamic) page load, so it reflects
   the current de-duplicated, freshly-analysed set with no client fetch. Charts
   are hand-rolled SVG/CSS (no chart dependency) in a gold + neutral palette;
   deliberately no green, per the firm-surface rule.

   Every metric and chart segment is a deep link into the Evidence tab with a
   filter query param (?status=, ?relevance=, ?folder=, ?doctype=, ?year=,
   ?group=), so the dashboard reads as a launchpad into the evidence, not a
   static readout. The evidence list parses those params and narrows itself,
   showing a clearable "Showing ..." chip. */

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

function Kpi({
  label,
  value,
  sub,
  href,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="text-[12px] font-medium text-ink-500 dark:text-cream-100/55">{label}</div>
      <div className="mt-1 font-display text-[26px] leading-none tracking-[-0.01em] text-forest-900 dark:text-cream-100 tabular-nums">
        {value}
      </div>
      {sub ? <div className="mt-1 text-[11px] text-ink-400 dark:text-cream-100/40">{sub}</div> : null}
    </>
  );
  const cls =
    'block rounded-xl bg-cream-50/70 dark:bg-forest-900/40 border border-ink-100 dark:border-forest-700/40 px-4 py-3.5';
  if (!href) return <div className={cls}>{body}</div>;
  return (
    <Link
      href={href}
      prefetch={false}
      className={`${cls} transition-colors hover:border-gold-500/50 hover:bg-white dark:hover:bg-forest-800/50`}
    >
      {body}
    </Link>
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

/** Horizontal bar list, sequential gold. Each row links to its filtered slice. */
function BarList({ rows, color = GOLD, hrefFor }: { rows: NameCount[]; color?: string; hrefFor: (name: string) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <Link
          key={r.name}
          href={hrefFor(r.name)}
          prefetch={false}
          className="grid grid-cols-[minmax(0,7.5rem)_1fr_2rem] items-center gap-2 rounded-md px-1 py-1 -mx-1 transition-colors hover:bg-gold-500/10"
        >
          <div className="truncate text-[12px] text-forest-800 dark:text-cream-100/80" title={r.name}>
            {r.name}
          </div>
          <div className="h-2.5 rounded-sm bg-ink-100/70 dark:bg-forest-800/60 overflow-hidden">
            <div className="h-full rounded-sm" style={{ width: `${(r.n / max) * 100}%`, backgroundColor: color }} />
          </div>
          <div className="text-right text-[12px] tabular-nums text-ink-500 dark:text-cream-100/60">{r.n}</div>
        </Link>
      ))}
    </div>
  );
}

function StatusRing({ a, base }: { a: CaseEvidenceAnalytics; base: string }) {
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
      <div className="space-y-1">
        <div className="font-display text-2xl leading-none text-forest-900 dark:text-cream-100 tabular-nums">
          {a.analyzedPct}%
        </div>
        <div className="text-[11px] text-ink-400 dark:text-cream-100/45 mb-1"><T>analyzed</T></div>
        <LegendRow color={GOLD} label={<T>Analyzed</T>} n={a.status.done} href={`${base}?status=done`} />
        {inProgress > 0 ? <LegendRow color={GOLD_SOFT} label={<T>In progress</T>} n={inProgress} href={`${base}?status=pending`} /> : null}
        {na > 0 ? <LegendRow color={NEUTRAL} label={<T>Not analyzable</T>} n={na} href={`${base}?status=error`} /> : null}
      </div>
    </div>
  );
}

function LegendRow({ color, label, n, href }: { color: string; label: React.ReactNode; n: number; href?: string }) {
  const body = (
    <>
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
      <span>{label}</span>
      <span className="tabular-nums text-ink-500 dark:text-cream-100/55">{n}</span>
    </>
  );
  const cls = 'flex items-center gap-2 text-[12px] text-forest-800 dark:text-cream-100/80';
  if (!href) return <div className={cls}>{body}</div>;
  return (
    <Link href={href} prefetch={false} className={`${cls} rounded-md px-1.5 py-0.5 -mx-1.5 transition-colors hover:bg-gold-500/10`}>
      {body}
    </Link>
  );
}

function RelevanceBar({ a, base }: { a: CaseEvidenceAnalytics; base: string }) {
  const { high, medium, low, scored, avg } = a.relevance;
  const t = Math.max(1, scored);
  const parts = [
    { v: high, c: GOLD, label: <T>High</T>, band: 'high' },
    { v: medium, c: GOLD_MID, label: <T>Medium</T>, band: 'medium' },
    { v: low, c: NEUTRAL, label: <T>Low</T>, band: 'low' },
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
        {parts.map((p, i) => (p.v > 0 ? <div key={i} style={{ width: `${(p.v / t) * 100}%`, backgroundColor: p.c }} /> : null))}
      </div>
      <div className="mt-3 space-y-1">
        {parts.map((p, i) => (
          <LegendRow key={i} color={p.c} label={p.label} n={p.v} href={`${base}?relevance=${p.band}`} />
        ))}
      </div>
    </div>
  );
}

/** Evidence-by-year columns; each column links to that year. */
function YearColumns({ rows, base }: { rows: { year: string; n: number }[]; base: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="flex items-end gap-1.5 h-40" role="img" aria-label="Evidence items by year">
      {rows.map((r) => (
        <Link
          key={r.year}
          href={`${base}?year=${r.year}&group=date`}
          prefetch={false}
          className="group flex-1 flex flex-col items-center justify-end gap-1 min-w-0"
          title={`${r.year}: ${r.n}`}
        >
          <span className="text-[10px] tabular-nums text-ink-400 dark:text-cream-100/40">{r.n}</span>
          <div
            className="w-full rounded-t-[3px] min-h-[3px] transition-opacity group-hover:opacity-80"
            style={{ height: `${(r.n / max) * 100}%`, backgroundColor: GOLD }}
          />
          <span className="text-[9px] tabular-nums text-ink-400 dark:text-cream-100/40 truncate w-full text-center">
            {r.year.slice(2)}
          </span>
        </Link>
      ))}
    </div>
  );
}

export function EvidenceDashboard({ analytics: a, caseId }: { analytics: CaseEvidenceAnalytics; caseId: string }) {
  if (a.total === 0) return null;
  const base = `/counsel/cases/${caseId}/evidence`;
  const q = (params: Record<string, string>) => `${base}?${new URLSearchParams(params).toString()}`;
  const typeParts: { label: string; n: number; key: string }[] = [
    { label: 'images', n: a.types.images, key: 'images' },
    { label: 'emails', n: a.types.emails, key: 'emails' },
    { label: 'video', n: a.types.videos, key: 'videos' },
    { label: 'docs', n: a.types.pdfs + a.types.documents, key: 'docs' },
  ].filter((p) => p.n > 0);
  const span = a.earliest && a.latest ? Math.max(0, Number(yearFrom(a.latest)) - Number(yearFrom(a.earliest))) : 0;

  return (
    <section id="case-dashboard" className="scroll-mt-24 space-y-4 border-t border-ink-100 dark:border-forest-700/40 pt-8">
      <div>
        <p className="eyebrow mb-1"><T>Overview</T></p>
        <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>Evidence dashboard</T>
        </h2>
        <p className="text-sm text-ink-500 dark:text-cream-100/55 mt-1 max-w-2xl leading-relaxed">
          <T>
            A live read of everything on file for this matter. Select any metric or bar to open the matching evidence, filtered.
          </T>
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi
          label={<T>Total items</T>}
          value={a.total.toLocaleString()}
          href={base}
          sub={typeParts.map((p, i) => (
            <span key={p.label}>
              {i > 0 ? ' · ' : ''}
              {p.n} {p.label}
            </span>
          ))}
        />
        <Kpi label={<T>Analyzed</T>} value={a.status.done.toLocaleString()} href={q({ status: 'done' })} sub={<>{a.analyzedPct}% <T>complete</T></>} />
        <Kpi label={<T>High relevance</T>} value={a.relevance.high.toLocaleString()} href={q({ relevance: 'high' })} sub={a.relevance.avg != null ? <><T>avg</T> {a.relevance.avg}/100</> : undefined} />
        <Kpi label={<T>Data volume</T>} value={fmtBytes(a.totalBytes)} href={base} sub={<>{a.duplicates} <T>duplicates</T></>} />
        <Kpi label={<T>Date span</T>} value={span > 0 ? <>{span} <span className="text-[15px] text-ink-400 dark:text-cream-100/40"><T>yrs</T></span></> : '--'} href={q({ group: 'date' })} sub={a.earliest && a.latest ? `${yearFrom(a.earliest)} - ${yearFrom(a.latest)}` : <T>no dates yet</T>} />
        <Kpi label={<T>People</T>} value={a.entities.people.toLocaleString()} href={base} sub={<>{a.entities.organizations} <T>orgs</T> · {a.entities.locations} <T>places</T></>} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Panel title={<T>Processing status</T>} hint={<T>where every item stands</T>}>
          <StatusRing a={a} base={base} />
        </Panel>
        <Panel title={<T>Relevance to the matter</T>} hint={<><T>AI-scored across</T> {a.relevance.scored} <T>items</T></>}>
          <RelevanceBar a={a} base={base} />
        </Panel>
      </div>

      {a.byYear.length > 1 ? (
        <Panel title={<T>Evidence timeline</T>} hint={<>{a.dated} <T>dated items, by year they occurred</T></>}>
          <YearColumns rows={a.byYear} base={base} />
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {a.folders.length > 0 ? (
          <Panel title={<T>By folder</T>} hint={<T>auto-filed on analysis</T>}>
            <BarList rows={a.folders} hrefFor={(name) => q({ folder: name })} />
          </Panel>
        ) : null}
        {a.docTypes.length > 0 ? (
          <Panel title={<T>By document type</T>} hint={<T>what each item depicts</T>}>
            <BarList rows={a.docTypes} color={GOLD_MID} hrefFor={(name) => q({ doctype: name })} />
          </Panel>
        ) : null}
      </div>
    </section>
  );
}
