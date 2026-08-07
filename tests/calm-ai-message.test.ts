import { describe, expect, it } from 'vitest';
import { AiUnavailableError, calmAiMessage } from '../lib/ai-errors';

/**
 * Which failures may speak for themselves, and which may not.
 *
 * bellaGenerate wraps the PROVIDER call in a try and throws
 * AiUnavailableError, whose message was written for a person. Everything
 * around that call is unwrapped and throws plain Errors written for an
 * engineer, and the one that matters is thrown before the request is ever
 * made: `The server is missing an ANTHROPIC_API_KEY.` On a deploy with the key
 * unset or rotated, a call site that forwards err.message shows a firm admin
 * the state of our environment variables in a red box.
 *
 * So the default is the caller's own calm sentence, and passing your own
 * message through is the exception a type has to earn.
 */

const FALLBACK = 'The letterhead reader is unavailable right now.';

describe('calmAiMessage', () => {
  it('lets AiUnavailableError speak, because its copy is already for a person', () => {
    const err = new AiUnavailableError(
      Object.assign(new Error('400 {"type":"error","error":{"message":"credit balance too low"}}'), {
        status: 400,
      }),
      'bellaGenerate',
    );
    expect(calmAiMessage(err, FALLBACK)).toBe(err.message);
    expect(calmAiMessage(err, FALLBACK)).not.toBe(FALLBACK);
  });

  it('refuses the configuration error bellaGenerate throws before it calls out', () => {
    // The exact throw at lib/bella.ts, verbatim. This is the one that reaches
    // a firm admin on a deploy with no key.
    const err = new Error('The server is missing an ANTHROPIC_API_KEY.');
    expect(calmAiMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it('refuses any other plain Error, including raw provider JSON', () => {
    expect(
      calmAiMessage(new Error('400 {"type":"error","error":{"message":"..."}}'), FALLBACK),
    ).toBe(FALLBACK);
    expect(calmAiMessage(new TypeError('res.content is not a function'), FALLBACK)).toBe(
      FALLBACK,
    );
  });

  it('refuses non-Errors, including a thrown string that looks like copy', () => {
    expect(calmAiMessage('Something went wrong on the server', FALLBACK)).toBe(FALLBACK);
    expect(calmAiMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(calmAiMessage({ message: 'not an Error' }, FALLBACK)).toBe(FALLBACK);
  });

  it('refuses an AiUnavailableError whose message somehow came back empty', () => {
    const err = new AiUnavailableError(new Error('x'));
    Object.defineProperty(err, 'message', { value: '   ' });
    expect(calmAiMessage(err, FALLBACK)).toBe(FALLBACK);
  });
});
