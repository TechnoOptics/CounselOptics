/**
 * Custom line icons for the counsel case surfaces, drawn in-house so the app's
 * primary destinations read as a considered set rather than borrowed emoji.
 * All share a 24-box, 1.6 stroke, round joins - a single visual language that
 * scales cleanly and inherits `currentColor` (so the gold hover state on the
 * tab bar flows straight through). Server-safe: pure SVG, no client runtime.
 */

type IconProps = { className?: string };

const base = 'h-[18px] w-[18px]';

/** Case Timeline — a chronology rail with beaded events. */
export function TimelineIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`${base} ${className ?? ''}`}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 4v16" opacity="0.55" />
      <circle cx="5" cy="7.5" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="5" cy="14" r="1.9" />
      <circle cx="5" cy="19.5" r="1.4" fill="currentColor" stroke="none" opacity="0.7" />
      <path d="M9.5 7.5h9M9.5 14h6.5M9.5 19.5h4.5" opacity="0.9" />
    </svg>
  );
}

/** Evidence Intake — a document dropping into an intake tray. */
export function EvidenceIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`${base} ${className ?? ''}`}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M8 3.5h5.5L17 7v5.5" opacity="0.9" />
      <path d="M13 3.5V7h3.5" />
      <path d="M12 9.5v6m0 0-2.4-2.4M12 15.5l2.4-2.4" />
      <path d="M4 15.5v2.5A2 2 0 0 0 6 20h12a2 2 0 0 0 2-2v-2.5h-4.2a2 2 0 0 1-3.6 0H4Z" fill="currentColor" stroke="none" opacity="0.16" />
      <path d="M4 15.5v2.5A2 2 0 0 0 6 20h12a2 2 0 0 0 2-2v-2.5h-4.2a2 2 0 0 1-3.6 0H4Z" />
    </svg>
  );
}

/** Court Packet — a bound, sealed dossier ready to file. */
export function PacketIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={`${base} ${className ?? ''}`}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 3.5h7L18 8v10.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 18.5v-13A1.5 1.5 0 0 1 6.5 3.5Z" />
      <path d="M13 3.5V8h4" opacity="0.9" />
      <circle cx="11.5" cy="13" r="2.4" />
      <path d="M9.9 15.1 9 18l2.5-1.3L14 18l-.9-2.9" fill="currentColor" stroke="none" opacity="0.9" />
    </svg>
  );
}
