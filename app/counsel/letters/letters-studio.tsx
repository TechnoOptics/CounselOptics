'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_LETTER_OPTIONS,
  LETTER_DRAFT_NOTICE,
  buildClosingLines,
  closingLinesToText,
  type LetterOptions,
} from '@/lib/letter-compose';
import { saveLetterToCaseAction } from '@/lib/letters-actions';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { PdfPreviewDialog } from '@/components/PdfPreviewDialog';
import { runGatedAction } from '@/lib/gated-action';
import {
  LETTERHEAD_LINE_GAP_PT,
  LETTERHEAD_PT_TO_PX,
  letterheadDesignLines,
  type LetterheadDesign,
} from '@/lib/letterhead-design';
import { accentTextOnDocument } from '@/lib/accent-text';
import { formatDateLong, formatDateNumeric } from '@/lib/format';

type Brand = {
  firmName: string;
  logoUrl: string | null;
  letterheadUrl: string | null;
  /** The letterhead the firm designed under /counsel/settings, if any. */
  letterheadDesign: LetterheadDesign | null;
  accent: string;
};

type CaseOption = { id: string; title: string };

const TOGGLES: Array<{ key: keyof LetterOptions; label: string }> = [
  { key: 'includeName', label: 'Name' },
  { key: 'includeTitle', label: 'Title' },
  { key: 'includeDate', label: 'Date' },
  { key: 'includeSignature', label: 'Signature space' },
  { key: 'includeSigningLine', label: 'Signing line' },
  { key: 'includeWitness', label: 'Witness' },
];

export function LettersStudio({
  brand,
  cases,
  initialCaseId,
}: {
  brand: Brand;
  cases: CaseOption[];
  initialCaseId?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [recipient, setRecipient] = useState('');
  const [tone, setTone] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [dateText, setDateText] = useState(
    formatDateLong(Date.now()),
  );
  const [caseId, setCaseId] = useState(initialCaseId ?? '');
  const [options, setOptions] = useState<LetterOptions>(DEFAULT_LETTER_OPTIONS);

  const [body, setBody] = useState('');
  const [title, setTitle] = useState('Letter');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const closer = {
    signerName: signerName || null,
    signerTitle: signerTitle || null,
    dateText: dateText || null,
  };
  const closingText = closingLinesToText(buildClosingLines(options, closer));
  // The exported PDF carries the draft notice so the caveat travels with
  // the file, not just the on-screen studio. (Audit Content M3.)
  const composed = body
    ? `${body.trim()}\n\n\n${closingText}\n\n\n${LETTER_DRAFT_NOTICE}`
    : '';

  function toggle(key: keyof LetterOptions) {
    setOptions((o) => ({ ...o, [key]: !o[key] }));
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const res = await fetch('/api/counsel/draft-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, recipient, tone, caseId: caseId || undefined }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || t('Could not generate the letter.'));
        return;
      }
      setBody(j.body);
    } catch {
      setError(t('Network error - try again.'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * The letter as a PDF, in ONE place.
   *
   * The preview and the Export PDF button used to each post their own copy of
   * this payload, side by side, agreeing by inspection. A preview that agrees
   * with the export only by inspection is a preview that stops agreeing the
   * first time one of the two is edited, and the whole value of previewing a
   * document before it leaves the firm is that the bytes are the same bytes.
   */
  async function buildPdfBlob(): Promise<Blob> {
    const res = await fetch('/api/counsel/draft-template/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: composed,
        title,
        firmName: brand.firmName,
        accent: brand.accent,
        letterheadUrl: brand.letterheadUrl ?? undefined,
        logoUrl: brand.logoUrl ?? undefined,
      }),
    });
    if (!res.ok) throw new Error(`PDF ${t('export failed.')}`);
    return res.blob();
  }

  async function exportFile(format: 'pdf' | 'docx') {
    if (!composed) return;
    setExporting(format);
    setError(null);
    try {
      let blob: Blob;
      if (format === 'pdf') {
        try {
          blob = await buildPdfBlob();
        } catch {
          setError(`PDF ${t('export failed.')}`);
          return;
        }
      } else {
        const res = await fetch('/api/counsel/letters/docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            body,
            options,
            signerName,
            signerTitle,
            dateText,
          }),
        });
        if (!res.ok) {
          setError(`DOCX ${t('export failed.')}`);
          return;
        }
        blob = await res.blob();
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(title || 'letter').replace(/[^a-z0-9]+/gi, '-')}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }

  function save() {
    setError(null);
    setSaved(null);
    startSaving(async () => {
      const res = await runGatedAction(() => saveLetterToCaseAction({
        title,
        body,
        options,
        signerName,
        signerTitle,
        dateText,
        caseId: caseId || null,
      }));
      if (res.ok) {
        setSaved(
          caseId
            ? t('Saved to the case as a Word document.')
            : t('Saved to your documents as a Word document.'),
        );
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save the letter.'));
      }
    });
  }

  return (
    <div className="grid lg:grid-cols-[380px,1fr] gap-6">
      {/* Builder */}
      <div className="card p-5 space-y-4 self-start">
        <label className="block">
          <span className="label"><T>Document title</T></span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('Letter')}
          />
        </label>

        <label className="block">
          <span className="label"><T>What should the letter say?</T></span>
          <textarea
            rows={5}
            className="input resize-y"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('e.g. A demand that the tenant cure the unpaid rent of $2,400 within 10 days, referencing the lease dated Jan 3, 2025.')}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label"><T>Recipient</T></span>
            <input
              className="input"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={t('Jane Roe')}
            />
          </label>
          <label className="block">
            <span className="label"><T>Tone (optional)</T></span>
            <input
              className="input"
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              placeholder={t('firm, cordial…')}
            />
          </label>
        </div>

        {cases.length > 0 && (
          <label className="block">
            <span className="label"><T>Attach to a case (optional)</T></span>
            <select
              className="input"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
            >
              <option value=""><T>Not attached</T></option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={generate}
          disabled={busy || prompt.trim().length < 8}
          className="btn-primary w-full"
        >
          {busy ? <T>Drafting…</T> : body ? <T>Regenerate</T> : <T>Generate letter</T>}
        </button>

        <div className="border-t border-edge pt-4 space-y-3">
          <p className="label"><T>Signature block</T></p>
          <div className="grid grid-cols-2 gap-3">
            <input
              className="input"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder={t('Signer name')}
            />
            <input
              className="input"
              value={signerTitle}
              onChange={(e) => setSignerTitle(e.target.value)}
              placeholder={t('Title')}
            />
          </div>
          <input
            className="input"
            value={dateText}
            onChange={(e) => setDateText(e.target.value)}
            placeholder={t('Date')}
          />
          <div className="flex flex-wrap gap-1.5">
            {TOGGLES.map((tg) => (
              <button
                key={tg.key}
                type="button"
                onClick={() => toggle(tg.key)}
                aria-pressed={options[tg.key]}
                className={`text-[12px] rounded-full px-2.5 py-1 ring-1 transition-colors ${
                  options[tg.key]
                    ? 'bg-gold-500/20 ring-gold-500/40 text-gold-700 dark:text-gold-200'
                    : 'ring-edge text-muted'
                }`}
              >
                {options[tg.key] ? '✓ ' : ''}
                <T>{tg.label}</T>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-[12px] text-danger-text">{error}</p>
        )}
        {saved && (
          <p className="text-[12px] text-emerald-700 dark:text-emerald-300">
            {saved}
          </p>
        )}
        <p className="text-[11px] text-muted leading-relaxed">
          <T>Drafted as your firm&rsquo;s work product. A licensed attorney should review before it is sent or filed.</T>
        </p>
      </div>

      {/* Preview */}
      <div>
        {body ? (
          <>
            <div className="no-print flex flex-wrap items-center justify-end gap-2 mb-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(composed)}
                className="text-[12px] rounded-md ring-1 ring-edge px-3 py-1.5 text-foreground"
              >
                <T>Copy text</T>
              </button>
              <button
                type="button"
                onClick={() => exportFile('docx')}
                disabled={exporting !== null}
                className="text-[13px] rounded-md ring-1 ring-edge px-3 py-1.5 text-foreground"
              >
                {exporting === 'docx' ? <T>Exporting…</T> : <T>Export Word</T>}
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="text-[13px] rounded-md ring-1 ring-edge px-3 py-1.5 text-foreground"
              >
                <T>Preview PDF</T>
              </button>
              <button
                type="button"
                onClick={() => exportFile('pdf')}
                disabled={exporting !== null}
                className="text-[13px] rounded-md ring-1 ring-edge px-3 py-1.5 text-foreground"
              >
                {exporting === 'pdf' ? <T>Exporting…</T> : <T>Export PDF</T>}
              </button>
              {previewOpen && (
                <PdfPreviewDialog
                  title={title || 'Letter'}
                  filename={`${(title || 'letter').replace(/[^a-z0-9]+/gi, '-')}.pdf`}
                  buildPdf={buildPdfBlob}
                  onClose={() => setPreviewOpen(false)}
                  /* Said plainly, because it is the one place this preview
                     could mislead: these are the bytes Export PDF produces,
                     and Save produces a different file. */
                  note={
                    <T>
                      This is the PDF export, to the byte. Saving the letter files it as
                      a Word document instead, because a letter is meant to be edited:
                      the words and the draft notice are the same, but Word lays the
                      page out its own way.
                    </T>
                  }
                />
              )}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="btn-primary !py-1.5 text-[13px]"
              >
                {saving ? <T>Saving…</T> : caseId ? <T>Save to case</T> : <T>Save to documents</T>}
              </button>
            </div>

            <article className="bg-surface text-[#15110a] rounded-lg ring-1 ring-edge shadow-card overflow-hidden">
              <div
                className="px-8 py-5 flex items-center gap-3"
                style={{ borderTop: `6px solid ${brand.accent}`, background: '#fbfaf6' }}
              >
                {brand.letterheadUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={brand.letterheadUrl}
                    alt={brand.firmName}
                    className="h-12 w-auto max-w-[280px] object-contain"
                  />
                ) : brand.letterheadDesign ? (
                  <div className="flex-1 min-w-0">
                    <LetterheadDesignBlock
                      design={brand.letterheadDesign}
                      accent={brand.accent}
                    />
                  </div>
                ) : (
                  <>
                    {brand.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={brand.logoUrl}
                        alt={brand.firmName}
                        className="h-9 w-auto max-w-[140px] object-contain"
                      />
                    ) : null}
                    {/* accentTextOnDocument, not brand.accent: this strip is
                        the letterhead stock, and the renderer draws this same
                        name in the same derived ink. An inline style is
                        invisible to every class-based contrast guard, which is
                        how the raw accent survived here at 1.79:1. */}
                    <p
                      className="text-[15px] font-bold"
                      style={{ color: accentTextOnDocument(brand.accent) }}
                    >
                      {brand.firmName}
                    </p>
                  </>
                )}
              </div>
              <div className="px-8 py-7">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={Math.min(28, Math.max(10, body.split('\n').length + 2))}
                  className="w-full resize-y font-serif text-[13.5px] leading-[1.7] text-[#1a1a1a] outline-none border-0 focus:ring-0 p-0 bg-transparent"
                  aria-label={t('Letter body (editable)')}
                />
                <pre className="whitespace-pre-wrap font-serif text-[13.5px] leading-[1.7] text-[#1a1a1a] mt-2 pt-3 border-t border-[#ece8dd]">
                  {closingText}
                </pre>
              </div>
              {/* #6f6a5a rather than #8a8472: the same warm grey at a legible
                  weight. The lighter one measured 3.58:1 on this page stock
                  and 3.22:1 on the workspace behind it, and it has no
                  counterpart in the PDF renderer to stay faithful to. */}
              <div className="px-8 py-4 text-[10px] text-[#6f6a5a] border-t border-[#ece8dd]">
                {brand.firmName} · <T>Generated</T> {formatDateNumeric(Date.now())} ·{' '}
                <T>Draft for attorney review</T>
              </div>
            </article>
            <p className="no-print text-[11px] text-muted mt-2">
              <T>The body above is editable. The signature block updates live from the toggles on the left.</T>
            </p>
          </>
        ) : (
          <div className="card p-10 text-center text-[13px] text-muted">
            <T>Describe the letter, pick what the signature block should include, then generate a branded draft you can edit, export as Word or PDF, and save to a case.</T>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The designed letterhead, on the studio's page preview.
 *
 * It reads letterheadDesignLines, the same list lib/branded-document-pdf.ts
 * draws and lib/docx-export.ts converts, so the order, the wording and the
 * emphasis are not decided here. The precedence around it is the renderer's
 * precedence unchanged: an uploaded image still wins, and a firm with neither
 * an image nor a design still sees the logo-plus-name block it sees today.
 *
 * The type sizes are the PDF's points converted at the one shared factor, and
 * the ink follows the PDF too: the accent on the firm name, a neutral grey
 * under it.
 *
 * WHAT DOES NOT SURVIVE, stated rather than approximated:
 *
 *   - Position on the page. This block sits in the studio's tinted header
 *     strip at the top of a web-width article, not inside a Letter page with
 *     the renderer's 64pt margins, so its distance from the body is the
 *     studio's and not the document's.
 *   - Wrapping. The renderer draws each line with a single drawText and never
 *     wraps it, so an over-long address line runs toward the page edge there
 *     and wraps to a second line here. The lines are short enough in practice
 *     that this is a difference at the extremes, not in the ordinary case.
 *   - Repetition. The renderer repaints the block on every page. This is one
 *     page.
 *
 * The accent bar the renderer paints along the top edge is not missing: the
 * strip this sits in already carries the studio's own 6px accent border, which
 * predates the design and stands in for it.
 */
function LetterheadDesignBlock({
  design,
  accent,
}: {
  design: LetterheadDesign;
  accent: string;
}) {
  const lines = letterheadDesignLines(design);
  // Derived here rather than by the caller, so the prop stays what it says it
  // is: the firm's accent. The renderer holds the raw accent too and derives at
  // the same point, through the same function, for the same reason.
  const ink = accentTextOnDocument(accent);
  return (
    <div style={{ textAlign: design.alignment === 'center' ? 'center' : 'left' }}>
      {lines.map((line, i) => (
        <p
          key={i}
          data-no-translate
          style={{
            fontSize: `${line.size * LETTERHEAD_PT_TO_PX}px`,
            lineHeight: `${(line.size + LETTERHEAD_LINE_GAP_PT) * LETTERHEAD_PT_TO_PX}px`,
            fontWeight: line.bold ? 700 : 400,
            color: line.bold ? ink : '#595959',
          }}
        >
          {line.text}
        </p>
      ))}
      {design.showRule && (
        <span
          className="block mt-2"
          style={{ borderTop: '0.5pt solid #cccccc' }}
        />
      )}
    </div>
  );
}
