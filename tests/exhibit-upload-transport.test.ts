import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';
import {
  chooseExhibitTransport,
  directUploadFailureMessage,
  EXHIBIT_MAX_BYTES,
  SERVERLESS_REQUEST_BODY_LIMIT_BYTES,
  SERVER_ACTION_SAFE_BYTES,
} from '../lib/upload-transport';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => stripComments(read(p));

const MB = 1024 * 1024;

/**
 * THE DIAGNOSIS.
 *
 * The symptom was an audio exhibit that would not upload, showing "That
 * upload did not reach us. Check your connection and try again." That
 * sentence is the catch branch of the upload form, which fires only when the
 * server action call REJECTS. A file our code refuses comes back as a value
 * with a reason, so a rejection means the request itself never completed.
 *
 * The cause is a size limit that is not any of the limits the code names.
 * next.config permits 50mb of server-action body and the action permits a
 * 50MB file, but the serverless platform caps a function's request body at
 * about 4.5MB before either of those is consulted. The tests below pin that
 * relationship, because it is the thing every other part of this fix depends
 * on: the ceiling the product promises is more than ten times the size of the
 * pipe the old transport used.
 */
describe('exhibit upload transport: the diagnosis', () => {
  it('promises a ceiling far above the serverless request body cap', () => {
    expect(EXHIBIT_MAX_BYTES).toBe(50 * MB);
    expect(SERVERLESS_REQUEST_BODY_LIMIT_BYTES).toBeLessThan(5 * MB);
    // This inequality IS the bug: a transport that puts the file in the
    // request body cannot deliver the promised ceiling, whatever the
    // framework config claims.
    expect(EXHIBIT_MAX_BYTES).toBeGreaterThan(SERVERLESS_REQUEST_BODY_LIMIT_BYTES);
  });

  it('keeps the server-action ceiling strictly below the platform cap, with headroom', () => {
    // Not equal to the cap: the body also carries multipart framing, the
    // action's argument encoding and five other form fields.
    expect(SERVER_ACTION_SAFE_BYTES).toBeLessThan(SERVERLESS_REQUEST_BODY_LIMIT_BYTES);
    expect(SERVERLESS_REQUEST_BODY_LIMIT_BYTES - SERVER_ACTION_SAFE_BYTES).toBeGreaterThan(
      256 * 1024,
    );
  });

  it('records that next.config alone cannot fix this', () => {
    // The config value is real and is left in place; the point of the test is
    // that its presence is not evidence the limit was raised.
    const cfg = code('next.config.mjs');
    expect(cfg).toMatch(/bodySizeLimit/);
    expect(SERVER_ACTION_SAFE_BYTES).toBeLessThan(50 * MB);
  });
});

describe('chooseExhibitTransport', () => {
  it('sends an ordinary small file through the unchanged server action path', () => {
    expect(chooseExhibitTransport(1)).toEqual({ transport: 'server_action' });
    expect(chooseExhibitTransport(3.81 * MB)).toEqual({ transport: 'server_action' });
    // Exactly at the boundary still goes through the server action.
    expect(chooseExhibitTransport(SERVER_ACTION_SAFE_BYTES)).toEqual({
      transport: 'server_action',
    });
  });

  it('sends anything the request body cannot carry straight to storage', () => {
    expect(chooseExhibitTransport(SERVER_ACTION_SAFE_BYTES + 1)).toEqual({
      transport: 'direct',
    });
    expect(chooseExhibitTransport(12 * MB)).toEqual({ transport: 'direct' });
    expect(chooseExhibitTransport(40.15 * MB)).toEqual({ transport: 'direct' });
    expect(chooseExhibitTransport(EXHIBIT_MAX_BYTES)).toEqual({ transport: 'direct' });
  });

  it('refuses above the promised ceiling, and refuses nothing', () => {
    const over = chooseExhibitTransport(EXHIBIT_MAX_BYTES + 1);
    expect(over.transport).toBe('refuse');
    expect(over.transport === 'refuse' && over.reason).toMatch(/50MB/);

    expect(chooseExhibitTransport(0).transport).toBe('refuse');
    expect(chooseExhibitTransport(-1).transport).toBe('refuse');
    expect(chooseExhibitTransport(Number.NaN).transport).toBe('refuse');
  });

  it('never routes a file above the platform cap through the request body', () => {
    // The property that matters, asserted over a sweep rather than at a
    // single point: if the decision says 'server_action', the file fits.
    for (let bytes = 1; bytes <= 50 * MB; bytes += 97_003) {
      const choice = chooseExhibitTransport(bytes);
      if (choice.transport === 'server_action') {
        expect(bytes).toBeLessThan(SERVERLESS_REQUEST_BODY_LIMIT_BYTES);
      }
    }
  });
});

describe('directUploadFailureMessage', () => {
  it('names the stage instead of blaming the connection', () => {
    for (const stage of ['mint', 'transfer', 'finalize'] as const) {
      const msg = directUploadFailureMessage(stage, null);
      expect(msg.length).toBeGreaterThan(20);
      // The sentence being fixed. A 40MB upload that dies late must never be
      // reported as a connectivity problem when it was not one.
      expect(msg).not.toMatch(/did not reach us/i);
      expect(msg).not.toMatch(/check your connection/i);
    }
  });

  it('prefers the server reason when there is one', () => {
    expect(directUploadFailureMessage('finalize', 'HTML/SVG content is not an accepted document type.')).toBe(
      'HTML/SVG content is not an accepted document type.',
    );
    expect(directUploadFailureMessage('mint', '   ')).toMatch(/could not start/i);
  });

  it('tells someone whose transfer died that nothing was saved', () => {
    expect(directUploadFailureMessage('transfer')).toMatch(/nothing was saved/i);
  });
});
