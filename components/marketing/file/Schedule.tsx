import Link from 'next/link';
import { Sheet, Stamp } from './Sheet';
import { BUTTON_INK, LABEL } from './type';

export type ScheduleColumn = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  cta: { label: string; href: string; hideOnIos?: boolean };
  emphasized?: boolean;
};
export type ScheduleRow = { label: string; cells: string[] };

const OUTLINE =
  'inline-flex min-h-[44px] items-center rounded-[3px] border border-forest-900 px-3.5 py-2 font-public text-[13px] font-semibold text-forest-900 no-underline hover:bg-forest-900/5 dark:border-cream-100/70 dark:text-cream-100 dark:hover:bg-cream-100/10';

/**
 * A schedule of fees: tiers as columns, one feature per row, so tiers can
 * be compared row by row. The stamp sits on `stampOn` and is the page's
 * gold. Below lg the table scrolls inside its own container; the page
 * body never scrolls sideways. Below sm each tier is also listed as a
 * Sheet so a phone reader is not asked to pan a five-column table.
 */
export function Schedule({
  columns,
  rows,
  stampOn,
  stamp,
}: {
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
  stampOn?: string;
  stamp?: { line1: string; line2: string };
}) {
  const cta = (c: ScheduleColumn) => (
    <Link
      href={c.cta.href}
      {...(c.cta.hideOnIos ? { 'data-hide-on-ios': true } : {})}
      className={c.emphasized ? BUTTON_INK : OUTLINE}
    >
      {c.cta.label}
    </Link>
  );
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <td className="border-b border-forest-900 dark:border-cream-100/40" />
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className="relative border-b border-forest-900 pb-3 pr-3 pt-10 text-left align-top font-normal dark:border-cream-100/40"
                >
                  {stamp && stampOn === c.id && (
                    <span className="absolute right-2 top-0 block h-24 w-28 origin-top-right scale-75">
                      <Stamp line1={stamp.line1} line2={stamp.line2} />
                    </span>
                  )}
                  <span className="block font-caslon text-[20px]">{c.name}</span>
                  <span className="block font-caslon text-[26px] tabular-nums">
                    {c.price} <span className={`${LABEL} normal-case`}>{c.cadence}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row" className={`${LABEL} w-[22%] border-b border-dotted border-rule py-2 pr-3 text-left font-normal`}>
                  {r.label}
                </th>
                {r.cells.map((cell, i) => (
                  <td key={columns[i]?.id ?? i} className="border-b border-dotted border-rule py-2 pr-3 align-top tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td />
              {columns.map((c) => (
                <td key={c.id} className="pr-3 pt-4">
                  {cta(c)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 sm:hidden">
        {columns.map((c) => (
          <Sheet
            key={c.id}
            kicker={c.name}
            kickerRight={`${c.price} ${c.cadence}`}
            className={stamp && stampOn === c.id ? 'pb-16' : ''}
          >
            {stamp && stampOn === c.id && <Stamp line1={stamp.line1} line2={stamp.line2} />}
            {rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-4 border-b border-dotted border-rule py-2 last:border-b-0">
                <span className={LABEL}>{r.label}</span>
                <span className="tabular-nums">{r.cells[columns.indexOf(c)] ?? ''}</span>
              </div>
            ))}
            <div className="pt-4">{cta(c)}</div>
          </Sheet>
        ))}
      </div>
    </>
  );
}
