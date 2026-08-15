import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A sub-processor with no DPA and no BAA must not be reachable by setting one
 * API key.
 *
 * Two code paths post a COMPLETE raw exhibit file, plus the uploader's own
 * filename, to OpenAI's Whisper endpoint: transcribeMedia in lib/ai.ts and
 * transcribeAudio in lib/timeline-ai.ts. A client voice note or an incident
 * video can contain anything the client said, health information included.
 * Advottic's own policy in
 * docs/compliance/policies/vendor-and-subprocessor-management.md forbids that
 * without a signed DPA and, for PHI, a BAA. Neither exists.
 *
 * Until 2026-08-15 the only thing stopping it was that OPENAI_API_KEY happened
 * to be unset in production. Nobody had written that down, so setting one
 * variable to try the feature would have started shipping client evidence to a
 * processor under no agreement, and the person setting it would have had no
 * reason to think they were making a compliance decision.
 *
 * THESE TESTS ARE BEHAVIOURAL. They stub global fetch, drive the two real
 * functions, and assert on whether a request to api.openai.com was actually
 * ATTEMPTED. No source text is matched in the two assertions that matter, so
 * no comment, import, or neighbouring identifier can satisfy them: only a
 * request that does not leave.
 *
 * The register is read rather than restated. While the OpenAI row's BAA and
 * DPA boxes are unticked, the gate is required. Once the agreements genuinely
 * exist and the boxes are ticked, this file stops demanding it, so the guard
 * retires itself instead of having to be deleted by hand.
 *
 * Mutations that turn these red:
 *   - `return true` from openaiTranscriptionAllowed, or dropping its second
 *     condition so the key alone suffices: both "refuses" tests go red,
 *     because the stub records a request to api.openai.com.
 *   - removing the gate call from lib/ai.ts: "transcribeMedia sends nothing"
 *     goes red.
 *   - removing it from lib/timeline-ai.ts: "transcribeAudio sends nothing"
 *     goes red.
 *   - deleting transcription outright to make the refusals trivially true:
 *     the two "reaches OpenAI once the agreements are asserted" tests go red,
 *     so the guard cannot be satisfied by removing the thing it guards.
 *   - accepting a loose truthy flag value ("true", "yes", "1"): the
 *     "only the exact word" test goes red.
 *   - deleting the OpenAI row from the register: "the register still carries
 *     the row" goes red, so the paperwork cannot be silenced by forgetting it.
 */

const REGISTER = path.join(
  process.cwd(),
  'docs/compliance/policies/vendor-and-subprocessor-management.md',
);

/**
 * The register's OpenAI row, split into cells. Read from the file rather than
 * copied here, so the test tracks the document a compliance reviewer edits.
 */
function openaiRegisterRow(): string[] | null {
  const lines = readFileSync(REGISTER, 'utf8').split(/\r?\n/);
  const row = lines.find((line) => line.trim().startsWith('| **OpenAI**'));
  if (!row) return null;
  return row.split('|').map((cell) => cell.trim());
}

/** ☐ is the register's marker for an outstanding action. */
function agreementsOutstanding(row: string[]): boolean {
  return row.some((cell) => cell.includes('☐'));
}

/**
 * A fetch that records rather than sends. Any attempt to reach the network in
 * these tests is a failure of the thing under test, so it never resolves to a
 * fake success: it throws, and the callers' own error handling decides what
 * the user sees. What is asserted is the URL list.
 */
function recordingFetch() {
  const urls: string[] = [];
  const stub = vi.fn(async (input: unknown) => {
    urls.push(String(input));
    throw new Error('network blocked in test');
  });
  return { urls, stub };
}

const OPENAI_HOST = 'api.openai.com';

describe('OpenAI transcription is gated on the agreements, not on the key', () => {
  const saved = {
    key: process.env.OPENAI_API_KEY,
    flag: process.env.OPENAI_SUBPROCESSOR_AGREEMENTS,
    fetch: globalThis.fetch,
  };

  beforeEach(() => {
    // The exact situation this exists to survive: somebody sets the key.
    process.env.OPENAI_API_KEY = 'sk-test-key-not-real';
    delete process.env.OPENAI_SUBPROCESSOR_AGREEMENTS;
  });

  afterEach(() => {
    if (saved.key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = saved.key;
    if (saved.flag === undefined) delete process.env.OPENAI_SUBPROCESSOR_AGREEMENTS;
    else process.env.OPENAI_SUBPROCESSOR_AGREEMENTS = saved.flag;
    globalThis.fetch = saved.fetch;
    vi.restoreAllMocks();
  });

  it('the register still carries the OpenAI row', () => {
    // If this row is ever removed, every other test here would pass vacuously
    // by concluding the paperwork is done.
    expect(openaiRegisterRow()).not.toBeNull();
  });

  it('the register shows the agreements as outstanding, so the gate is required', () => {
    const row = openaiRegisterRow();
    expect(row).not.toBeNull();
    // This is the premise of the two refusal tests below. Should it ever flip,
    // the failure message points at the file to read.
    expect(
      agreementsOutstanding(row as string[]),
      'The OpenAI row in the vendor register no longer shows outstanding boxes. ' +
        'If the DPA and BAA really are executed, this test file may be retired ' +
        'along with lib/subprocessor-gate.ts. If they are not, restore the row.',
    ).toBe(true);
  });

  it('refuses on the key alone, and on unrecognised flag values', async () => {
    const { openaiTranscriptionAllowed } = await import('../lib/subprocessor-gate');
    expect(openaiTranscriptionAllowed({ OPENAI_API_KEY: 'sk-x' })).toBe(false);
    // Only the exact word counts. A half-remembered "true" is not an assertion
    // that a lawyer signed something.
    for (const value of ['true', 'yes', '1', 'y', 'pending', '']) {
      expect(
        openaiTranscriptionAllowed({
          OPENAI_API_KEY: 'sk-x',
          OPENAI_SUBPROCESSOR_AGREEMENTS: value,
        }),
        `"${value}" must not be read as the agreements being signed`,
      ).toBe(false);
    }
    // And the flag alone, with no credential, is still nothing.
    expect(
      openaiTranscriptionAllowed({ OPENAI_SUBPROCESSOR_AGREEMENTS: 'signed' }),
    ).toBe(false);
    expect(
      openaiTranscriptionAllowed({
        OPENAI_API_KEY: 'sk-x',
        OPENAI_SUBPROCESSOR_AGREEMENTS: 'signed',
      }),
    ).toBe(true);
  });

  it('transcribeMedia sends nothing to OpenAI while the agreements are outstanding', async () => {
    const { urls, stub } = recordingFetch();
    globalThis.fetch = stub as unknown as typeof fetch;
    const { transcribeMedia } = await import('../lib/ai');

    const result = await transcribeMedia({
      fileBuffer: Buffer.from('fake audio bytes'),
      mediaType: 'audio/mpeg',
      fileName: 'client-voice-note.mp3',
    });

    expect(urls.filter((u) => u.includes(OPENAI_HOST))).toEqual([]);
    // The file did not leave, and the caller is told plainly rather than shown
    // a half-finished transcript.
    expect(result.transcript).toBe('');
    expect(result.isDemo).toBe(true);
  });

  it('transcribeAudio sends nothing to OpenAI while the agreements are outstanding', async () => {
    const { urls, stub } = recordingFetch();
    globalThis.fetch = stub as unknown as typeof fetch;
    const { transcribeAudio } = await import('../lib/timeline-ai');

    const result = await transcribeAudio({
      buffer: Buffer.from('fake audio bytes'),
      filename: 'incident.m4a',
      mime: 'audio/mp4',
    });

    expect(urls.filter((u) => u.includes(OPENAI_HOST))).toEqual([]);
    expect(result).toMatchObject({ configured: false, text: null });
  });

  it('transcribeMedia reaches OpenAI once the agreements are asserted', async () => {
    // The other half of the guard. Without this, deleting transcription
    // altogether would make the refusal test above pass for the wrong reason.
    process.env.OPENAI_SUBPROCESSOR_AGREEMENTS = 'signed';
    const { urls, stub } = recordingFetch();
    globalThis.fetch = stub as unknown as typeof fetch;
    const { transcribeMedia } = await import('../lib/ai');

    await transcribeMedia({
      fileBuffer: Buffer.from('fake audio bytes'),
      mediaType: 'audio/mpeg',
      fileName: 'client-voice-note.mp3',
    }).catch(() => undefined);

    expect(urls.filter((u) => u.includes(OPENAI_HOST)).length).toBeGreaterThan(0);
  });

  it('transcribeAudio reaches OpenAI once the agreements are asserted', async () => {
    process.env.OPENAI_SUBPROCESSOR_AGREEMENTS = 'signed';
    const { urls, stub } = recordingFetch();
    globalThis.fetch = stub as unknown as typeof fetch;
    const { transcribeAudio } = await import('../lib/timeline-ai');

    await transcribeAudio({
      buffer: Buffer.from('fake audio bytes'),
      filename: 'incident.m4a',
      mime: 'audio/mp4',
    }).catch(() => undefined);

    expect(urls.filter((u) => u.includes(OPENAI_HOST)).length).toBeGreaterThan(0);
  });
});
