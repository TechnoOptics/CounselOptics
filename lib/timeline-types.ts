/**
 * Case Timeline Builder — shared types.
 *
 * A chronological evidence builder: the user drops media + context, Bella
 * analyses each item (OCR, dates, people, chat sender/recipient), and Advottic
 * arranges everything into a court-exportable timeline. See
 * supabase/fixes/2026-07-06-case-timeline.sql.
 */

export type TimelineKind =
  | 'photo'
  | 'document'
  | 'receipt'
  | 'audio'
  | 'video'
  | 'message'
  | 'note'
  | 'event';

/**
 * How precisely an entry is dated. The smart picker lets a user choose the
 * grain from seconds up to a year (or leave it undated). 'exact' is a legacy
 * alias kept for older rows and is displayed like 'minute'. occurred_at is a
 * full timestamp, so the grain governs only how the moment is *shown*.
 */
export type OccurredPrecision =
  | 'second'
  | 'minute'
  | 'hour'
  | 'exact'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | 'unknown';

/** The grains the picker offers, coarse → fine, with labels. */
export const PRECISION_GRAINS: { value: OccurredPrecision; label: string; hint: string }[] = [
  { value: 'second', label: 'Second', hint: 'To the exact second' },
  { value: 'minute', label: 'Minute', hint: 'To the minute' },
  { value: 'hour', label: 'Hour', hint: 'Approximate hour' },
  { value: 'day', label: 'Day', hint: 'A specific day' },
  { value: 'week', label: 'Week', hint: 'The week of' },
  { value: 'month', label: 'Month', hint: 'A month' },
  { value: 'year', label: 'Year', hint: 'A year' },
  { value: 'unknown', label: 'Undated', hint: 'No date yet' },
];

export type AiStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export type PersonRole = 'subject' | 'witness' | 'opposing' | 'support' | 'other';

export type TimelineMedia = {
  path: string;
  mime: string;
  name: string;
  size: number;
};

/** One message inside a parsed chat/group-chat screenshot. */
export type ParsedMessage = {
  sender: string | null;
  recipient: string | null;
  timestamp: string | null;
  body: string;
};

/** Bella's structured analysis of a timeline item. */
export type AiExtracted = {
  ocr_text?: string;
  /** ISO-ish date strings Bella spotted in the content ("2023-03-14", "March 2023"). */
  detected_dates?: string[];
  /** People Bella observed (names read from the content, or generic "Person in red"). */
  detected_people?: string[];
  /** Locations / street addresses / places named or visible in the content. */
  locations?: string[];
  /** Companies, agencies, courts, or other organizations named in the content. */
  organizations?: string[];
  /** For a chat/group-chat screenshot. */
  message_thread?: {
    platform?: string | null;
    participants?: string[];
    messages?: ParsedMessage[];
  };
  objects?: string[];
  suggested_title?: string;
  /** Bella's best guess of when this happened + how sure it is. */
  suggested_occurred_at?: string | null;
  suggested_precision?: OccurredPrecision;
  confidence?: 'high' | 'medium' | 'low';
  /**
   * Forensic "core details" pulled from the file itself — EXIF/GPS/device for
   * images, authoring metadata for PDFs. Best-effort; empty when the file
   * carries none. See lib/media-metadata.ts.
   */
  metadata?: { label: string; value: string }[];
  /** GPS coordinates embedded in the file, when present. */
  metadata_gps?: { lat: number; lng: number } | null;
  /**
   * Map pins for this entry: the file's own GPS plus any named locations that
   * geocoded to coordinates. Powers the live case map and the export maps.
   * Empty/undefined when nothing resolved or Maps is not configured.
   */
  geo_points?: { lat: number; lng: number; label: string; source: 'gps' | 'place' }[];
  /**
   * How relevant this item is to the specific case it was filed under (0 to
   * 100), scored against the case facts (title, subject, type, jurisdiction,
   * description). Distinct from `confidence`, which is only how sure the reader
   * is of its own extraction. Undefined when the item was not scored (no case
   * context, analysis skipped, or a legacy row).
   */
  relevance_score?: number;
  /** One neutral sentence explaining the relevance score. */
  relevance_reason?: string;
  /**
   * For an imported email (.eml / .msg): the parsed header fields, so the
   * timeline can show who sent it, to whom, and when at a glance. The body is
   * carried in `ocr_text` and the people/dates flow into the usual fields.
   */
  email?: {
    from?: string | null;
    to?: string[];
    cc?: string[];
    subject?: string | null;
    date?: string | null;
    attachments?: string[];
  };
};

/** Coarse relevance bands for badges + map de-emphasis, derived from the score. */
export type RelevanceBand = 'high' | 'medium' | 'low';

/** Map a 0-100 relevance score to a band. Undefined score → undefined (unscored). */
export function relevanceBand(score: number | undefined | null): RelevanceBand | undefined {
  if (typeof score !== 'number' || Number.isNaN(score)) return undefined;
  if (score >= 67) return 'high';
  if (score >= 34) return 'medium';
  return 'low';
}

export type CasePerson = {
  id: string;
  caseId: string;
  displayName: string;
  role: PersonRole;
  aliases: string[];
  notes: string | null;
  avatarPath: string | null;
  createdAt: string;
};

export type TimelineEvent = {
  id: string;
  caseId: string;
  createdBy: string;
  occurredAt: string | null;
  occurredPrecision: OccurredPrecision;
  kind: TimelineKind;
  title: string;
  description: string | null;
  media: TimelineMedia[];
  sourceLabel: string | null;
  aiSummary: string | null;
  aiExtracted: AiExtracted;
  aiStatus: AiStatus;
  aiError: string | null;
  people: string[]; // CasePerson ids
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type TimelineNarrative = {
  caseId: string;
  summary: string | null;
  narrative: string | null;
  conclusion: string | null;
  eventCount: number;
  generatedAt: string | null;
};

/** The full payload the builder page hydrates with. */
export type TimelineBundle = {
  events: TimelineEvent[];
  people: CasePerson[];
  narrative: TimelineNarrative | null;
};

export const KIND_LABEL: Record<TimelineKind, string> = {
  photo: 'Photo',
  document: 'Document',
  receipt: 'Receipt',
  audio: 'Voice note',
  video: 'Video',
  message: 'Message',
  note: 'Note',
  event: 'Event',
};

export const KIND_ICON: Record<TimelineKind, string> = {
  photo: '🖼️',
  document: '📄',
  receipt: '🧾',
  audio: '🎙️',
  video: '🎬',
  message: '💬',
  note: '📝',
  event: '📌',
};

export const ROLE_LABEL: Record<PersonRole, string> = {
  subject: 'Subject',
  witness: 'Witness',
  opposing: 'Opposing party',
  support: 'Support',
  other: 'Other',
};

const IMAGE_MIME = /^image\//;
const VIDEO_MIME = /^video\//;
const AUDIO_MIME = /^audio\//;

/**
 * True for an email file we can parse (.eml via RFC822, .msg best-effort).
 * Detected by extension or mime, since browsers often send an empty/generic
 * mime for these.
 */
export function isEmailFile(mime: string, name: string): boolean {
  const n = name.toLowerCase();
  return (
    /message\/rfc822|application\/vnd\.ms-outlook|application\/x-msg/i.test(mime) ||
    /\.(eml|msg)$/i.test(n)
  );
}

/** Best-guess kind from a file's mime type (the user can override). */
export function kindFromMime(mime: string, name: string): TimelineKind {
  if (isEmailFile(mime, name)) return 'message';
  if (IMAGE_MIME.test(mime)) {
    return /receipt|invoice/i.test(name) ? 'receipt' : 'photo';
  }
  if (VIDEO_MIME.test(mime)) return 'video';
  if (AUDIO_MIME.test(mime)) return 'audio';
  if (mime === 'application/pdf' || /msword|officedocument|text\//.test(mime)) {
    return 'document';
  }
  return 'note';
}

/** Analysable-as-an-image (Claude vision) — photos, receipts, message screenshots. */
export function isVisionAnalyzable(mime: string): boolean {
  return /^image\/(jpe?g|png|webp|gif|heic|heif)$/i.test(mime);
}

/**
 * Human date label honoring precision, e.g. "March 2023" / "2023" / "Undated".
 * Rendered identically in the UI and the exported PDF so they never disagree.
 */
export function formatOccurred(
  occurredAt: string | null,
  precision: OccurredPrecision,
): string {
  if (!occurredAt || precision === 'unknown') return 'Undated';
  const d = new Date(occurredAt);
  if (Number.isNaN(d.getTime())) return 'Undated';
  if (precision === 'year') return String(d.getUTCFullYear());
  if (precision === 'month') {
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  if (precision === 'week') {
    return 'Week of ' + d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  if (precision === 'hour') {
    return d.toLocaleString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', timeZone: 'UTC',
    });
  }
  if (precision === 'second') {
    return d.toLocaleString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'UTC',
    });
  }
  if (precision === 'minute' || precision === 'exact') {
    return d.toLocaleString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    });
  }
  return d.toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

/** Chronological sort: dated events by date, undated sink to the end by position. */
export function sortTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    if (a.occurredAt && b.occurredAt) {
      const d = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
      return d !== 0 ? d : a.position - b.position;
    }
    if (a.occurredAt) return -1;
    if (b.occurredAt) return 1;
    return a.position - b.position;
  });
}
