/**
 * Advottic Review scoring engine.
 *
 * Pulls text out of an uploaded contract (PDF / Word / spreadsheet / plain text),
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

/** Upper bound on extracted spreadsheet text, so a huge workbook cannot flood
 *  storage or the model prompt. Generous enough for real evidence workbooks. */
const SHEET_CHAR_BUDGET = 200_000;
const SHEET_MAX_ROWS = 5_000;

/** Normalize one ExcelJS cell value to a plain string (dates, formulas with a
 *  cached result, hyperlinks, and rich text all collapse to readable text). */
function cellToString(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) {
    // Date-only vs datetime: drop the midnight time for clean day cells.
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
  }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text; // hyperlink cell
    if (Array.isArray(o.richText)) {
      return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? '').join('');
    }
    if ('result' in o && o.result != null) return cellToString(o.result); // formula: use cached result
    if (typeof o.formula === 'string') return `=${o.formula}`;
    if (o.error != null) return String(o.error);
    return '';
  }
  return String(v);
}

/** Flatten an ExcelJS workbook into readable, tab-separated text: one labelled
 *  block per sheet, empty rows dropped, bounded so it never runs away. */
function workbookToText(wb: import('exceljs').Workbook): string {
  const parts: string[] = [];
  let used = 0;
  let truncated = false;
  for (const ws of wb.worksheets) {
    if (used >= SHEET_CHAR_BUDGET) {
      truncated = true;
      break;
    }
    const rows: string[] = [];
    let rowCount = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rowCount >= SHEET_MAX_ROWS || used >= SHEET_CHAR_BUDGET) {
        truncated = true;
        return;
      }
      // row.values is 1-indexed (index 0 unused); drop trailing empties.
      const vals = (Array.isArray(row.values) ? row.values.slice(1) : []).map(cellToString);
      while (vals.length && vals[vals.length - 1] === '') vals.pop();
      if (vals.every((c) => c === '')) return; // skip blank rows
      const line = vals.join('\t');
      rows.push(line);
      rowCount += 1;
      used += line.length + 1;
    });
    if (rows.length === 0) continue;
    parts.push(`### Sheet: ${ws.name} (${rowCount} row${rowCount === 1 ? '' : 's'})\n${rows.join('\n')}`);
  }
  let text = parts.join('\n\n').slice(0, SHEET_CHAR_BUDGET);
  if (truncated) text += '\n\n[Spreadsheet truncated for length; not every row is shown.]';
  return text.trim();
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
    // Modern Excel workbooks (.xlsx / .xlsm): flatten every sheet to readable
    // tab-separated rows so the analysis reasons over the actual cell values.
    if (
      name.endsWith('.xlsx') ||
      name.endsWith('.xlsm') ||
      type.includes('spreadsheetml')
    ) {
      // exceljs ships as CommonJS; under ESM interop the class lives on
      // `.default`. Resolve both shapes so the import works in dev and build.
      const mod = (await import('exceljs')) as unknown as {
        Workbook?: typeof import('exceljs').Workbook;
        default?: { Workbook: typeof import('exceljs').Workbook };
      };
      const Workbook = mod.Workbook ?? mod.default?.Workbook;
      if (!Workbook) throw new Error('spreadsheet reader unavailable');
      const wb = new Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      return { text: workbookToText(wb), kind: 'spreadsheet' };
    }
    // CSV / TSV are already plain text; label them as spreadsheets so the
    // analysis treats them as tabular data, not prose.
    if (
      name.endsWith('.csv') ||
      name.endsWith('.tsv') ||
      type.includes('csv') ||
      type.includes('tab-separated')
    ) {
      const text = await file.text();
      return { text: text.slice(0, SHEET_CHAR_BUDGET), kind: 'spreadsheet' };
    }
    // Legacy binary Excel (.xls) and OpenDocument (.ods) are not read here on
    // purpose: the only libraries that parse them carry known prototype-
    // pollution / ReDoS advisories we will not run on untrusted uploads. Ask
    // for a safe re-export instead.
    if (
      name.endsWith('.xls') ||
      name.endsWith('.ods') ||
      type === 'application/vnd.ms-excel' ||
      type.includes('opendocument.spreadsheet')
    ) {
      return {
        text: '',
        kind: 'spreadsheet',
        error:
          'Legacy .xls and OpenDocument .ods spreadsheets cannot be read automatically. Save the file as .xlsx or CSV and re-upload.',
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
