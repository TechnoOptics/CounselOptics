/**
 * Rule evaluation and answer validation for a built intake form.
 *
 * Both the browser renderer (for live feedback) and the server submit action
 * (for enforcement) import this. The server is the authority: a rule
 * evaluated only in the browser is not enforced.
 *
 * The behaviour that matters most: a hidden question is not required.
 * `validateAnswers` evaluates visibility first, then requiredness, and skips
 * every hidden question entirely, including its type constraints. Otherwise
 * an employee is blocked by a question they were never shown.
 */

import type { FormPayload, Question, QuestionConfig, Rule } from './form-schema';

export type Answers = Record<string, string | string[]>;

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

function findQuestionById(payload: FormPayload, id: string): Question | undefined {
  for (const row of payload.rows) {
    for (const q of row.fields) {
      if (q.id === id) return q;
    }
  }
  return undefined;
}

function isAnswered(value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value !== '';
}

/**
 * A rule is keyed by the controller's question `id` (`Rule.questionId`), but
 * answers are keyed by the controller's `key`. Resolve id to key before
 * looking the answer up: conflating the two is the most likely way to get
 * this wrong.
 *
 * An unanswered controller never satisfies a rule, whatever the operator, so
 * `neq` does not reveal a question before its controller has been touched.
 */
function ruleMatches(rule: Rule, payload: FormPayload, answers: Answers): boolean {
  const controller = findQuestionById(payload, rule.questionId);
  if (!controller) return false;

  const answer = answers[controller.key];
  const answered = isAnswered(answer);

  if (rule.op === 'answered') return answered;
  if (!answered) return false;

  const answerValue = Array.isArray(answer) ? answer.join(',') : answer;
  if (rule.op === 'eq') return answerValue === rule.value;
  if (rule.op === 'neq') return answerValue !== rule.value;
  return false;
}

export function isQuestionVisible(
  q: Question,
  payload: FormPayload,
  answers: Answers,
): boolean {
  if (!q.showWhen) return true;
  return ruleMatches(q.showWhen, payload, answers);
}

// ---------------------------------------------------------------------------
// Currency parsing: exact cents, no float multiply.
//
// Modelled on lib/trust-amount.ts's parseAmountToCents. Math.round(Number(s)
// * 100) rounds sub-cent input inconsistently (1.005 rounds down, 100.005
// rounds up, both binary floating point artifacts). On money, silent
// rounding is a known-bad pattern in this codebase, so this refuses anything
// it cannot represent exactly instead of guessing.
// ---------------------------------------------------------------------------

function parseCurrencyCents(raw: string): { ok: true; cents: number } | { ok: false; error: string } {
  const cleaned = raw.trim().replace(/[$\s,]/g, '');
  if (cleaned === '') {
    return { ok: false, error: 'Enter an amount.' };
  }

  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) {
    return { ok: false, error: 'Enter an amount as digits, for example 2500.00.' };
  }

  const negative = m[1] === '-';
  const whole = m[2] ?? '';
  const frac = m[3] ?? '';

  if (frac.length > 2) {
    return { ok: false, error: 'Use two decimal places or fewer, for example 2500.00.' };
  }

  const wholeCents = whole === '' ? 0 : Number(whole) * 100;
  const fracCents = frac === '' ? 0 : Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(wholeCents) || !Number.isSafeInteger(fracCents)) {
    return { ok: false, error: 'That amount is larger than this field can hold.' };
  }

  const magnitude = wholeCents + fracCents;
  return { ok: true, cents: negative ? -magnitude : magnitude };
}

function toNumber(v: number | string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function formatLimit(n: number): string {
  // Config limits are already well formed values (e.g. 0, 60, 99.99), so a
  // plain string conversion reads naturally in a sentence.
  return String(n);
}

// ---------------------------------------------------------------------------
// Per type constraint checks. Called only for a visible, answered question.
// ---------------------------------------------------------------------------

function asString(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s().-]{5,}$/;

function validateAnswerValue(q: Question, answer: string | string[]): string | undefined {
  const config: QuestionConfig = q.config;

  switch (q.type) {
    case 'short_text': {
      const s = asString(answer);
      if (config.maxChars !== undefined && s.length > config.maxChars) {
        return `Use ${config.maxChars} characters or fewer.`;
      }
      return undefined;
    }

    case 'long_text': {
      const s = asString(answer);
      if (config.maxWords !== undefined) {
        const words = s.trim().split(/\s+/).filter(Boolean);
        if (words.length > config.maxWords) {
          return `Use ${config.maxWords} words or fewer.`;
        }
      }
      if (config.maxChars !== undefined && s.length > config.maxChars) {
        return `Use ${config.maxChars} characters or fewer.`;
      }
      return undefined;
    }

    case 'email': {
      const s = asString(answer).trim();
      if (!EMAIL_RE.test(s)) return 'Enter a valid email address.';
      return undefined;
    }

    case 'phone': {
      const s = asString(answer).trim();
      if (!PHONE_RE.test(s)) return 'Enter a valid phone number.';
      return undefined;
    }

    case 'number': {
      const s = asString(answer).trim();
      if (!/^-?\d+(\.\d+)?$/.test(s)) return 'Enter a number.';
      const n = Number(s);
      const min = toNumber(config.min);
      const max = toNumber(config.max);
      if (min !== undefined && n < min) return `Enter ${formatLimit(min)} or more.`;
      if (max !== undefined && n > max) return `Enter ${formatLimit(max)} or less.`;
      return undefined;
    }

    case 'currency': {
      const s = asString(answer);
      const parsed = parseCurrencyCents(s);
      if (!parsed.ok) return parsed.error;
      const min = toNumber(config.min);
      const max = toNumber(config.max);
      if (min !== undefined && parsed.cents < Math.round(min * 100)) {
        return `Enter ${formatLimit(min)} or more.`;
      }
      if (max !== undefined && parsed.cents > Math.round(max * 100)) {
        return `Enter ${formatLimit(max)} or less.`;
      }
      return undefined;
    }

    case 'date':
    case 'time':
    case 'datetime': {
      // Config min/max are strings on these types (an ISO date, time, or
      // datetime), so ordinary string comparison against the typed value is
      // enough to bound the range without parsing a calendar.
      const s = asString(answer).trim();
      const min = typeof config.min === 'string' ? config.min : undefined;
      const max = typeof config.max === 'string' ? config.max : undefined;
      if (min !== undefined && s < min) return `Use ${min} or later.`;
      if (max !== undefined && s > max) return `Use ${max} or earlier.`;
      return undefined;
    }

    case 'select': {
      const s = asString(answer);
      const options = config.options ?? [];
      if (options.length > 0 && !options.includes(s)) {
        return 'Choose one of the listed options.';
      }
      return undefined;
    }

    case 'multiselect': {
      const values = Array.isArray(answer) ? answer : [answer];
      const options = config.options ?? [];
      if (options.length > 0 && values.some((v) => !options.includes(v))) {
        return 'Choose only from the listed options.';
      }
      return undefined;
    }

    case 'yesno':
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// validateAnswers
// ---------------------------------------------------------------------------

export function validateAnswers(
  payload: FormPayload,
  answers: Answers,
): { ok: true } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  for (const row of payload.rows) {
    for (const q of row.fields) {
      if (!isQuestionVisible(q, payload, answers)) continue;

      const answer = answers[q.key];
      if (!isAnswered(answer)) {
        if (q.required) errors[q.key] = 'This question is required.';
        continue;
      }

      const error = validateAnswerValue(q, answer);
      if (error) errors[q.key] = error;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true };
}
