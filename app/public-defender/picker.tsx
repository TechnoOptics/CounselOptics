'use client';

import { useMemo, useState } from 'react';
import type { PublicDefenderRecord } from '@/lib/public-defenders';

export function PublicDefenderPicker({ records }: { records: PublicDefenderRecord[] }) {
  const [code, setCode] = useState('');
  const [query, setQuery] = useState('');

  const ordered = useMemo(
    () => [...records].sort((a, b) => a.name.localeCompare(b.name)),
    [records],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ordered;
    return ordered.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.pdOffice.name.toLowerCase().includes(q),
    );
  }, [ordered, query]);

  const selected = ordered.find((s) => s.code === code);

  return (
    <section className="space-y-5">
      <div className="card p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="eyebrow mb-1">State directory</p>
            <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
              Find the right office
            </h2>
          </div>
          {selected && (
            <button
              type="button"
              onClick={() => setCode('')}
              className="btn-ghost text-[12.5px]"
            >
              Clear
            </button>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="sr-only">Search states</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search state or 2-letter code"
              className="input w-full"
            />
          </label>
          <label className="block">
            <span className="sr-only">Choose state</span>
            <select
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="input w-full sm:w-[280px]"
              aria-label="Choose state"
            >
              <option value="">Choose state...</option>
              {filtered.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!selected && (
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 text-[13px]">
            {filtered.map((s) => (
              <li key={s.code}>
                <button
                  type="button"
                  onClick={() => setCode(s.code)}
                  className="w-full text-left rounded-lg border border-ink-200 dark:border-forest-700/40 px-3 py-2 hover:bg-ink-50/60 dark:hover:bg-forest-800/40 transition-colors"
                >
                  <span className="font-medium text-forest-900 dark:text-cream-100">
                    {s.name}
                  </span>
                  <span className="ml-2 text-ink-500 dark:text-cream-100/55">{s.code}</span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="col-span-full text-sm text-ink-500 dark:text-cream-100/55">
                No matches.
              </li>
            )}
          </ul>
        )}
      </div>

      {selected && <Detail record={selected} />}
    </section>
  );
}

function Detail({ record: r }: { record: PublicDefenderRecord }) {
  return (
    <article className="card p-6 sm:p-7 space-y-5">
      <header>
        <p className="eyebrow">{r.name}</p>
        <h3 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100 mt-1">
          {r.pdOffice.name}
        </h3>
      </header>

      <p className="text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">{r.summary}</p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={r.pdOffice.url}
          target="_blank"
          rel="noreferrer noopener"
          className="btn bg-forest-900 text-cream-100 hover:bg-forest-800 shadow-brand-glow font-semibold px-4 py-2 text-[13px]"
        >
          Public defender office
        </a>
        {r.appellateOffice && (
          <a
            href={r.appellateOffice.url}
            target="_blank"
            rel="noreferrer noopener"
            className="btn-secondary text-[13px] px-4 py-2"
          >
            {r.appellateOffice.name}
          </a>
        )}
        {r.pdOffice.phone && (
          <a
            href={`tel:${r.pdOffice.phone.replace(/[^0-9+]/g, '')}`}
            className="btn-secondary text-[13px] px-4 py-2"
          >
            {r.pdOffice.phone}
          </a>
        )}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300 mb-2">
          How to apply
        </p>
        <ol className="list-decimal list-outside pl-5 text-[13.5px] text-ink-700 dark:text-cream-100/80 space-y-1.5 leading-relaxed">
          {r.applyHow.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {r.indigencyRule && (
          <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 mt-3 italic">
            Indigency standard: {r.indigencyRule}
          </p>
        )}
      </div>

      {r.civilLegalAid.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-gold-700 dark:text-gold-300 mb-2">
            Civil legal aid (for non-criminal matters)
          </p>
          <ul className="text-[13.5px] text-ink-700 dark:text-cream-100/80 space-y-1.5">
            {r.civilLegalAid.map((c, i) => (
              <li key={i}>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline text-forest-900 dark:text-cream-100 hover:text-forest-700"
                >
                  {c.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11.5px] text-ink-500 dark:text-cream-100/55 leading-relaxed">
        We share this as a starting point. State systems shift; verify against the office&apos;s
        own page before relying on details. Advottic does not provide legal advice.
      </p>
    </article>
  );
}
