import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './support/strip-comments';

/**
 * What the exhibit row is wired to, read off its source.
 *
 * The row is a client component full of hooks, and this suite runs on node
 * with no DOM and none may be added, so it cannot be rendered. The honesty
 * rules themselves are therefore NOT tested here: they live in
 * lib/manual-transcript.ts and are driven directly in
 * tests/manual-transcript-provenance.test.ts, where a mutation shows up as a
 * wrong string rather than as a missing call.
 *
 * What is left for this file is the wiring, and it is checked the hard way.
 * Comments are stripped first, because a guard in this repo has twice been
 * satisfied by the comment explaining the thing it was guarding. Every
 * assertion is on a CALL with its argument, never on a name, because an import
 * line names everything a file could possibly use.
 *
 * Mutations that turn them red are recorded at the bottom of this file.
 */

const SOURCE_PATH = fileURLToPath(
  new URL('../app/cases/[id]/exhibit-scan.tsx', import.meta.url),
);
const RAW = readFileSync(SOURCE_PATH, 'utf8');
const SRC = stripComments(RAW);

describe('the stripper actually ran on this file', () => {
  // A POSITIVE CONTROL. Every assertion below is on stripped source, so a
  // stripper that returned its input unchanged, or that ate the file, would
  // make the whole suite meaningless in one direction or the other. Both are
  // checked before anything is asserted about the wiring.
  it('removed comment text that is in the raw file', () => {
    expect(RAW).toContain('several phones send');
    expect(SRC).not.toContain('several phones send');
  });

  it('did not eat the code', () => {
    expect(SRC.length).toBeGreaterThan(RAW.length * 0.6);
    expect(SRC).toContain('export function ExhibitScan');
    expect(SRC).toContain('function TranscriptEditor');
  });
});

describe('the row asks the one classification, not a second copy of the rule', () => {
  it('calls exhibitIsTranscribable with the exhibit', () => {
    expect(SRC).toMatch(/exhibitIsTranscribable\(\s*exhibit\s*\)/);
  });

  it('no longer sniffs the content type by hand', () => {
    // The old rule. It refused a voice memo sent as application/octet-stream,
    // and it was a second answer to a question lib/exhibit-reading.ts already
    // answers. Both matter: a duplicated rule drifts, and this one had.
    expect(SRC).not.toMatch(/startsWith\(\s*'audio\//);
    expect(SRC).not.toMatch(/startsWith\(\s*'video\//);
  });
});

describe('the row does not print a typed transcript as the software s', () => {
  it('builds the provenance line by calling the shared helper', () => {
    expect(SRC).toMatch(/scanProvenanceLine\(\s*scan\s*,/);
  });

  it('does not print the model name itself anywhere', () => {
    // If the row still reached for scan.modelUsed it could print
    // "human-transcript" beside the word Scanned, which is the exact failure
    // the whole feature exists to prevent.
    expect(SRC).not.toContain('scan.modelUsed');
  });

  it('does not carry the typed-transcript marker as a literal', () => {
    expect(SRC).not.toContain('human-transcript');
  });

  it('titles the transcript by calling the shared heading', () => {
    expect(SRC).toMatch(/transcriptOriginHeading\(\s*scan\s*\)/);
  });

  it('does not title it with a bare unattributed heading', () => {
    expect(SRC).not.toMatch(/title=["']Transcript["']/);
  });

  it('asks whether the text was typed by a person by calling the shared rule', () => {
    expect(SRC).toMatch(/isManualTranscript\(\s*scan\s*\)/);
  });
});

describe('the control is offered only on a recording', () => {
  it('renders the editor only inside a branch that checked isMedia', () => {
    // `isMedia` is exhibitIsTranscribable(exhibit), asserted above. Each place
    // the editor is rendered has to sit under a test of it, or a transcript
    // box would appear on a parking ticket.
    const chunks = SRC.split('<TranscriptEditor');
    expect(chunks.length - 1).toBeGreaterThan(0);
    for (const before of chunks.slice(0, -1)) {
      expect(before.slice(-500)).toContain('isMedia');
    }
  });

  it('saves through the server action, which is where the real check is', () => {
    expect(SRC).toMatch(/saveManualTranscriptAction\(\s*exhibitId\s*,\s*text\s*\)/);
  });

  it('does not offer automatic re-transcription over a typed transcript', () => {
    // The action refuses it too, and that is the check that counts. This keeps
    // the row from showing a button whose only outcome is a refusal.
    expect(SRC).toMatch(/isMedia\s*&&\s*!typedByPerson/);
  });
});

/*
 * MUTATIONS RUN AGAINST THIS FILE. Each was applied, confirmed red, reverted,
 * and `git diff --stat` confirmed empty afterwards.
 *
 *   Put the old content-type sniff back in place of exhibitIsTranscribable:
 *   two tests go red.
 *
 *   Render the provenance line inline again, with scan.modelUsed beside the
 *   word Scanned: three tests go red.
 *
 *   Render <TranscriptEditor> outside the isMedia branch, so the box shows on
 *   a PDF: the branch test goes red.
 *
 *   Make stripComments return its input unchanged: the positive control goes
 *   red before any wiring assertion can pass for the wrong reason.
 */
