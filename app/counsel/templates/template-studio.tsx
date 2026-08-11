'use client';

import { useMemo, useState } from 'react';
import {
  LEGAL_TEMPLATES,
  TEMPLATE_GROUPS,
  getTemplate,
  cleanLegalText,
} from '@/lib/legal-templates';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { ViewStrip, type ViewOption } from '@/components/counsel/patterns';
import { PdfPreviewDialog } from '@/components/PdfPreviewDialog';
import { formatDateNumeric } from '@/lib/format';
import { accentTextOnDocument } from '@/lib/accent-text';

/**
 * The categories, with how many documents each one offers.
 *
 * Computed once at module scope because LEGAL_TEMPLATES is a constant:
 * the counts cannot change between renders, and recomputing them on
 * every keystroke in the form below would be work for no reason. A
 * group name is the catalogue's own word, so it is not wrapped for
 * translation.
 */
const GROUP_OPTIONS: ViewOption[] = TEMPLATE_GROUPS.map((g) => ({
  key: g,
  label: <span data-no-translate>{g}</span>,
  count: LEGAL_TEMPLATES.filter((item) => item.group === g).length,
}));

type Meta = {
  title: string;
  brandName: string;
  firmName: string;
  logoUrl: string | null;
  /** Tier-2 letterhead URL; null = use the text-only header in PDFs. */
  letterheadUrl: string | null;
  accent: string;
};

export function TemplateStudio({ brand }: { brand: Meta }) {
  const t = useT();
  const [group, setGroup] = useState(TEMPLATE_GROUPS[0]);
  const [tplId, setTplId] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<string>('');
  const [meta, setMeta] = useState<Meta>(brand);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const tpl = getTemplate(tplId);
  const inGroup = useMemo(
    () => LEGAL_TEMPLATES.filter((item) => item.group === group),
    [group],
  );

  async function generate() {
    if (!tpl) return;
    setBusy(true);
    setError(null);
    setDoc('');
    try {
      const res = await fetch('/api/counsel/draft-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: tpl.id, params }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || t('Could not generate the document.'));
        return;
      }
      setDoc(cleanLegalText(j.document));
      setMeta({
        title: j.title,
        brandName: j.brandName,
        firmName: j.firmName,
        logoUrl: j.logoUrl,
        letterheadUrl: j.letterheadUrl ?? null,
        accent: j.accent,
      });
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
        document: doc,
        title: meta.title,
        brandName: meta.brandName,
        firmName: meta.firmName,
        accent: meta.accent,
        letterheadUrl: meta.letterheadUrl,
      }),
    });
    if (!res.ok) throw new Error(t('PDF export failed.'));
    return res.blob();
  }

  async function exportPdf() {
    setExporting(true);
    try {
      let blob: Blob;
      try {
        blob = await buildPdfBlob();
      } catch {
        setError(t('PDF export failed.'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(meta.title || 'document').replace(/[^a-z0-9]+/gi, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[360px,1fr] gap-6">
      {/* Builder */}
      <div className="card p-5 space-y-4 self-start">
        <div>
          <p className="label"><T>Category</T></p>
          {/* The segmented view strip from
              components/counsel/patterns.tsx, which is what this row of
              hand-rolled pills was a fourth copy of. Every option is a
              group some template is actually in and every count is the
              number this picker would then offer. */}
          <ViewStrip
            options={GROUP_OPTIONS}
            active={group}
            onSelect={(key) => {
              setGroup(key);
              setTplId('');
            }}
            label={t('Template categories')}
          />
        </div>
        <div>
          <p className="label"><T>Document type</T></p>
          <select
            className="input"
            value={tplId}
            onChange={(e) => {
              setTplId(e.target.value);
              setParams({});
              setDoc('');
            }}
          >
            <option value=""><T>Choose a document...</T></option>
            {inGroup.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {tpl && (
            <p className="text-[12px] text-muted mt-1">
              {tpl.blurb}
            </p>
          )}
        </div>

        {tpl &&
          tpl.fields.map((f) => (
            <label key={f.name} className="block">
              <span className="block text-[12px] font-medium text-foreground mb-1">
                {f.label}
                {f.optional && (
                  <span className="text-muted">
                    {' '}
                    <T>(optional)</T>
                  </span>
                )}
              </span>
              {f.textarea ? (
                <textarea
                  rows={4}
                  className="input resize-y"
                  placeholder={f.placeholder}
                  value={params[f.name] ?? ''}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, [f.name]: e.target.value }))
                  }
                />
              ) : (
                <input
                  className="input"
                  placeholder={f.placeholder}
                  value={params[f.name] ?? ''}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, [f.name]: e.target.value }))
                  }
                />
              )}
            </label>
          ))}

        {error && (
          <p className="text-[12px] text-danger-text">{error}</p>
        )}
        {tpl && (
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? <T>Drafting...</T> : <T>Generate document</T>}
          </button>
        )}
        <p className="text-[11px] text-muted leading-relaxed">
          <T>Drafted as your firm&rsquo;s work product. A licensed attorney should review before it is signed or filed.</T>
        </p>
      </div>

      {/* Preview */}
      <div>
        {doc ? (
          <>
            <div className="no-print flex items-center justify-end gap-2 mb-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(doc)}
                className="text-[12px] rounded-md ring-1 ring-edge px-3 py-1.5 text-foreground"
              >
                <T>Copy text</T>
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
                onClick={exportPdf}
                disabled={exporting}
                className="btn-primary !py-1.5 text-[13px]"
              >
                {exporting ? <T>Exporting...</T> : <T>Export PDF</T>}
              </button>
            </div>
            {previewOpen && (
              <PdfPreviewDialog
                title={meta.title || 'Document'}
                filename={`${(meta.title || 'document').replace(/[^a-z0-9]+/gi, '-')}.pdf`}
                buildPdf={buildPdfBlob}
                onClose={() => setPreviewOpen(false)}
              />
            )}
            <article
              id="print-block"
              className="bg-surface text-[#15110a] rounded-lg ring-1 ring-edge shadow-card overflow-hidden"
            >
              <div
                className="px-8 py-5 flex items-center gap-3"
                style={{
                  borderTop: `6px solid ${meta.accent}`,
                  background: '#fbfaf6',
                }}
              >
                {meta.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={meta.logoUrl}
                    alt={meta.firmName}
                    className="h-9 w-9 rounded object-contain"
                  />
                ) : null}
                <div>
                  {/* accentTextOnDocument, not meta.accent: this strip is the
                      letterhead stock, and the renderer draws this same banner
                      in the same derived ink. An inline style is invisible to
                      every class-based contrast guard, which is how the raw
                      accent survived here at 1.79:1. */}
                  <p
                    className="text-[11px] font-bold uppercase tracking-[0.18em]"
                    style={{ color: accentTextOnDocument(meta.accent) }}
                  >
                    {meta.brandName}
                  </p>
                  <p className="text-[12px] text-[#6b6555]">{meta.title}</p>
                </div>
              </div>
              <div className="px-8 py-7">
                <h2 className="text-2xl text-[#15110a] mb-4">
                  {meta.title}
                </h2>
                <pre className="whitespace-pre-wrap font-serif text-[13.5px] leading-[1.7] text-[#1a1a1a]">
                  {doc}
                </pre>
              </div>
              {/* #6f6a5a rather than #8a8472: the same warm grey at a legible
                  weight. The lighter one measured 3.58:1 on this page stock
                  and 3.22:1 on the workspace behind it, and it has no
                  counterpart in the PDF renderer to stay faithful to. */}
              <div className="px-8 py-4 text-[10px] text-[#6f6a5a] border-t border-[#ece8dd]">
                {meta.firmName} · <T>Generated</T>{' '}
                {formatDateNumeric(Date.now())} · <T>Draft for attorney review</T>
              </div>
            </article>
          </>
        ) : (
          <div className="card p-10 text-center text-[13px] text-muted">
            <T>Pick a document type, fill in the parties and key terms, then generate a branded draft you can export as PDF.</T>
          </div>
        )}
      </div>
    </div>
  );
}
