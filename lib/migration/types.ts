/**
 * Universal migration model.
 *
 * Any source platform (a CSV/JSON export, ServiceNow, Clio, a custom
 * API, ...) is normalized into one platform-agnostic `MigrationBundle`,
 * which the ingest action writes into the firm workspace. The point is
 * that customers moving to Advottic keep EVERYTHING: the records, their
 * attachments/images, their notes, and their history/timeline with the
 * ORIGINAL dates, so the move doesn't feel like a fresh, empty start.
 *
 * Adding a new source = adding one adapter that returns a MigrationBundle.
 * The ingest path never changes.
 */

export type MigrationAttachment = {
  name: string;
  mimeType: string;
  /** Inline file bytes (base64). Use this OR `url`. */
  dataBase64?: string;
  /** A fetchable URL the connector can pull the bytes from. */
  url?: string;
  /** Original capture/upload date (ISO), preserved on the exhibit. */
  capturedAt?: string;
  description?: string;
};

export type MigrationHistoryEvent = {
  at: string; // ISO timestamp from the source system
  actor?: string;
  event: string;
  detail?: string;
};

export type MigrationNote = { at?: string; author?: string; body: string };

export type MigrationCase = {
  /** Id in the source system (for traceability/dedup). */
  externalId?: string;
  title: string;
  subjectName?: string;
  subjectType?: 'person' | 'business' | 'matter' | 'state' | 'entity';
  caseType?: string;
  status?: string;
  description?: string;
  jurisdictionState?: string;
  jurisdictionCity?: string;
  /** Original creation date (ISO), preserved as the case created_at. */
  openedAt?: string;
  attachments?: MigrationAttachment[];
  history?: MigrationHistoryEvent[];
  notes?: MigrationNote[];
};

export type MigrationBundle = {
  /** Human label for where this came from, e.g. "ServiceNow". */
  source: string;
  cases: MigrationCase[];
};

/**
 * The raw input a caller hands the normalizer. Each `kind` maps to one
 * adapter in normalize.ts.
 */
export type MigrationSourceInput =
  | { kind: 'json'; text: string }
  | { kind: 'csv'; text: string; mapping: Record<string, string> }
  | {
      kind: 'servicenow';
      instanceUrl: string;
      /** A Bearer token, or a full "Basic ..."/"Bearer ..." header value. */
      token: string;
      table?: string;
      query?: string;
      limit?: number;
    };
