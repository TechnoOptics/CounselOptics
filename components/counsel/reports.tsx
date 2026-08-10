/**
 * The pieces /counsel/reports and /counsel/my are drawn from.
 *
 * Three shapes, and both pages use all three, which is why they live here
 * rather than twice: a stat tile whose value colour is semantic, a ranked
 * bar list, and a column chart of one measure over time.
 *
 * COLOUR IS THE ONLY THING ON A TILE THAT MEANS ANYTHING, and it means one
 * of exactly three things (see FigureTone in lib/counsel-reports.ts). Every
 * other element on the tile is neutral: the label and the caption are
 * `text-muted` on every tile on both pages, whatever the figure is doing.
 * A second coloured element would give the reader two things to interpret
 * and no rule for which one wins.
 *
 * THE CHARTS ARE ONE HUE. The firm accent, stepped down in alpha for rank.
 * Not a categorical palette: these are rankings of one measure, so a second
 * hue would encode nothing and would collide with the status colours, which
 * are reserved. `--accent` is a fill token and is the same value in both
 * themes; `--accent-text` is the text one. Never both, which is the rule
 * docs/TECHOTTIC-PARITY-SPEC.md sets for the whole surface.
 *
 * Everything here is a server component. The hover readout on a bar or a
 * column is a native SVG/HTML `title`, which needs no JavaScript and works
 * on a page somebody printed to PDF with the tooltip closed.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

import { DASH, type Bar, type FigureTone, type WeekPoint } from '@/lib/counsel-reports';
import { PanelCard } from '@/components/counsel/patterns';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * What each tone paints the VALUE, and nothing else on the tile.
 *
 * `plain` is undefined rather than a colour so the figure inherits the
 * page's own foreground, which is the near-black the reference uses for a
 * count with no judgement attached. Naming a colour here would be a third
 * spelling of the foreground token.
 */
const TONE_COLOR: Record<FigureTone, string | undefined> = {
  urgent: 'var(--danger-text)',
  rate: 'var(--accent-text)',
  plain: undefined,
};

/**
 * One figure, and the list it opens.
 *
 * WHY THIS IS NOT StatCard, WHICH IT OTHERWISE COPIES. A tile row is read
 * ACROSS, and it only reads that way if the numbers sit on one line. These
 * labels carry their window after a middle dot, so they run to two lines at
 * a sixth of the page while "Needs attention" runs to one, and a label block
 * that sizes to its own text drops half the row's figures below the other
 * half. Rendered and looked at: with StatCard the six figures landed on
 * three different baselines. The label block therefore RESERVES two lines
 * whatever it holds, which is the one thing this needs that StatCard has no
 * prop for, and the note on StatCard already says the local variants in
 * trust, time and analytics exist for the same kind of reason.
 *
 * The type, the padding and the tabular figures are otherwise StatCard's,
 * deliberately, so a tile here and a tile on the dashboard are the same
 * object.
 *
 * The link is around the card rather than inside it, the way the dashboard
 * strip already does it, so the focus ring traces the card.
 */
export function StatTile({
  label,
  display,
  hint,
  tone,
  href,
}: {
  /** A static label from lib/counsel-reports.ts. Never firm data. */
  label: string;
  /** The figure as drawn: an integer, a percentage, or the dash. */
  display: string;
  /** A noun phrase, true at every value including the dash. */
  hint: string;
  tone: FigureTone;
  href: string;
}) {
  const color = TONE_COLOR[tone];
  return (
    <Link
      href={href}
      className="block h-full rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
    >
      <div className="card h-full p-4 transition-colors">
        {/*
          Three lines reserved on a phone, two from `sm` up. Measured, not
          picked: at 375 the row is two tiles of about 150px and the longest
          label runs to three lines while its neighbour runs to two, so a
          two-line reservation still dropped one of the pair's figures.
        */}
        <p className="flex min-h-[2.85rem] items-start text-[11px] font-medium uppercase leading-[1.35] tracking-[0.16em] text-muted sm:min-h-[2.1rem]">
          <T>{label}</T>
        </p>
        <p
          className="mt-1.5 text-3xl font-semibold tabular-nums tracking-[-0.02em] text-foreground"
          style={color ? { color } : undefined}
        >
          {display}
        </p>
        <p className="mt-1 text-[12px] text-muted">
          <T>{hint}</T>
        </p>
      </div>
    </Link>
  );
}

/** The one plain sentence a card shows when it has nothing to list. */
export function CardEmpty({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] text-muted">{children}</p>;
}

/**
 * A ranked bar list: heaviest first, each bar against the heaviest.
 *
 * The category label sits to the LEFT of its bar and is right-aligned
 * against it, so the labels form a clean edge the bars start from and the
 * eye reads down the ranking rather than hunting for where each bar
 * begins. That is the reference product's arrangement and it is the reason
 * for it.
 *
 * The tint steps down with rank. It carries no information the order does
 * not already carry, which is the point: it is a reading aid on a list
 * that is already sorted, not a second encoding.
 */
export function RankedBars({ bars }: { bars: Bar[] }) {
  return (
    <ul className="space-y-2">
      {/*
        `label` is destructured rather than read off `b` so the <T> wrap is
        the reviewed `label` form: a static UI string, never firm data. Every
        caller feeds rankBars either a literal or a constant-map lookup
        (INTAKE_LANE_LABEL), and that is the contract of this component.
      */}
      {bars.map(({ key, label, display, pct }, i) => (
        <li
          key={key}
          className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3"
        >
          {/*
            `sm:contents` dissolves this wrapper once there is width for the
            three-column arrangement, so the label, the bar and the readout
            become siblings in one row. Below that the label and the readout
            share a line and the bar runs full width underneath: a 136px
            label column inside a 152px card left the bars about ten pixels
            long, which was measured at 375 rather than guessed at.
          */}
          <span className="flex items-baseline justify-between gap-2 sm:contents">
            {/*
              The label column is a SHARE of the card, capped, rather than a
              fixed 8.5rem. Fixed, it took 136px of a 230px card once four of
              these sat in one band and left the bars about a centimetre
              long. A share keeps the bars readable at every card width and
              the cap keeps the labels from sprawling in a half-page card.
            */}
            <span className="text-[12.5px] text-foreground sm:w-auto sm:max-w-[8.5rem] sm:shrink-0 sm:basis-[40%] sm:truncate sm:text-right">
              <T>{label}</T>
            </span>
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted sm:order-last sm:w-10 sm:text-right">
              {display}
            </span>
          </span>
          <span
            className="block h-2.5 w-full overflow-hidden rounded-sm bg-surface-2 sm:w-auto sm:min-w-0 sm:flex-1"
            title={`${label}: ${display}`}
          >
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${pct}%`,
                background: `color-mix(in oklab, var(--accent) ${Math.max(
                  30,
                  100 - i * 22,
                )}%, transparent)`,
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One measure over consecutive weeks, as columns on a single baseline.
 *
 * Flat: no gridlines, no y-axis, no frame. The only chrome is the hairline
 * the columns stand on, which is what tells you where zero is. A week with
 * nothing in it draws no column at all rather than a stub, so an empty
 * quarter reads as empty rather than as a low but steady one.
 *
 * A week whose count could not be read draws no column either, and its
 * readout is the dash. It is not a zero and must not look like one.
 */
export function WeekColumns({ points }: { points: WeekPoint[] }) {
  const max = points.reduce((m, p) => Math.max(m, p.count ?? 0), 0);
  return (
    <div>
      <div className="flex h-32 items-end gap-1">
        {points.map((p, i) => (
          <div
            key={p.startIso}
            className="flex h-full min-w-0 flex-1 items-end"
            title={`${p.label}: ${p.count ?? DASH}`}
          >
            <span
              className="block w-full rounded-t-[3px] bg-accent"
              style={{
                height:
                  max > 0 && p.count != null && p.count > 0
                    ? `${Math.max(3, (p.count / max) * 100)}%`
                    : '0%',
                // The most recent week is the one being asked about, so it
                // is the one at full strength; earlier weeks recede.
                opacity: 0.45 + (0.55 * (i + 1)) / points.length,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 border-t border-edge" />
      {/*
        Every other week is labelled, and the labelled ones do NOT truncate:
        at 375 a twelfth of the card is about 26px, which clipped "May 25"
        to "M...". Each label instead keeps its own width and overflows into
        the empty box beside it, which is empty precisely because the labels
        alternate. `overflow-visible` on the row is what allows that.
      */}
      <div className="mt-1 flex gap-1 overflow-visible">
        {points.map((p, i) => (
          <span
            key={p.startIso}
            className="min-w-0 flex-1 whitespace-nowrap text-center text-[10px] tabular-nums text-muted"
            data-no-translate
          >
            {i % 2 === points.length % 2 ? p.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * A card headed by an uppercase letterspaced label whose qualifier follows
 * a middle dot.
 *
 * The qualifier is a separate prop rather than part of the title string
 * because it is not optional prose: a figure read over the wrong window is
 * the failure this whole habit exists to prevent, so a card that states a
 * period has to state it in the one place every card states it.
 */
export function ReportCard({
  title,
  qualifier,
  children,
}: {
  title: string;
  /** The period or the sort this card's contents are taken over. */
  qualifier: string;
  children: ReactNode;
}) {
  return (
    <PanelCard
      title={
        <>
          <T>{title}</T>
          <span className="text-muted"> · </span>
          <T>{qualifier}</T>
        </>
      }
      bodyClassName="p-4 sm:p-5"
    >
      {children}
    </PanelCard>
  );
}
