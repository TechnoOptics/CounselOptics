import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An audit event that was never written must not look like one that was.
 *
 * `appendWitnessEvent` used to run `await admin.from(...).insert({...})` with
 * no `.select()` and never look at the result, inside a `try/catch`.
 * postgrest-js RESOLVES with `{ error }` rather than throwing, so that catch
 * caught nothing: a constraint violation, an RLS refusal or a dead connection
 * all returned normally and the submission flow carried on believing the
 * event was on record. `witness_submission_events` has a CHECK constraint on
 * `event_type` (supabase/fixes/2026-07-02-community-cases.sql), so a rejected
 * row is not hypothetical.
 *
 * The read that picks up `prev_event_hash` has the same contract. Left
 * uninspected, a failed read is indistinguishable from "no events yet", and
 * the event written next chains off null and starts a second chain behind the
 * first with nothing recording that it did.
 *
 * Mutations this file is meant to catch:
 *   - delete `.select('id').single()` from the insert
 *       -> "asks the database which row it wrote" goes red.
 *   - delete the `if (error)` after the insert
 *       -> "reports an insert the database refused" goes red.
 *   - delete the `if (error)` after the previous-event read
 *       -> "reports a previous-event read the database refused" goes red.
 *   - make any of the reports throw or rethrow
 *       -> the two "resolves rather than throwing" assertions go red.
 *   - change `console.error` back to `console.warn`
 *       -> "reaches the error channel" goes red.
 *
 * They are separate assertions on purpose. Removing only the `.select()`
 * would still leave `error` undefined and still report nothing, so a single
 * combined test would stay green for the wrong reason.
 */

type Recorded = {
  /** Did the code ask the database which row it actually wrote? */
  selected: boolean;
  /** What the fake insert resolves with. */
  insertError: { message: string; code?: string } | null;
  /** What the fake previous-event read resolves with. */
  readError: { message: string } | null;
  /** Should the insert reject rather than resolve? */
  insertThrows: boolean;
};

const rec: { current: Recorded } = {
  current: {
    selected: false,
    insertError: null,
    readError: null,
    insertThrows: false,
  },
};

/**
 * A postgrest-js shaped fake, faithful on the one point that matters: the
 * builder returned by `.insert()` is itself awaitable AND carries `.select()`.
 * That is why the original defect compiled and ran. Awaiting without selecting
 * resolves clean with nothing to inspect, exactly as the real client does, so
 * an uninspected insert cannot tell a refusal from a success.
 */
function makeAdmin() {
  const insertBuilder = (): Record<string, unknown> => ({
    select: () => ({
      single: async () => {
        if (rec.current.insertThrows) throw new Error('socket hang up');
        return rec.current.insertError
          ? { data: null, error: rec.current.insertError }
          : { data: { id: 'evt-1' }, error: null };
      },
    }),
    then: (resolve: (v: unknown) => unknown) => {
      rec.current.selected = false;
      return resolve({ data: null, error: null });
    },
  });

  // The previous-event read is a different call from the write, which is the
  // whole point, so it is its own branch of the fake.
  const readBuilder = (): Record<string, unknown> => ({
    eq: () => readBuilder(),
    order: () => readBuilder(),
    limit: async () =>
      rec.current.readError
        ? { data: null, error: rec.current.readError }
        : { data: [{ event_hash: 'prev-hash' }], error: null },
  });

  return {
    from: () => ({
      insert: () => {
        rec.current.selected = false;
        const b = insertBuilder();
        return {
          ...b,
          select: (...args: unknown[]) => {
            rec.current.selected = true;
            return (b.select as (...a: unknown[]) => unknown)(...args);
          },
        };
      },
      select: () => readBuilder(),
    }),
  };
}

const { appendWitnessEvent } = await import('../lib/witness-audit');

const spyOnError = () =>
  vi.spyOn(console, 'error').mockImplementation(() => {});
const spyOnWarn = () =>
  vi.spyOn(console, 'warn').mockImplementation(() => {});
let err: ReturnType<typeof spyOnError>;
let warn: ReturnType<typeof spyOnWarn>;

/** Everything the module said on the error channel during one call. */
const said = () => err.mock.calls.map((c) => String(c[0])).join('\n');

beforeEach(() => {
  rec.current = {
    selected: false,
    insertError: null,
    readError: null,
    insertThrows: false,
  };
  err = spyOnError();
  warn = spyOnWarn();
});

afterEach(() => {
  err.mockRestore();
  warn.mockRestore();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = () => makeAdmin() as any;

describe('appendWitnessEvent knows whether it wrote', () => {
  it('asks the database which row it wrote', async () => {
    await appendWitnessEvent(admin(), {
      submissionId: 'sub-1',
      eventType: 'submitted',
    });
    expect(rec.current.selected).toBe(true);
  });

  it('reports an insert the database refused', async () => {
    rec.current.insertError = {
      message: 'new row violates check constraint',
      code: '23514',
    };
    await appendWitnessEvent(admin(), {
      submissionId: 'sub-1',
      eventType: 'submitted',
    });
    expect(said()).toContain('submitted');
    expect(said()).toContain('new row violates check constraint');
    expect(said()).toContain('23514');
  });

  it('reports an insert that rejected outright', async () => {
    rec.current.insertThrows = true;
    await appendWitnessEvent(admin(), {
      submissionId: 'sub-1',
      eventType: 'exported',
    });
    expect(said()).toContain('exported');
    expect(said()).toContain('socket hang up');
  });

  it('reports a previous-event read the database refused', async () => {
    // The insert is allowed to succeed so this can only be the read.
    rec.current.readError = { message: 'permission denied for relation' };
    await appendWitnessEvent(admin(), {
      submissionId: 'sub-1',
      eventType: 'flagged',
    });
    expect(said()).toContain('previous event');
    expect(said()).toContain('permission denied for relation');
  });

  it('says nothing when the event really was written', async () => {
    await appendWitnessEvent(admin(), {
      submissionId: 'sub-1',
      eventType: 'submitted',
    });
    expect(err).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('a dropped witness audit write is loud', () => {
  /**
   * The channel is the guard. `warn` is where this codebase puts things that
   * are merely unusual, and platform log alerting is keyed to the error
   * channel, so a dropped audit event reported as a warning is a hole in a
   * record offered as evidence that nobody is paged about. This mirrors
   * reportAuditFailure in lib/security-audit.ts, which is the established
   * mechanism for the same problem on security_events.
   *
   * Mutation this is meant to catch:
   *   - change `console.error` back to `console.warn` in
   *     reportWitnessAuditFailure -> both assertions below go red.
   */
  it('reaches the error channel and not merely the warn channel', async () => {
    rec.current.insertError = { message: 'permission denied', code: '42501' };
    await appendWitnessEvent(admin(), {
      submissionId: 'sub-1',
      eventType: 'submitted',
    });
    expect(err).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('names the module, the event and the reason it was dropped', async () => {
    rec.current.insertError = { message: 'permission denied', code: '42501' };
    await appendWitnessEvent(admin(), {
      submissionId: 'sub-1',
      eventType: 'purge_scheduled',
    });
    // A log line that says only "insert failed" cannot be triaged: the
    // reader needs to know which record lost which event and why.
    expect(said()).toContain('appendWitnessEvent');
    expect(said()).toContain('purge_scheduled');
    expect(said()).toContain('permission denied');
    expect(said()).toContain('42501');
  });
});

describe('appendWitnessEvent never blocks the submission', () => {
  it('resolves rather than throwing when the audit write fails', async () => {
    rec.current.insertError = { message: 'anything', code: 'XX000' };
    rec.current.readError = { message: 'anything' };
    await expect(
      appendWitnessEvent(admin(), {
        submissionId: 'sub-1',
        eventType: 'submitted',
      }),
    ).resolves.toBeUndefined();
  });

  it('resolves rather than throwing when the audit write rejects', async () => {
    rec.current.insertThrows = true;
    await expect(
      appendWitnessEvent(admin(), {
        submissionId: 'sub-1',
        eventType: 'purged',
      }),
    ).resolves.toBeUndefined();
  });
});
