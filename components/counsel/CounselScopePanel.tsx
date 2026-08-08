import { T } from '@/components/i18n/LocaleProvider';

/**
 * The "viewing as" readout at the top of the counsel rail.
 *
 * It states two facts the firm has actually configured: what this
 * workspace covers, and what its request references are prefixed with.
 * Nothing here is a control, and that is deliberate.
 *
 * WHY THE PRACTICE-AREA ROWS ARE NOT CLICKABLE. The sibling product's
 * version of this panel is a scope SWITCHER: picking a department
 * narrows every list behind it. Advottic cannot do that yet, because
 * `practice_areas` is a column on `firms` and a matter carries no
 * practice area at all - there is nothing on the other side of the
 * click to filter by. So the rows render as plain text: no hover, no
 * cursor, no button or link semantics, nothing that offers a press it
 * cannot honour. When matters gain a practice area, these rows become
 * links and `Everything` becomes the "no filter" row it looks like.
 *
 * WHY IT DISAPPEARS ENTIRELY. A firm with no practice areas set would
 * get a box containing the word `Everything` and nothing else, which
 * tells the reader less than the space it occupies. It renders null
 * instead.
 *
 * The prefix is the one from firm_settings.ticket_prefix, and it is
 * omitted rather than guessed when the firm has not set one. There is
 * exactly one prefix per firm, so it sits on the `Everything` row; a
 * per-area prefix would be an invention.
 */
export function CounselScopePanel({
  practiceAreas,
  ticketPrefix,
}: {
  practiceAreas: string[];
  /** firm_settings.ticket_prefix, or null when the firm has not set one. */
  ticketPrefix: string | null;
}) {
  const areas = practiceAreas.map((a) => a.trim()).filter(Boolean);
  if (areas.length === 0) return null;

  return (
    <div className="mb-3 rounded-lg border border-edge bg-surface-2 px-2 py-2">
      <p className="flex items-center gap-1.5 px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
        <EyeIcon />
        <T>Viewing as</T>
      </p>
      {/* Same tint, ring and radius as the active nav row below, because
          it is the same idea: this is where you are. `bg-accent` is a
          plain var() and takes no opacity modifier, so the tint comes
          from the gold scale exactly as the nav row's does; the WORDS
          are text-accent-text, which is the firm-derived one. */}
      <p className="flex items-center gap-2 rounded-md bg-gold-500/15 px-2 py-1 text-[13px] font-semibold text-accent-text ring-1 ring-gold-500/30">
        <CheckIcon />
        <span className="flex-1">
          <T>Everything</T>
        </span>
        {ticketPrefix ? (
          <span className="font-mono text-[10.5px] tracking-wider" data-no-translate>
            {ticketPrefix}
          </span>
        ) : null}
      </p>
      <ul className="mt-0.5">
        {areas.map((area) => (
          <li
            key={area}
            // Firm-entered text, so it is data and not chrome.
            data-no-translate
            className="px-2 py-1 pl-[30px] text-[12.5px] text-muted"
          >
            {area}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="flex-none"
    >
      <path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
