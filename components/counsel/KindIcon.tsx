import type { TimelineKind } from '@/lib/timeline-types';

/**
 * Custom content-kind line icons, drawn in-house to the SAME visual language as
 * the case-section icons (24-box, 1.6 stroke, round joins, currentColor) so
 * every evidence surface reads as one considered set instead of borrowed emoji.
 * Pure SVG, server-safe, inherits color + size from the parent (pass sizing via
 * className, e.g. "h-4 w-4" or "h-10 w-10").
 */

type Props = { className?: string; title?: string };

function Svg({ className, title, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className ?? 'h-5 w-5'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Photo: framed image with a sun and horizon. */
function Photo(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M4.5 16.5 8.5 13l3 2.5 4-4 4 4.5" />
    </Svg>
  );
}

/** Document: a page with a folded corner and text lines. */
function Document(p: Props) {
  return (
    <Svg {...p}>
      <path d="M7 3.5h6L17.5 8v10.5A1.5 1.5 0 0 1 16 20H8a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M13 3.5V8h4.5" opacity="0.9" />
      <path d="M9 12h6M9 15h4" opacity="0.85" />
    </Svg>
  );
}

/** Receipt: a slip with a torn base and lines. */
function Receipt(p: Props) {
  return (
    <Svg {...p}>
      <path d="M6.5 4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15l-1.7-1-1.6 1-1.6-1-1.6 1-1.6-1-1.7 1v-15Z" />
      <path d="M9 8h6M9 11h6M9 14h4" opacity="0.85" />
    </Svg>
  );
}

/** Audio: a five-bar waveform. */
function Audio(p: Props) {
  return (
    <Svg {...p}>
      <path d="M5 10.5v3M8.5 8v8M12 6.5v11M15.5 9v6M19 11v2" />
    </Svg>
  );
}

/** Video: a frame with a play triangle. */
function Video(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M10.5 9.4 15 12l-4.5 2.6V9.4Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Message: a speech bubble with a tail. */
function Message(p: Props) {
  return (
    <Svg {...p}>
      <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-3.8 3.2V14.5H6.5a2 2 0 0 1-2-2v-6Z" />
      <path d="M8.5 9h7M8.5 11.5h4" opacity="0.85" />
    </Svg>
  );
}

/** Note: a folded sticky with a couple of lines. */
function Note(p: Props) {
  return (
    <Svg {...p}>
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v8L13.5 19H6.5A1.5 1.5 0 0 1 5 17.5v-12Z" />
      <path d="M19 13.5H15a1.5 1.5 0 0 0-1.5 1.5V19" opacity="0.9" />
      <path d="M8.5 9h7M8.5 11.8h4.5" opacity="0.8" />
    </Svg>
  );
}

/** Event: a milestone flag on a staff. */
function Event(p: Props) {
  return (
    <Svg {...p}>
      <path d="M6 3.5v17" />
      <path d="M6 4.5h9l-2 2.6 2 2.6H6" fill="currentColor" stroke="none" opacity="0.16" />
      <path d="M6 4.5h9l-2 2.6 2 2.6H6" />
    </Svg>
  );
}

const MAP: Record<TimelineKind, (p: Props) => JSX.Element> = {
  photo: Photo,
  document: Document,
  receipt: Receipt,
  audio: Audio,
  video: Video,
  message: Message,
  note: Note,
  event: Event,
};

/** Render the premium line icon for an evidence kind. */
export function KindIcon({ kind, className, title }: { kind: TimelineKind } & Props) {
  const Cmp = MAP[kind] ?? Document;
  return <Cmp className={className} title={title} />;
}
