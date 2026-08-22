import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PNG, JPEG and PDF still read the way they did.
 *
 * Adding spreadsheets and Word documents meant moving the "which reader does
 * this file go to" decision out of lib/actions.ts and into
 * lib/exhibit-reading.ts, including the MIME normalisation that let a file
 * uploaded as octet-stream still reach the vision model. That is exactly the
 * kind of move that quietly breaks the path it was not about.
 *
 * The files here are REAL bytes off disk: a PNG shipped in public/, a JPEG
 * written by the operating system, and a PDF built by pdf-lib. What is faked
 * is only the network call, so the assertions cover the whole path from the
 * file's bytes to the exact content block the model is sent: its type, its
 * media_type, and the payload being the file unmodified.
 *
 * What this canNOT show is that the model still returns good metadata for a
 * photograph. That needs a live call, and this change does not touch the
 * prompt, the tool schema or the parsing that a live call would exercise.
 */

const seen = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async (body: Record<string, unknown>) => {
        seen.last = body;
        return {
          model: 'test-model',
          content: [
            {
              type: 'tool_use',
              name: 'submit_scan',
              input: {
                docType: 'photo',
                identifiers: {},
                parties: [],
                dates: [],
                summary: 'A photograph.',
                suggestedCategory: 'Photo',
              },
            },
          ],
        };
      },
    };
  },
}));

const { scanDocument } = await import('../lib/ai');
const { PDFDocument } = await import('pdf-lib');

/** The file block in the single user turn the model was sent. */
function filePart(): Record<string, unknown> {
  const messages = (seen.last?.messages ?? []) as Array<{
    content: Array<Record<string, unknown>>;
  }>;
  return messages[0]?.content?.[0] ?? {};
}

const PNG_BYTES = readFileSync(path.join(process.cwd(), 'public/advottic-mark.png'));
const JPEG_BYTES = readFileSync(path.join(process.cwd(), 'tests/fixtures/one-mark.jpg'));

beforeEach(() => {
  seen.last = null;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
});

describe('the real bytes of a real file still reach the vision model', () => {
  it('proves the fixtures are the file types they claim to be', () => {
    expect(PNG_BYTES.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(JPEG_BYTES.subarray(0, 3).toString('hex')).toBe('ffd8ff');
    expect(JPEG_BYTES.subarray(6, 10).toString('ascii')).toBe('JFIF');
  });

  it('sends a PNG as an image block carrying the file unmodified', async () => {
    const scan = await scanDocument({
      fileBuffer: PNG_BYTES,
      mediaType: 'image/png',
      fileName: 'scene.png',
    });

    const part = filePart();
    expect(part.type).toBe('image');
    expect((part.source as Record<string, unknown>).media_type).toBe('image/png');
    expect((part.source as Record<string, unknown>).data).toBe(
      PNG_BYTES.toString('base64'),
    );
    expect(scan.summary).toBe('A photograph.');
    expect(scan.readMethod).toBe('vision');
  });

  it('sends a JPEG as an image block carrying the file unmodified', async () => {
    await scanDocument({
      fileBuffer: JPEG_BYTES,
      mediaType: 'image/jpeg',
      fileName: 'scene.jpg',
    });

    const part = filePart();
    expect(part.type).toBe('image');
    expect((part.source as Record<string, unknown>).media_type).toBe('image/jpeg');
    expect((part.source as Record<string, unknown>).data).toBe(
      JPEG_BYTES.toString('base64'),
    );
  });

  it('sends a PDF as a document block carrying the file unmodified', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]).drawText('Notice of hearing');
    const bytes = Buffer.from(await doc.save());
    expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    await scanDocument({
      fileBuffer: bytes,
      mediaType: 'application/pdf',
      fileName: 'notice.pdf',
    });

    const part = filePart();
    expect(part.type).toBe('document');
    expect((part.source as Record<string, unknown>).media_type).toBe('application/pdf');
    expect((part.source as Record<string, unknown>).data).toBe(bytes.toString('base64'));
  });

  it('still asks for the same tool, with the same system prompt breakpoint', async () => {
    await scanDocument({
      fileBuffer: PNG_BYTES,
      mediaType: 'image/png',
      fileName: 'scene.png',
    });

    expect(seen.last?.tool_choice).toEqual({ type: 'tool', name: 'submit_scan' });
    const system = seen.last?.system as Array<Record<string, unknown>>;
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(String(system[0].text)).toMatch(/document scanner/i);
  });
});
