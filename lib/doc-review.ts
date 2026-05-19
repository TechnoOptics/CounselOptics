/**
 * Advottic Review scoring engine.
 *
 * Pulls text out of an uploaded contract (PDF / Word / plain text),
 * then runs it through the model with the firm's jurisdiction +
 * matter context to produce a structured scorecard: a letter grade,
 * a bias reading, concrete vulnerabilities, state-law relevance, and
 * suggested rewordings. The employee intake form gates submission on
 * the grade (C or higher passes; D / F is blocked until revised).
 */
import { bellaGenerate } from './bella';
import { cleanLegalText } from './legal-templates';

export type DocGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export type DocScorecard = {
  grade: DocGrade;
  /** Per the firm rule: C or higher may be submitted; D / F cannot. */
  passes: boolean;
  /** 0 = perfectly balanced, 100 = heavily one-sided. */
  biasScore: number;
  /** Plain-English: which side the document favors. */
  biasToward: string;
  /** One or two sentences, plain English. */
  summary: string;
  vulnerabilities: string[];
  /** Relevance to the matter's state / case / content. */
  stateLawNotes: string;
  /** Concrete rewordings / changes to raise the grade. */
  suggestedRevisions: string[];
};

const GRADE_ORDER: DocGrade[] = ['A', 'B', 'C', 'D', 'F'];

/** C or higher passes (firm rule). */
export function gradePasses(g: DocGrade): boolean {
  return g === 'A' || g === 'B' || g === 'C';
}

/** Extract plain text from an uploaded file (best-effort, Node). */
export async function extractFileText(
  file: File,
): Promise<{ text: string; kind: string; error?: string }> {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  try {
    if (name.endsWith('.pdf') || type.includes('pdf')) {
      const { getDocumentProxy, extractText } = await import('unpdf');
      const buf = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(buf);
      const res = await extractText(pdf, { mergePages: true });
      const text = Array.isArray(res.text)
        ? res.text.join('\n')
        : String(res.text ?? '');
      return { text, kind: 'pdf' };
    }
    if (
      name.endsWith('.docx') ||
      type.includes('officedocument.wordprocessing')
    ) {
      const mammoth = await import('mammoth');
      const ab = await file.arrayBuffer();
      const { value } = await mammoth.extractRawText({
        buffer: Buffer.from(ab),
      });
      return { text: value ?? '', kind: 'docx' };
    }
    if (
      name.endsWith('.doc') ||
      type === 'application/msword'
    ) {
      return {
        text: '',
        kind: 'doc',
        error:
          'Legacy .doc files cannot be read automatically. Save as PDF or .docx and re-upload, or paste the text.',
      };
    }
    // Plain-text family.
    const text = await file.text();
    return { text, kind: 'text' };
  } catch (err) {
    return {
      text: '',
      kind: 'unknown',
      error:
        err instanceof Error
          ? `Could not read the file (${err.message}).`
          : 'Could not read the file.',
    };
  }
}

function clampGrade(v: unknown): DocGrade {
  const s = String(v ?? '').trim().toUpperCase().slice(0, 1);
  return (GRADE_ORDER as string[]).includes(s) ? (s as DocGrade) : 'C';
}

function strArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => cleanLegalText(String(x)).trim())
    .filter(Boolean)
    .slice(0, max);
}

/** Score a contract's text into a structured scorecard. */
export async function scoreDocument(opts: {
  text: string;
  matterType?: string | null;
  state?: string | null;
  firmName?: string | null;
  jurisdictions?: string[];
  practiceAreas?: string[];
}): Promise<DocScorecard | { error: string }> {
  const text = opts.text.trim();
  if (text.length < 120) {
    return {
      error:
        'There was not enough readable text to review. Upload a PDF, Word, or text file with the full contract, or paste the text.',
    };
  }
  const ctxBits: string[] = [];
  if (opts.matterType) ctxBits.push(`Request type: ${opts.matterType}.`);
  if (opts.state) ctxBits.push(`Governing/relevant state: ${opts.state}.`);
  if (opts.jurisdictions?.length)
    ctxBits.push(`Firm jurisdictions: ${opts.jurisdictions.join(', ')}.`);
  if (opts.practiceAreas?.length)
    ctxBits.push(`Firm practice areas: ${opts.practiceAreas.join(', ')}.`);

  const system =
    'You are a senior contracts attorney doing a fast, rigorous review. ' +
    'You read between the lines and surface what a non-lawyer would miss. ' +
    'You are jurisdiction-aware. You output ONLY valid minified JSON, no ' +
    'prose, no code fences, no markdown. Never use em dashes.';

  const prompt = `Review the CONTRACT below and return ONLY this JSON object:
{"grade":"A|B|C|D|F","biasScore":0-100,"biasToward":"<which party it favors, plain English>","summary":"<1-2 sentence plain-English read>","vulnerabilities":["<concrete risk / hidden-consequence clause>", "..."],"stateLawNotes":"<how it squares with the relevant state's law for this matter; flag unenforceable / disfavored terms>","suggestedRevisions":["<specific reword or change to raise the grade>", "..."]}

Grading rubric:
A = balanced, low risk, enforceable, well-drafted.
B = solid with minor one-sided or ambiguous terms.
C = workable but materially one-sided or with notable gaps.
D = significantly unfavorable / risky / likely unenforceable terms.
F = severely one-sided, dangerous, or fundamentally defective.

Context: ${ctxBits.join(' ') || 'No extra context.'}

CONTRACT:
"""
${text.slice(0, 22000)}
"""`;

  let raw: string;
  try {
    raw = await bellaGenerate({ system, prompt, maxTokens: 1600 });
  } catch {
    return { error: 'The review service is busy. Try again in a moment.' };
  }
  // Defensive JSON extraction (strip fences, grab the first object).
  let jsonStr = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '');
  const a = jsonStr.indexOf('{');
  const b = jsonStr.lastIndexOf('}');
  if (a !== -1 && b !== -1 && b > a) jsonStr = jsonStr.slice(a, b + 1);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return {
      error: 'Could not parse the review. Please try running it again.',
    };
  }
  const grade = clampGrade(parsed.grade);
  let biasScore = Number(parsed.biasScore);
  if (!Number.isFinite(biasScore)) biasScore = 50;
  biasScore = Math.max(0, Math.min(100, Math.round(biasScore)));
  return {
    grade,
    passes: gradePasses(grade),
    biasScore,
    biasToward:
      cleanLegalText(String(parsed.biasToward ?? '')).trim() ||
      'Not clearly one-sided.',
    summary:
      cleanLegalText(String(parsed.summary ?? '')).trim() ||
      'Review completed.',
    vulnerabilities: strArray(parsed.vulnerabilities),
    stateLawNotes:
      cleanLegalText(String(parsed.stateLawNotes ?? '')).trim() ||
      'No state-specific concerns flagged.',
    suggestedRevisions: strArray(parsed.suggestedRevisions),
  };
}
