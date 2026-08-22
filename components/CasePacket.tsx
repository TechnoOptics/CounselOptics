'use client';

/**
 * Court-ready Packet - flagship.
 *
 * A beautifully typeset, print-to-PDF case document: cover page,
 * table of contents, summary, auto-chronology (exhibits anchored to
 * when the event happened), and a numbered exhibit index. Browser
 * print = a clean PDF with page breaks - no change to the existing
 * server PDF export pipeline (this is additive and safe).
 */

import Link from 'next/link';
import { PopupPortal } from './PopupPortal';
import { formatDateLong } from '@/lib/format';

export type PacketExhibit = {
  n: number;
  label: string;
  category: string;
  fileName: string;
  description: string;
  source: string;
  date: string | null;
  /**
   * Where the date came from, in a couple of words. A bare date in this
   * column reads as the date of the event, and an upload date is routinely
   * months later. See lib/exhibit-chronology.
   */
  dateSource?: string;
};

export type PacketData = {
  caseId: string;
  title: string;
  subjectName: string;
  subjectType: string;
  caseType: string;
  posture: string;
  jurisdiction: string;
  description: string;
  hearingAt: string | null;
  hearingLocation: string | null;
  preparedFor: string;
  openedAt: string;
  exhibits: PacketExhibit[];
  chronology: { date: string; text: string; dateSource?: string }[];
  /** Items with no established date. Named, never placed on the chronology. */
  undatedItems?: { label: string; text: string; n: number }[];
  /**
   * What the person needs to know before printing: exhibits nobody has read,
   * a review that predates the evidence, a placeholder review. Shown on
   * screen and withheld from the print, because it is about the state of the
   * app rather than about the case.
   */
  notices?: string[];
};

function d(iso: string | null): string {
  if (!iso) return '';
  const x = new Date(iso);
  return Number.isNaN(x.getTime())
    ? ''
    : formatDateLong(x);
}

export function CasePacket({ data }: { data: PacketData }) {
  const today = formatDateLong(Date.now());

  return (
    <PopupPortal dark={false}>
      <div className="fixed inset-0 z-[85] overflow-y-auto bg-ink-100">
        {/* Action bar - hidden when printing */}
        <div className="print:hidden sticky top-0 z-10 bg-forest-950 text-cream-100 px-5 py-3 flex items-center justify-between">
          <Link
            href={`/cases/${data.caseId}`}
            className="text-sm text-cream-100/70 hover:text-cream-100"
          >
            &larr; Back to case
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold text-sm"
          >
            Print / Save as PDF
          </button>
        </div>

        {/* What to know before printing. Screen only: it describes the state
            of your file rather than the case, so it does not belong in a
            document that goes to a court. */}
        {data.notices && data.notices.length > 0 && (
          <div className="print:hidden mx-auto mt-6 max-w-[820px] rounded-2xl border border-gold-300 bg-cream-50 px-5 py-4">
            <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gold-700">
              Before you print
            </p>
            <ul className="mt-2 space-y-2">
              {data.notices.map((n, i) => (
                <li key={i} className="text-sm text-ink-800 leading-relaxed">
                  {n}
                </li>
              ))}
            </ul>
            <Link
              href={`/cases/${data.caseId}#exhibits-upload`}
              className="mt-3 inline-block text-sm font-semibold text-forest-800 underline"
            >
              Go back and scan them first
            </Link>
          </div>
        )}

        {/* The document */}
        <div className="mx-auto my-6 print:my-0 max-w-[820px] bg-white text-ink-900 shadow-card-hover print:shadow-none">
          <style>{`@page { margin: 22mm 18mm; } @media print {
            html,body{background:#fff!important}
            .pkt-break{break-before:page}
            .pkt-avoid{break-inside:avoid}
          }`}</style>

          {/* Cover */}
          <section className="px-14 py-20 text-center min-h-[60vh] flex flex-col justify-center pkt-avoid">
            <p className="text-[11px] uppercase tracking-[0.32em] text-gold-600 font-semibold">
              Case Packet
            </p>
            <h1 className="font-display text-4xl font-medium text-forest-900 mt-6 leading-tight">
              {data.title}
            </h1>
            <p className="mt-4 text-ink-600">
              {data.caseType} &middot;{' '}
              <span className="capitalize">{data.posture}</span>
            </p>
            <div className="mt-10 mx-auto w-16 h-px bg-gold-400" />
            <dl className="mt-10 text-sm text-ink-700 space-y-1.5">
              <Row k="Concerning" v={`${data.subjectName} (${data.subjectType})`} />
              <Row k="Jurisdiction" v={data.jurisdiction} />
              {data.hearingAt && (
                <Row
                  k="Hearing"
                  v={`${d(data.hearingAt)}${
                    data.hearingLocation ? ` - ${data.hearingLocation}` : ''
                  }`}
                />
              )}
              <Row k="Prepared for" v={data.preparedFor} />
              <Row k="Prepared" v={today} />
            </dl>
            <p className="mt-14 text-[11px] text-ink-400">
              Organized with Advottic. This packet is an organizational
              aid and is not legal advice.
            </p>
          </section>

          {/* TOC */}
          <section className="px-14 py-12 pkt-break pkt-avoid border-t border-ink-100">
            <h2 className="font-display text-2xl text-forest-900 mb-6">
              Contents
            </h2>
            <ol className="text-sm text-ink-700 space-y-2">
              <Toc n="I" t="Case summary" />
              <Toc n="II" t="Chronology of events" />
              <Toc n="III" t={`Exhibit index (${data.exhibits.length})`} />
            </ol>
          </section>

          {/* Summary */}
          <section className="px-14 py-12 pkt-break border-t border-ink-100">
            <h2 className="font-display text-2xl text-forest-900 mb-4">
              I. Case summary
            </h2>
            <p className="text-[15px] leading-[1.85] text-ink-800 whitespace-pre-wrap font-serif">
              {data.description || 'No summary provided.'}
            </p>
          </section>

          {/* Chronology */}
          <section className="px-14 py-12 pkt-break border-t border-ink-100">
            <h2 className="font-display text-2xl text-forest-900 mb-6">
              II. Chronology of events
            </h2>
            {data.chronology.length === 0 ? (
              <p className="text-sm text-ink-500">
                No dated events yet. Add incident dates to exhibits to
                build the chronology.
              </p>
            ) : (
              <ol className="space-y-4">
                {data.chronology.map((c, i) => (
                  <li key={i} className="flex gap-5 pkt-avoid">
                    <span className="flex-none w-32 text-sm font-semibold text-forest-800 tabular-nums">
                      {c.date}
                      {c.dateSource && (
                        <span className="block text-[10px] font-normal text-ink-500">
                          {c.dateSource}
                        </span>
                      )}
                    </span>
                    <span className="text-[15px] leading-relaxed text-ink-800">
                      {c.text}
                    </span>
                  </li>
                ))}
              </ol>
            )}

            {/* Items with no established date. Named here rather than being
                placed at either end of the chronology above, because both
                ends are a claim about when something happened. */}
            {data.undatedItems && data.undatedItems.length > 0 && (
              <div className="mt-8 pkt-avoid">
                <h3 className="text-sm font-semibold text-forest-900 mb-2">
                  Items with no established date
                </h3>
                <p className="text-[13px] text-ink-600 leading-relaxed mb-3">
                  {data.undatedItems.length === 1 ? 'This item is' : 'These items are'}{' '}
                  listed in the exhibit index but {data.undatedItems.length === 1 ? 'is' : 'are'} not
                  placed in the chronology above, because nothing on file
                  establishes when {data.undatedItems.length === 1 ? 'it' : 'they'} happened.
                </p>
                <ul className="space-y-1.5">
                  {data.undatedItems.map((u) => (
                    <li key={u.n} className="text-[15px] text-ink-800">
                      <span className="font-semibold">{u.label}</span> - {u.text}{' '}
                      (Exhibit {u.n}).
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Exhibit index */}
          <section className="px-14 py-12 pkt-break border-t border-ink-100">
            <h2 className="font-display text-2xl text-forest-900 mb-6">
              III. Exhibit index
            </h2>
            {data.exhibits.length === 0 ? (
              <p className="text-sm text-ink-500">
                No exhibits filed. Each exhibit you upload is
                auto-numbered and listed here.
              </p>
            ) : (
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                    <th className="py-2 pr-3 w-10">#</th>
                    <th className="py-2 pr-3">Exhibit</th>
                    <th className="py-2 pr-3 w-28">Category</th>
                    <th className="py-2 w-28">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data.exhibits.map((e) => (
                    <tr
                      key={e.n}
                      className="border-b border-ink-100 pkt-avoid align-top"
                    >
                      <td className="py-3 pr-3 font-semibold text-forest-800">
                        {e.n}
                      </td>
                      <td className="py-3 pr-3">
                        <span className="font-semibold text-ink-950">
                          {e.label}
                        </span>
                        {e.description && (
                          <span className="block text-ink-600 mt-0.5 leading-relaxed">
                            {e.description}
                          </span>
                        )}
                        {e.source && (
                          <span className="block text-[11px] text-ink-400 mt-0.5">
                            Source: {e.source}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-ink-600">{e.category}</td>
                      <td className="py-3 text-ink-600 tabular-nums">
                        {e.date ? d(e.date) : 'Not established'}
                        {e.dateSource && (
                          <span className="block text-[10px] text-ink-400">
                            {e.dateSource}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <footer className="px-14 py-8 border-t border-ink-100 text-center text-[11px] text-ink-400">
            {data.title} &middot; Prepared {today} &middot; Advottic
          </footer>
        </div>
      </div>
    </PopupPortal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-center gap-2">
      <dt className="text-ink-400">{k}:</dt>
      <dd className="text-ink-800 font-medium">{v}</dd>
    </div>
  );
}
function Toc({ n, t }: { n: string; t: string }) {
  return (
    <li className="flex items-baseline gap-3">
      <span className="text-gold-600 font-semibold w-8">{n}.</span>
      <span>{t}</span>
    </li>
  );
}
