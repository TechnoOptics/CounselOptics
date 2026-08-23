import { describe, expect, it } from 'vitest';

/**
 * A transcript a person typed must never be mistaken for one the software
 * produced, and must still count as real content.
 *
 * These drive the pure module directly. No source text is matched here, so no
 * comment and no import line can satisfy them.
 *
 * Mutations that turn them red are recorded at the bottom of this file.
 */

import {
  MANUAL_TRANSCRIPT_EMPTY_MESSAGE,
  MANUAL_TRANSCRIPT_MODEL,
  MANUAL_TRANSCRIPT_READ_NOTE,
  MANUAL_TRANSCRIPT_SUMMARY_LEAD,
  MAX_MANUAL_TRANSCRIPT_CHARS,
  buildManualTranscriptScan,
  checkManualTranscript,
  isManualTranscript,
  packetTranscriptHeading,
  packetTranscriptNote,
  scanProvenanceLabel,
} from '../lib/manual-transcript';
import { isRealScan } from '../lib/types';
import {
  exhibitIsScannable,
  exhibitIsTranscribable,
  exhibitIsVideoRecording,
} from '../lib/exhibit-reading';

const NOW = '2026-08-22T10:00:00.000Z';

function scanOf(text: string, isVideo = false) {
  return buildManualTranscriptScan({ text, isVideo, now: NOW });
}

describe('the stored record says a person supplied the text', () => {
  it('does not put a model name in modelUsed', () => {
    const scan = scanOf('SPEAKER 1: I never signed that.');
    expect(scan.modelUsed).toBe(MANUAL_TRANSCRIPT_MODEL);
    expect(scan.modelUsed).not.toMatch(/whisper|claude|gpt|sonnet|opus/i);
  });

  it('marks readMethod as typed by a person, not as a machine read', () => {
    const scan = scanOf('SPEAKER 1: I never signed that.');
    expect(scan.readMethod).toBe('typed-by-person');
    expect(scan.readMethod).not.toBe('vision');
    expect(scan.readMethod).not.toBe('extracted-text');
  });

  it('carries a readNote that says a person wrote it and nobody checked it', () => {
    const scan = scanOf('SPEAKER 1: I never signed that.');
    expect(scan.readNote).toBe(MANUAL_TRANSCRIPT_READ_NOTE);
    expect(scan.readNote).toMatch(/typed or pasted in by the case owner/i);
    expect(scan.readNote).toMatch(/rather than produced by transcription software/i);
    expect(scan.readNote).toMatch(/has not been checked against it by anyone else/i);
  });

  it('leads the summary with the provenance, before any of the words', () => {
    // The summary is what the collapsed row shows and what lib/ai.ts prints to
    // the model under "Scanned:". If the transcript's own opening words came
    // first, that heading would read as the software's reading of the file.
    const scan = scanOf('SPEAKER 1: I never signed that.');
    expect(scan.summary.startsWith(MANUAL_TRANSCRIPT_SUMMARY_LEAD)).toBe(true);
    expect(scan.summary).toMatch(/typed in by the case owner/i);
  });

  it('is recognised as a person s transcript by either marker alone', () => {
    expect(isManualTranscript(scanOf('a'))).toBe(true);
    expect(isManualTranscript({ modelUsed: MANUAL_TRANSCRIPT_MODEL })).toBe(true);
    expect(isManualTranscript({ readMethod: 'typed-by-person' })).toBe(true);
  });

  it('does not mistake a machine transcript for a person s', () => {
    expect(isManualTranscript({ modelUsed: 'whisper-1' })).toBe(false);
    expect(isManualTranscript({ modelUsed: 'claude-sonnet', readMethod: 'vision' })).toBe(false);
    expect(isManualTranscript(null)).toBe(false);
    expect(isManualTranscript(undefined)).toBe(false);
  });

  it('labels the exhibit row and the packet differently for each origin', () => {
    const human = scanOf('a');
    const machine = { modelUsed: 'whisper-1' };
    expect(scanProvenanceLabel(human)).toBe('typed-by-person');
    expect(scanProvenanceLabel(machine)).toBe('machine');
    expect(packetTranscriptHeading(human)).not.toBe(packetTranscriptHeading(machine));
    expect(packetTranscriptHeading(human)).toMatch(/typed in by the case owner/i);
    expect(packetTranscriptHeading(machine)).toMatch(/transcription software/i);
    expect(packetTranscriptNote(human)).toMatch(/not.*produced by transcription software/i);
    expect(packetTranscriptNote(machine)).toMatch(/produced automatically/i);
  });
});

describe('a typed transcript is real content, not a placeholder', () => {
  it('passes the existing isRealScan rule', () => {
    // If it did not, describeExhibitsForPrompt, Bella and the packet readiness
    // count would all skip the text the person typed.
    expect(isRealScan(scanOf('SPEAKER 1: I never signed that.'))).toBe(true);
  });

  it('is not marked as a demo', () => {
    expect(scanOf('a').isDemo).toBeUndefined();
  });

  it('avoids the two modelUsed values isRealScan rejects', () => {
    expect(MANUAL_TRANSCRIPT_MODEL).not.toBe('demo');
    expect(MANUAL_TRANSCRIPT_MODEL).not.toBe('unsupported');
  });
});

describe('the text is stored exactly as it was typed', () => {
  const messy =
    '  [00:00:04] SPEAKER 1:   I never signed that.\r\n' +
    '\n' +
    '\n' +
    '[00:00:11] SPEAKER 2:\tYou did.   Twice.\n' +
    '   trailing spaces here   \n';

  it('does not reflow, trim, collapse blank lines or touch line endings', () => {
    const scan = scanOf(messy);
    expect(scan.transcript).toBe(messy);
  });

  it('keeps speaker labels and timestamps', () => {
    const scan = scanOf(messy);
    expect(scan.transcript).toContain('[00:00:04]');
    expect(scan.transcript).toContain('SPEAKER 2:');
  });

  it('returns the input unchanged from the check', () => {
    const res = checkManualTranscript(messy);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe(messy);
  });
});

describe('what happens at the edges', () => {
  it('refuses an empty box rather than clearing the transcript', () => {
    const res = checkManualTranscript('');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(MANUAL_TRANSCRIPT_EMPTY_MESSAGE);
  });

  it('refuses a box holding only whitespace', () => {
    for (const blank of ['   ', '\n\n\n', '\t \r\n ']) {
      const res = checkManualTranscript(blank);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe(MANUAL_TRANSCRIPT_EMPTY_MESSAGE);
    }
  });

  it('refuses a non-string rather than storing something odd', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(checkManualTranscript(bad).ok).toBe(false);
    }
  });

  it('accepts text right up to the limit', () => {
    const res = checkManualTranscript('x'.repeat(MAX_MANUAL_TRANSCRIPT_CHARS));
    expect(res.ok).toBe(true);
  });

  it('refuses past the limit and never truncates', () => {
    const long = 'x'.repeat(MAX_MANUAL_TRANSCRIPT_CHARS + 1);
    const res = checkManualTranscript(long);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // The refusal has to name both numbers, and say plainly that nothing
      // was cut. Silent truncation of evidence is the failure being avoided.
      expect(res.error).toContain((MAX_MANUAL_TRANSCRIPT_CHARS + 1).toLocaleString('en-US'));
      expect(res.error).toContain(MAX_MANUAL_TRANSCRIPT_CHARS.toLocaleString('en-US'));
      expect(res.error).toMatch(/nothing was cut/i);
    }
  });

  it('leaves room for a long recording', () => {
    // Near 900 characters a minute of speech with labels and timestamps.
    const hours = MAX_MANUAL_TRANSCRIPT_CHARS / 900 / 60;
    expect(hours).toBeGreaterThan(8);
  });
});

describe('the control belongs only on a recording', () => {
  const cases: Array<[string, { fileName: string; fileType: string }, boolean]> = [
    ['a PDF', { fileName: 'ticket.pdf', fileType: 'application/pdf' }, false],
    ['a photograph', { fileName: 'scene.jpg', fileType: 'image/jpeg' }, false],
    ['a spreadsheet', {
      fileName: 'costs.xlsx',
      fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }, false],
    ['a Word document', {
      fileName: 'letter.docx',
      fileType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }, false],
    ['a legacy .doc', { fileName: 'letter.doc', fileType: 'application/msword' }, false],
    ['an audio file', { fileName: 'call.mp3', fileType: 'audio/mpeg' }, true],
    ['a video file', { fileName: 'doorbell.mp4', fileType: 'video/mp4' }, true],
    ['a voice memo with no content type', { fileName: 'memo.m4a', fileType: '' }, true],
    ['a voice memo sent as octet-stream', {
      fileName: 'memo.m4a',
      fileType: 'application/octet-stream',
    }, true],
  ];

  for (const [what, exhibit, expected] of cases) {
    it(`${expected ? 'offers' : 'refuses'} it on ${what}`, () => {
      expect(exhibitIsTranscribable(exhibit)).toBe(expected);
    });
  }

  it('never offers both the scan control and the transcript control', () => {
    for (const [, exhibit] of cases) {
      expect(exhibitIsTranscribable(exhibit) && exhibitIsScannable(exhibit)).toBe(false);
    }
  });

  it('tells video apart from audio for the doc type', () => {
    expect(exhibitIsVideoRecording({ fileName: 'doorbell.mp4', fileType: 'video/mp4' })).toBe(true);
    expect(exhibitIsVideoRecording({ fileName: 'call.mp3', fileType: 'audio/mpeg' })).toBe(false);
    expect(exhibitIsVideoRecording({ fileName: 'ticket.pdf', fileType: 'application/pdf' })).toBe(
      false,
    );
  });

  it('stores a video transcript under the video doc type', () => {
    expect(scanOf('a', true).docType).toBe('video');
    expect(scanOf('a', true).suggestedCategory).toBe('Video');
    expect(scanOf('a', false).docType).toBe('voice_note');
    expect(scanOf('a', false).suggestedCategory).toBe('Audio');
  });
});

/*
 * MUTATIONS RUN AGAINST THIS FILE. Each was applied, confirmed red, reverted,
 * and `git diff --stat` confirmed empty afterwards.
 *
 *   Set MANUAL_TRANSCRIPT_MODEL to 'whisper-1', so a typed transcript claims
 *   to be the software's: red here, and red in
 *   tests/manual-transcript-action.test.ts.
 *
 *   Set MANUAL_TRANSCRIPT_MODEL to 'unsupported', so the transcript fails
 *   isRealScan and every consumer of scan_data skips it: red here.
 *
 *   Change exhibitIsTranscribable to return true for a 'vision' route, so the
 *   control appears on a PDF: red here.
 *
 *   Make checkManualTranscript trim, or slice to the cap instead of refusing:
 *   red here.
 */
