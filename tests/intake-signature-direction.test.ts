import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from './support/strip-comments';
import {
  INBOUND_ATTACHMENT_HELP,
  INBOUND_ATTACHMENT_LABEL,
  SIGNATURE_DIRECTION_CHOICES,
  SIGNATURE_DIRECTION_KEY,
  SIGNATURE_DIRECTION_QUESTION,
  isInboundSignature,
  readSignatureDirection,
  signatureDirectionLabel,
} from '../lib/intake-signature-direction';

/**
 * Which way a signature runs on a request.
 *
 * THE FACT THIS FILE PROTECTS. The answer lives in a jsonb column, so the
 * value reaching every reader is genuinely `unknown`: absent on every request
 * filed before the question existed, and whatever a future writer puts there
 * afterwards. All of that has to read as "not a signature question", because
 * the alternative is a queue that starts making claims about tickets nobody
 * answered the question on.
 *
 * The read is exercised DIRECTLY, which is the point of it being a pure
 * function. vitest here is environment: 'node' with no jsdom, so pure logic is
 * the only thing that can actually be run rather than read about.
 */

describe('readSignatureDirection', () => {
  it('reads the two real answers', () => {
    expect(readSignatureDirection('outbound')).toBe('outbound');
    expect(readSignatureDirection('inbound')).toBe('inbound');
  });

  it('reads an absent answer as no direction', () => {
    // Every request filed before this question existed arrives this way.
    expect(readSignatureDirection(undefined)).toBeNull();
    expect(readSignatureDirection(null)).toBeNull();
    expect(readSignatureDirection('')).toBeNull();
  });

  it('reads an unrecognised value as no direction', () => {
    expect(readSignatureDirection('sideways')).toBeNull();
    expect(readSignatureDirection('OUTBOUND')).toBeNull();
    expect(readSignatureDirection('Inbound')).toBeNull();
    expect(readSignatureDirection(' inbound ')).toBeNull();
    expect(readSignatureDirection(1)).toBeNull();
    expect(readSignatureDirection(true)).toBeNull();
    expect(readSignatureDirection({ direction: 'inbound' })).toBeNull();
    expect(readSignatureDirection(['inbound'])).toBeNull();
  });
});

describe('isInboundSignature', () => {
  it('is true only for the counterparty document case', () => {
    expect(isInboundSignature('inbound')).toBe(true);
    expect(isInboundSignature('outbound')).toBe(false);
    expect(isInboundSignature(null)).toBe(false);
    expect(isInboundSignature('sideways')).toBe(false);
  });
});

describe('signatureDirectionLabel', () => {
  it('names each real direction and stays silent on the rest', () => {
    expect(signatureDirectionLabel('outbound')).toBe('For outside signature');
    expect(signatureDirectionLabel('inbound')).toBe('Sent to us to sign');
    // No chip at all rather than a chip reading "none".
    expect(signatureDirectionLabel(null)).toBeNull();
    expect(signatureDirectionLabel(undefined)).toBeNull();
    expect(signatureDirectionLabel('sideways')).toBeNull();
  });
});

describe('the three answers offered', () => {
  it('are the two directions and the absence of one', () => {
    expect(SIGNATURE_DIRECTION_CHOICES.map((c) => c.value)).toEqual([
      'outbound',
      'inbound',
      '',
    ]);
  });

  /**
   * The third answer carries the empty string, and the empty string reads as
   * no direction. That equivalence is the whole reason a request filed today
   * and a request filed last year say the same thing about the same fact, so
   * it is asserted rather than left to the type.
   */
  it('third answer stores exactly what an absent key already means', () => {
    const third = SIGNATURE_DIRECTION_CHOICES[2];
    expect(readSignatureDirection(third.value)).toBe(
      readSignatureDirection(undefined),
    );
  });

  it('is the copy the owner wrote, verbatim', () => {
    expect(SIGNATURE_DIRECTION_QUESTION).toBe('Does this involve a signature?');
    expect(SIGNATURE_DIRECTION_CHOICES.map((c) => c.label)).toEqual([
      'We need someone outside the company to sign something.',
      'Someone outside the company has sent us something and wants us to sign it.',
      'Not a signature question.',
    ]);
    expect(INBOUND_ATTACHMENT_LABEL).toBe('Attach the document they sent');
    expect(INBOUND_ATTACHMENT_HELP).toBe(
      'Attach it exactly as you received it. Your legal team reads it as it stands and will not change their wording.',
    );
  });
});

/**
 * The wiring, read from source with COMMENTS STRIPPED FIRST.
 *
 * Every file below discusses this feature at length in prose, and this repo
 * has twice shipped a guard that its own explanatory comment satisfied. Each
 * assertion here is on a CALL - the function name followed by an open paren -
 * rather than on a name, because an import line naming a function has already
 * defeated one guard in this repo this week.
 */
const FORM = 'app/counsel/intake/create-intake-form.tsx';
const QUEUE = 'app/counsel/inbox/requests-table.tsx';
const QUEUE_PAGE = 'app/counsel/inbox/page.tsx';
const TICKET = 'app/counsel/intake/[id]/page.tsx';
const read = (rel: string) =>
  stripComments(readFileSync(join(__dirname, '..', rel), 'utf8'));

describe('the form records the answer', () => {
  it('calls the shared read rather than comparing strings itself', () => {
    expect(read(FORM)).toContain('readSignatureDirection(directionChoice)');
  });

  it('writes it into intake_answers under the one key', () => {
    const src = read(FORM);
    expect(src).toContain('intakeAnswers[SIGNATURE_DIRECTION_KEY]');
    expect(SIGNATURE_DIRECTION_KEY).toBe('signature_direction');
  });

  /**
   * The direction is a jsonb field and nothing else. lib/intake-workflow.ts
   * lines 5 to 28 set out why the seven-value CHECK on `status` is not widened:
   * ten importers and two crons read those seven words. A form that started
   * writing a status here would be the change that breaks them.
   */
  it('does not write a status or a workflow state', () => {
    const src = read(FORM);
    expect(src).not.toContain('workflow_state');
    expect(src).not.toContain("status: '");
  });

  it('drives the attachment field off the shared inbound read', () => {
    const src = read(FORM);
    expect(src).toContain('isInboundSignature(directionChoice)');
    expect(src).toContain('INBOUND_ATTACHMENT_LABEL');
    expect(src).toContain('INBOUND_ATTACHMENT_HELP');
  });
});

describe('the chip on both screens', () => {
  it('the queue row derives its chip from the shared label', () => {
    expect(read(QUEUE)).toContain('signatureDirectionLabel(');
  });

  it('the queue page reads the jsonb through the shared read', () => {
    expect(read(QUEUE_PAGE)).toContain(
      'readSignatureDirection(answers.signature_direction)',
    );
  });

  it('the ticket derives its chip from the shared label', () => {
    expect(read(TICKET)).toContain(
      'signatureDirectionLabel(ans.signature_direction)',
    );
  });
});
