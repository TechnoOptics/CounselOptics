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

type Brand = {
  firmName: string;
  logoUrl: string | null;
  letterheadUrl: string | null;
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
    new Date().toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
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
      const endpoint =
        format === 'pdf'
          ? '/api/counsel/draft-template/pdf'
          : '/api/counsel/letters/docx';
      const payload =
        format === 'pdf'
          ? {
              document: composed,
              title,
              firmName: brand.firmName,
              accent: brand.accent,
              letterheadUrl: brand.letterheadUrl ?? undefined,
              logoUrl: brand.logoUrl ?? undefined,
            }
          : {
              title,
              body,
              options,
              signerName,
              signerTitle,
              dateText,
            };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(`${format.toUpperCase()} ${t('export failed.')}`);
        return;
      }
      const blob = await res.blob();
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

        <div className="border-t border-ink-100 dark:border-forest-700/40 pt-4 space-y-3">
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
                    : 'ring-ink-200 dark:ring-forest-700/40 text-ink-600 dark:text-cream-100/60'
                }`}
              >
                {options[tg.key] ? '✓ ' : ''}
                <T>{tg.label}</T>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-[12px] text-rose-600 dark:text-rose-300">{error}</p>
        )}
        {saved && (
          <p className="text-[12px] text-emerald-700 dark:text-emerald-300">
            {saved}
          </p>
        )}
        <p className="text-[11px] text-ink-500 dark:text-cream-100/70 leading-relaxed">
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
                className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85"
              >
                <T>Copy text</T>
              </button>
              <button
                type="button"
                onClick={() => exportFile('docx')}
                disabled={exporting !== null}
                className="text-[13px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85"
              >
                {exporting === 'docx' ? <T>Exporting…</T> : <T>Export Word</T>}
              </button>
              <button
                type="button"
                onClick={() => setPreviewOpen(true)}
                className="text-[13px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85"
              >
                <T>Preview PDF</T>
              </button>
              <button
                type="button"
                onClick={() => exportFile('pdf')}
                disabled={exporting !== null}
                className="text-[13px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85"
              >
                {exporting === 'pdf' ? <T>Exporting…</T> : <T>Export PDF</T>}
              </button>
              {previewOpen && (
                <PdfPreviewDialog
                  title={title || 'Letter'}
                  filename={`${(title || 'letter').replace(/[^a-z0-9]+/gi, '-')}.pdf`}
                  buildPdf={buildPdfBlob}
                  onClose={() => setPreviewOpen(false)}
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

            <article className="bg-white text-[#15110a] rounded-lg ring-1 ring-ink-200 shadow-card overflow-hidden">
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
                    <p
                      className="text-[15px] font-bold"
                      style={{ color: brand.accent }}
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
              <div className="px-8 py-4 text-[10px] text-[#8a8472] border-t border-[#ece8dd]">
                {brand.firmName} · <T>Generated</T> {new Date().toLocaleDateString()} ·{' '}
                <T>Draft for attorney review</T>
              </div>
            </article>
            <p className="no-print text-[11px] text-ink-500 dark:text-cream-100/55 mt-2">
              <T>The body above is editable. The signature block updates live from the toggles on the left.</T>
            </p>
          </>
        ) : (
          <div className="card p-10 text-center text-[13px] text-ink-500 dark:text-cream-100/55">
            <T>Describe the letter, pick what the signature block should include, then generate a branded draft you can edit, export as Word or PDF, and save to a case.</T>
          </div>
        )}
      </div>
    </div>
  );
}
