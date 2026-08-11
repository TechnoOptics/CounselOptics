import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The reason an upload was refused has to reach the person who uploaded it.
 *
 * screenAuthenticatedUpload() answers with a sentence written to be read
 * ("This file is not a valid image.", "This PDF could not be accepted for
 * security reasons.", the size limit). addExhibit converted that answer into
 * `throw new Error(screen.reason)`, and React STRIPS an error's message when
 * it crosses the Server Action boundary in a production build, replacing it
 * with "An error occurred in the Server Components render. The specific
 * message is omitted in production builds...". So the person who picked the
 * wrong file was shown React internals and had no way to learn what was
 * wrong, or what to do instead.
 *
 * A refusal is an expected outcome and belongs in the RETURN VALUE. An
 * exception is for the unexpected. This file pins both halves of that:
 * the refusal travels as a value, and a genuine internal error still gives
 * the person calm copy rather than a raw message.
 *
 * The source guard at the bottom DERIVES its call sites by walking the tree
 * for the refusal-producing functions rather than listing them, because a
 * hardcoded list is how a fix lands on N-1 of N sites.
 */

const PDF_BYTES = Buffer.from('%PDF-1.7\n%âãÏÓ\nrest of a small pdf', 'latin1');
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

function fakeFile(name: string, type: string, bytes: Buffer): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

// ---------------------------------------------------------------------------
// 1. addExhibit answers with the refusal instead of throwing it.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const uploads: string[] = [];
  const state = {
    caseRow: { id: 'case-1' } as { id: string } | null,
    user: { id: 'user-1' } as { id: string } | null,
    insertError: null as { message: string } | null,
  };

  function makeServer() {
    return {
      from: (table: string) => {
        const node: Record<string, unknown> = {
          select: () => node,
          eq: () => node,
          insert: () => node,
          update: () => node,
          order: () => node,
          limit: () => node,
          maybeSingle: async () => ({
            data: table === 'cases' ? state.caseRow : null,
            error: null,
            count: 0,
          }),
          single: async () => {
            if (state.insertError) return { data: null, error: state.insertError };
            return {
              data: {
                id: 'ex-1',
                case_id: 'case-1',
                label: 'Exhibit A',
                file_name: 'evidence.png',
                storage_path: 'user-1/case-1/ex-1.png',
                file_type: 'image/png',
                file_size: 1,
                description: '',
                incident_date: null,
                source: null,
                category: null,
                scan_data: null,
                uploaded_at: '2026-01-01T00:00:00.000Z',
              },
              error: null,
            };
          },
          then: (resolve: (v: unknown) => unknown) =>
            resolve({ data: null, error: null, count: 0 }),
        };
        return node;
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (p: string) => {
            uploads.push(`${bucket}:${p}`);
            return { error: null };
          },
          remove: async () => ({ error: null }),
        }),
      },
    };
  }

  return { uploads, state, makeServer };
});

vi.mock('../lib/supabase/server', () => ({
  isSupabaseConfigured: () => true,
  getCurrentUser: async () => h.state.user,
  createServerSupabase: () => h.makeServer(),
  requireUser: async () => h.state.user,
  isCurrentUserAdmin: async () => false,
}));

vi.mock('../lib/supabase/admin', () => ({ createAdminSupabase: () => null }));

vi.mock('../lib/email', () => ({
  sendEmail: async () => ({ ok: true }),
  isEmailConfigured: () => false,
  buildInviteEmailHtml: () => '',
  buildCounselWelcomeEmailHtml: () => '',
}));

describe('addExhibit answers a refusal instead of throwing it', () => {
  beforeEach(() => {
    h.uploads.length = 0;
    h.state.caseRow = { id: 'case-1' };
    h.state.user = { id: 'user-1' };
    h.state.insertError = null;
  });

  it('returns the magic-byte reason for a file declared an image that is not one', async () => {
    const { addExhibit } = await import('../lib/storage');
    const result = await addExhibit({
      caseId: 'case-1',
      file: fakeFile('holiday.png', 'image/png', PDF_BYTES),
      description: '',
    });
    expect(result).toEqual({ ok: false, error: 'This file is not a valid image.' });
    // The refusal has to land BEFORE the bytes do, or it is not a refusal.
    expect(h.uploads).toEqual([]);
  });

  it('returns the audio reason for a recording that is not a recording', async () => {
    const { addExhibit } = await import('../lib/storage');
    const result = await addExhibit({
      caseId: 'case-1',
      file: fakeFile('call.mp3', 'audio/mpeg', PDF_BYTES),
      description: '',
    });
    expect(result).toEqual({
      ok: false,
      error: 'This file is not a valid audio recording.',
    });
    expect(h.uploads).toEqual([]);
  });

  it('returns the PDF security reason for a PDF that auto-runs script', async () => {
    const { addExhibit } = await import('../lib/storage');
    const bad = Buffer.from('%PDF-1.7\n/OpenAction << /S /JavaScript >>', 'latin1');
    const result = await addExhibit({
      caseId: 'case-1',
      file: fakeFile('notice.pdf', 'application/pdf', bad),
      description: '',
    });
    expect(result).toEqual({
      ok: false,
      error: 'This PDF could not be accepted for security reasons.',
    });
    expect(h.uploads).toEqual([]);
  });

  it('returns the case-not-found refusal rather than throwing it', async () => {
    h.state.caseRow = null;
    const { addExhibit } = await import('../lib/storage');
    const result = await addExhibit({
      caseId: 'case-missing',
      file: fakeFile('evidence.png', 'image/png', PNG_BYTES),
      description: '',
    });
    expect(result).toEqual({ ok: false, error: 'Case not found.' });
  });

  it('returns the signed-out refusal rather than throwing it', async () => {
    h.state.user = null;
    const { addExhibit } = await import('../lib/storage');
    const result = await addExhibit({
      caseId: 'case-1',
      file: fakeFile('evidence.png', 'image/png', PNG_BYTES),
      description: '',
    });
    expect(result).toEqual({ ok: false, error: 'Not signed in.' });
  });

  it('still hands back the exhibit when the file is accepted', async () => {
    const { addExhibit } = await import('../lib/storage');
    const result = await addExhibit({
      caseId: 'case-1',
      file: fakeFile('evidence.png', 'image/png', PNG_BYTES),
      description: 'the photo',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.exhibit.id).toBe('ex-1');
    expect(h.uploads).toHaveLength(1);
  });

  it('still THROWS when the database write fails, because that is not a refusal', async () => {
    h.state.insertError = { message: 'connection reset by peer' };
    const { addExhibit } = await import('../lib/storage');
    await expect(
      addExhibit({
        caseId: 'case-1',
        file: fakeFile('evidence.png', 'image/png', PNG_BYTES),
        description: '',
      }),
    ).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. No refusal reason is converted into a throw at any site that consumes one.
// ---------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCAN_DIRS = ['lib', 'app', 'components'];

/** Every source file under the app, so no call site can be missed by a list. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.next') continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  for (const d of SCAN_DIRS) walk(path.join(ROOT, d));
  return out;
}

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The functions whose result IS a refusal reason meant for a person. */
const REFUSAL_PRODUCERS =
  '(?:screenAuthenticatedUpload|validateCommunityUpload|validateIdPhoto|safeStorageUpload)';

/**
 * The local names a file binds a refusal result to.
 *
 * Matching `throw x.error` outright would also condemn `throw resp.error`,
 * which is a PostgREST failure and belongs thrown. So the guard follows the
 * VALUE: only a name bound to one of the producers above carries a sentence
 * written for a person.
 */
function refusalBindings(code: string): string[] {
  const re = new RegExp(
    `\\b(?:const|let|var)\\s+(\\w+)\\s*=\\s*(?:await\\s+)?${REFUSAL_PRODUCERS}\\s*\\(`,
    'g',
  );
  return [...code.matchAll(re)].map((m) => m[1]);
}

describe('no upload refusal is thrown across a server boundary', () => {
  const consumers = sourceFiles()
    .filter((f) => !f.endsWith(path.join('lib', 'upload-safety.ts'))) // the producer itself
    .map((f) => [f, refusalBindings(stripComments(readFileSync(f, 'utf8')))] as const)
    .filter(([, names]) => names.length > 0);

  it('finds the call sites from source rather than from a list', () => {
    // If this ever reads zero, the match stopped working and every assertion
    // below became vacuous.
    expect(consumers.length).toBeGreaterThan(5);
  });

  for (const [file, names] of consumers) {
    const rel = path.relative(ROOT, file);
    it(`${rel} returns the reason, never throws it`, () => {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const name of names) {
        // `throw new Error(screen.reason)`, `throw check.reason`, and the
        // same off a safeStorageUpload result's `.error`. Comments are
        // stripped first: three guards in this repo have been satisfied by
        // their own prose.
        const thrown = new RegExp(
          `throw\\s+(?:new\\s+\\w*Error\\s*\\(\\s*)?${name}\\.(?:reason|error)\\b`,
        );
        expect(code).not.toMatch(thrown);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 3. The UI reads the returned reason, not a message off a thrown error.
// ---------------------------------------------------------------------------

describe('every caller of uploadExhibitAction reads the returned reason', () => {
  const callers = sourceFiles().filter((f) => {
    if (f.endsWith(path.join('lib', 'actions.ts'))) return false; // the definition
    return /\buploadExhibitAction\s*\(/.test(stripComments(readFileSync(f, 'utf8')));
  });

  it('finds its callers from source rather than from a list', () => {
    expect(callers.length).toBeGreaterThan(0);
  });

  for (const file of callers) {
    const rel = path.relative(ROOT, file);
    it(`${rel} does not surface err.message from the action`, () => {
      const code = stripComments(readFileSync(file, 'utf8'));
      // A UI that still reads .message off the rejection is showing the
      // person React's redacted sentence, which is the whole defect.
      expect(code).not.toMatch(/instanceof Error \? \w+\.message/);
      // And it has to actually read the returned reason.
      expect(code).toMatch(/\.error\b/);
    });
  }
});
