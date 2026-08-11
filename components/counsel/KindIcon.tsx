import type { TimelineKind } from '@/lib/timeline-types';

/**
 * Content-kind line icons, drawn in-house so every evidence surface reads as
 * one considered set instead of borrowed emoji. Pure SVG, server-safe,
 * inherits colour and size from the parent (sizing via className).
 *
 * ONE WEIGHT. The rule is stated in components/counsel/icons.tsx: stroke
 * only, no fills, one weight, round joins, currentColor. That set is the
 * product's reference at 1.7 on a 24 grid, which renders at 1.275px in its
 * 18px box.
 *
 * This set carries the SAME 1.7, and it was 1.6 until today. 1.6 is not a
 * smaller number in a system that only counts numbers; it is a line 6 percent
 * lighter than the rail's at every box these glyphs are ever drawn in, which
 * is what made the evidence surfaces read a shade weaker than the navigation
 * beside them. Unlike the fixed-box glyphs elsewhere (2.78 in an 11px box,
 * 2.35 in a 13px box, both solving sw x box / 24 = 1.275px for their own
 * box), this set has no box of its own to solve for: the caller picks it
 * through className, anywhere from h-3.5 to h-14. So the invariant it can
 * hold is the grid weight, and holding it means a KindIcon and a rail glyph
 * drawn at the same size draw the same line.
 *
 * NO FILLS, and that survived the two glyphs that used to break it. The flag
 * on Event was drawn twice, once filled at 0.16 and once stroked - the exact
 * duotone the rail set was rebuilt to remove, and at 40px you can see the
 * grey ghost behind the outline. The play triangle on Video was solid because
 * an outline triangle that small collapsed; the fix was to draw a BIGGER
 * triangle rather than to fill a small one, which is legible at 14px and
 * keeps the rule true. Neither the interior rules nor anything else carries
 * an opacity any more, for the same reason: a stroke at 0.85 is a second
 * weight wearing the first one's number.
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
      strokeWidth="1.7"
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
      <path d="M13 3.5V8h4.5" />
      <path d="M9 12h6M9 15h4" />
    </Svg>
  );
}

/** Receipt: a slip with a torn base and lines. */
function Receipt(p: Props) {
  return (
    <Svg {...p}>
      <path d="M6.5 4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15l-1.7-1-1.6 1-1.6-1-1.6 1-1.6-1-1.7 1v-15Z" />
      <path d="M9 8h6M9 11h6M9 14h4" />
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

/**
 * Video: a frame with a play triangle, the triangle drawn as an outline that
 * nearly spans the frame. It used to be a solid fill in a stroke-only set,
 * and the fill was buying legibility: the triangle was 4.5 units wide, which
 * on the h-3.5 filter chips is 2.6px, too little to hold a counter. Growing
 * it to 6.2 units buys the same legibility with a stroke, and rendered side
 * by side at 14px the outline is the clearer of the two. It also stops Video
 * being the one solid mark in a row that shows all eight kinds at once.
 */
function Video(p: Props) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M9.8 8.4 16 12l-6.2 3.6V8.4Z" />
    </Svg>
  );
}

/** Message: a speech bubble with a tail. */
function Message(p: Props) {
  return (
    <Svg {...p}>
      <path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10l-3.8 3.2V14.5H6.5a2 2 0 0 1-2-2v-6Z" />
      <path d="M8.5 9h7M8.5 11.5h4" />
    </Svg>
  );
}

/** Note: a folded sticky with a couple of lines. */
function Note(p: Props) {
  return (
    <Svg {...p}>
      <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h11A1.5 1.5 0 0 1 19 5.5v8L13.5 19H6.5A1.5 1.5 0 0 1 5 17.5v-12Z" />
      <path d="M19 13.5H15a1.5 1.5 0 0 0-1.5 1.5V19" />
      <path d="M8.5 9h7M8.5 11.8h4.5" />
    </Svg>
  );
}

/** Event: a milestone flag on a staff. */
function Event(p: Props) {
  return (
    <Svg {...p}>
      <path d="M6 3.5v17" />
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
