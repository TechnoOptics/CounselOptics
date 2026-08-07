import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Render once, store, and never render again.
 *
 * buildBrandedDocumentPdf is not deterministic: its footer draws
 * `Generated ${new Date().toLocaleDateString()}` and PDFDocument.create()
 * stamps a fresh CreationDate, so two renders of identical text are two
 * different byte strings with two different SHA-256 values.
 * createSigningRequestAction hashes the STORED bytes into
 * firm_signing_requests.document_sha256, so a second render anywhere in the
 * chain would have the audit trail attest to a document nobody was shown.
 *
 * "Rendered once" is therefore not a comment, it is the property this file
 * exists to hold, and it is asserted by counting calls to the renderer across
 * paths that each have a reason to reach for it: a retry, a second approver in
 * a second tab, and a failure part way through.
 */

const renderer = vi.hoisted(() =>
  vi.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3])),
);
vi.mock('../lib/branded-document-pdf', () => ({ buildBrandedDocumentPdf: renderer }));
vi.mock('../lib/firm-storage', () => ({
  getFirmByIdAdmin: async () => ({
    name: 'Anderson Foundation',
    accentColor: '#0f2d24',
    letterheadUrl: null,
    logoUrl: null,
  }),
}));

const { materializeSubmissionDocument } = await import('../lib/submission-document');
const { sha256 } = await import('../lib/esign-audit');

// ── A narrow fake of the admin client ────────────────────────────────────

type Rows = Record<string, Record<string, unknown>>;

const db = {
  submissions: {} as Rows,
  documents: {} as Rows,
  objects: {} as Record<string, Buffer>,
  /** Runs once, right after the claim reads, so a second caller can interleave. */
  onClaim: null as (() => void) | null,
  failInsert: false,
  failUpload: false,
};

class Query implements PromiseLike<{ data: unknown; error: unknown }> {
  private conds: Array<[string, unknown]> = [];
  private nullConds: string[] = [];
  private op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  private patch: Record<string, unknown> = {};
  constructor(private table: 'submissions' | 'documents') {}
  select() {
    if (this.op === 'select') this.op = 'select';
    return this;
  }
  insert(values: Record<string, unknown>) {
    this.op = 'insert';
    this.patch = values;
    return this;
  }
  update(values: Record<string, unknown>) {
    this.op = 'update';
    this.patch = values;
    return this;
  }
  delete() {
    this.op = 'delete';
    return this;
  }
  eq(col: string, value: unknown) {
    this.conds.push([col, value]);
    return this;
  }
  is(col: string, value: unknown) {
    if (value === null) this.nullConds.push(col);
    return this;
  }
  private matches(row: Record<string, unknown>): boolean {
    return (
      this.conds.every(([c, v]) => row[c] === v) &&
      this.nullConds.every((c) => row[c] == null)
    );
  }
  private run(): { data: unknown; error: unknown } {
    const store = db[this.table];
    if (this.op === 'insert') {
      if (db.failInsert) return { data: null, error: { message: 'insert refused' } };
      store[String(this.patch.id)] = { ...this.patch };
      return { data: null, error: null };
    }
    if (this.op === 'update') db.onClaim?.();
    const hits = Object.values(store).filter((r) => this.matches(r));
    if (this.op === 'select') return { data: hits[0] ?? null, error: null };
    if (this.op === 'delete') {
      for (const r of hits) delete store[String(r.id)];
      return { data: null, error: null };
    }
    for (const r of hits) Object.assign(r, this.patch);
    return { data: hits[0] ?? null, error: null };
  }
  maybeSingle() {
    return Promise.resolve(this.run());
  }
  then<A, B>(
    resolve?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
    reject?: ((r: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

const admin = {
  from(table: string) {
    return new Query(table === 'firm_documents' ? 'documents' : 'submissions');
  },
  storage: {
    from() {
      return {
        async upload(path: string, body: Buffer) {
          if (db.failUpload) return { error: { message: 'upload refused' } };
          if (db.objects[path]) return { error: { message: 'already exists' } };
          db.objects[path] = Buffer.from(body);
          return { error: null };
        },
        async download(path: string) {
          const bytes = db.objects[path];
          if (!bytes) return { data: null, error: { message: 'not found' } };
          return { data: new Blob([new Uint8Array(bytes)]), error: null };
        },
        async remove(paths: string[]) {
          for (const p of paths) delete db.objects[p];
          return { error: null };
        },
      };
    },
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const SUBMISSION_ID = 'sub-1';

beforeEach(() => {
  renderer.mockClear();
  db.submissions = {
    [SUBMISSION_ID]: {
      id: SUBMISSION_ID,
      firm_id: 'firm-1',
      template_name: 'Mutual NDA',
      submitted_by: 'user-1',
      document_text: 'A document with enough words in it to be worth rendering.',
      document_id: null,
    },
  };
  db.documents = {};
  db.objects = {};
  db.onClaim = null;
  db.failInsert = false;
  db.failUpload = false;
});

describe('materializeSubmissionDocument', () => {
  it('renders once, stores the bytes, and files a document row', async () => {
    const out = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(renderer).toHaveBeenCalledTimes(1);

    const doc = db.documents[out.documentId] as Record<string, unknown>;
    expect(doc.firm_id).toBe('firm-1');
    expect(doc.mime_type).toBe('application/pdf');
    expect(doc.tags).toEqual(['template-submission']);
    expect(doc.uploaded_by).toBe('user-1');
    // The path convention lib/letters-actions.ts already uses.
    expect(doc.file_path).toBe(`firm-1/${out.documentId}/Mutual NDA.pdf`);
    // And the pointer is on the submission, which is the direction the whole
    // join depends on.
    expect(db.submissions[SUBMISSION_ID].document_id).toBe(out.documentId);
  });

  /**
   * The hash is of the bytes that are in the bucket, not of a second render
   * and not of the document text. Those are three different values and only
   * one of them answers "what was the counterparty shown".
   */
  it('returns the hash of the bytes it stored', async () => {
    const out = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const stored = db.objects[`firm-1/${out.documentId}/Mutual NDA.pdf`];
    expect(out.sha256).toBe(sha256(stored));
    expect(out.sha256).not.toBe(sha256(String(db.submissions[SUBMISSION_ID].document_text)));
  });

  /**
   * The retry path. A dispatch that filed the document and then failed to
   * create the signing request comes back through here, and it must get the
   * same document rather than a second one with different bytes.
   */
  it('does not render again on a second call', async () => {
    const first = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    const second = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    expect(renderer).toHaveBeenCalledTimes(1);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.documentId).toBe(first.documentId);
    expect(second.sha256).toBe(first.sha256);
    expect(Object.keys(db.documents)).toHaveLength(1);
    expect(Object.keys(db.objects)).toHaveLength(1);
  });

  /**
   * Two approvers in two tabs. Both pass the gate, both render, and the
   * conditional update on document_id is what decides which render the
   * instrument actually is. The loser must take its own copy back out of the
   * bucket, or the firm holds two documents with two hashes for one agreement
   * and no way to say which the signer saw.
   */
  it('discards its own copy and returns the winner when it loses the claim', async () => {
    const winnerPath = 'firm-1/doc-winner/Mutual NDA.pdf';
    const winnerBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 9, 9, 9]);
    // The interleaving, made deterministic: the other approver's copy lands
    // between this caller's read and this caller's write, which is exactly the
    // window the conditional update exists to close.
    db.onClaim = () => {
      db.onClaim = null;
      db.documents['doc-winner'] = { id: 'doc-winner', file_path: winnerPath };
      db.objects[winnerPath] = winnerBytes;
      db.submissions[SUBMISSION_ID].document_id = 'doc-winner';
    };

    const out = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // The loser reports the winner's document, and the winner's hash, which is
    // the hash of the bytes actually in the bucket.
    expect(out.documentId).toBe('doc-winner');
    expect(out.sha256).toBe(sha256(winnerBytes));
    // And it took its own copy back out, both the row and the object, so the
    // firm is not left holding two documents with two hashes for one
    // agreement and no way to say which the signer saw.
    expect(Object.keys(db.documents)).toEqual(['doc-winner']);
    expect(Object.keys(db.objects)).toEqual([winnerPath]);
    expect(db.submissions[SUBMISSION_ID].document_id).toBe('doc-winner');
  });

  /**
   * Losing the claim and being able to read what won are different questions.
   * Reporting a loss as a success would name a document id whose bytes this
   * process has just deleted, and the signing request would then be created
   * over nothing.
   */
  it('refuses rather than name a winner it cannot read', async () => {
    db.onClaim = () => {
      db.onClaim = null;
      // The pointer moves but the winner's own row is not visible yet.
      db.submissions[SUBMISSION_ID].document_id = 'doc-winner';
    };
    const out = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    expect(out.ok).toBe(false);
    // Nothing of this caller's own is left behind on the way out.
    expect(Object.keys(db.documents)).toEqual([]);
    expect(Object.keys(db.objects)).toEqual([]);
  });

  it('removes the uploaded object when the document row cannot be inserted', async () => {
    db.failInsert = true;
    const out = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    expect(out.ok).toBe(false);
    expect(Object.keys(db.objects)).toEqual([]);
    expect(db.submissions[SUBMISSION_ID].document_id).toBeNull();
  });

  it('refuses without filing anything when the upload fails', async () => {
    db.failUpload = true;
    const out = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    expect(out.ok).toBe(false);
    expect(Object.keys(db.documents)).toEqual([]);
    expect(db.submissions[SUBMISSION_ID].document_id).toBeNull();
  });

  /**
   * A null render is a refusal, not a throw, and it must not leave a pointer
   * behind. The renderer returns null for a document with nothing worth
   * rendering in it.
   */
  it('refuses when the renderer has nothing to render', async () => {
    renderer.mockResolvedValueOnce(null as never);
    const out = await materializeSubmissionDocument(admin, SUBMISSION_ID);
    expect(out.ok).toBe(false);
    expect(Object.keys(db.objects)).toEqual([]);
    expect(db.submissions[SUBMISSION_ID].document_id).toBeNull();
  });

  it('refuses a submission that is not there', async () => {
    const out = await materializeSubmissionDocument(admin, 'no-such-submission');
    expect(out).toEqual({ ok: false, error: 'That submission could not be found.' });
    expect(renderer).not.toHaveBeenCalled();
  });
});
