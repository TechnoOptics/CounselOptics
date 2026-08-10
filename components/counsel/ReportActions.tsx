'use client';

import { T } from '@/components/i18n/LocaleProvider';

/**
 * The two things a leadership report is for once it has been read: taking
 * it into a meeting, and taking it into a spreadsheet.
 *
 * THE EXPORT IS THE FIGURES ON THE SCREEN, and it is built from the same
 * array the tiles and the panels are drawn from, handed down as `rows`. It
 * is not a second query and it cannot be a second answer. An Export that
 * re-derived its own numbers is how a printed board pack and a live page
 * come to disagree, and nobody finds out until somebody adds them up.
 *
 * It is deliberately NOT the whole-organization archive at
 * /api/firm/export. That route is a departing firm's complete records, it
 * is owner and admin only, and offering it from a button labelled Export
 * on a reports page would hand a reviewing partner a different thing from
 * the one they asked for.
 *
 * Print is the browser's own print, so what comes out is what is on the
 * screen. There is no separate print stylesheet to drift from it.
 */
export function ReportActions({
  rows,
  filename,
}: {
  /** [label, value] for every figure the page states, in reading order. */
  rows: Array<[string, string]>;
  filename: string;
}) {
  const download = () => {
    const csv = rows
      .map(([label, value]) =>
        [label, value]
          // RFC 4180: quote every field and double an embedded quote. A
          // label carrying the middle-dot qualifier is safe either way,
          // but a value could be anything a future figure returns.
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(','),
      )
      .join('\r\n');
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => window.print()} className="btn-secondary">
        <PrinterIcon />
        <T>Print</T>
      </button>
      <button type="button" onClick={download} className="btn-primary">
        <TrayIcon />
        <T>Export</T>
      </button>
    </div>
  );
}

/* Single-weight stroke glyphs on currentColor, roughly the cap height of
   the label beside them. A button carries an icon only when the icon names
   the action, which is why these two have one and nothing else here does. */

function PrinterIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 9V4h10v5" />
      <path d="M5 9h14a2 2 0 0 1 2 2v5h-4" />
      <path d="M3 16V11a2 2 0 0 1 2-2" />
      <path d="M7 14h10v6H7z" />
    </svg>
  );
}

function TrayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}
