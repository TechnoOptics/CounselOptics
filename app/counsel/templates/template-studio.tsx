'use client';

import { useMemo, useState } from 'react';
import {
  LEGAL_TEMPLATES,
  TEMPLATE_GROUPS,
  getTemplate,
  cleanLegalText,
} from '@/lib/legal-templates';

type Meta = {
  title: string;
  brandName: string;
  firmName: string;
  logoUrl: string | null;
  accent: string;
};

export function TemplateStudio({ brand }: { brand: Meta }) {
  const [group, setGroup] = useState(TEMPLATE_GROUPS[0]);
  const [tplId, setTplId] = useState('');
  const [params, setParams] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<string>('');
  const [meta, setMeta] = useState<Meta>(brand);
  const [exporting, setExporting] = useState(false);

  const tpl = getTemplate(tplId);
  const inGroup = useMemo(
    () => LEGAL_TEMPLATES.filter((t) => t.group === group),
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
        setError(j.error || 'Could not generate the document.');
        return;
      }
      setDoc(cleanLegalText(j.document));
      setMeta({
        title: j.title,
        brandName: j.brandName,
        firmName: j.firmName,
        logoUrl: j.logoUrl,
        accent: j.accent,
      });
    } catch {
      setError('Network error - try again.');
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf() {
    setExporting(true);
    try {
      const res = await fetch('/api/counsel/draft-template/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: doc,
          title: meta.title,
          brandName: meta.brandName,
          firmName: meta.firmName,
          accent: meta.accent,
        }),
      });
      if (!res.ok) {
        setError('PDF export failed.');
        return;
      }
      const blob = await res.blob();
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
          <p className="label">Category</p>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => {
                  setGroup(g);
                  setTplId('');
                }}
                className={`text-[12px] rounded-full px-2.5 py-1 ring-1 transition-colors ${
                  group === g
                    ? 'bg-gold-500/20 ring-gold-500/40 text-gold-700 dark:text-gold-200'
                    : 'ring-ink-200 dark:ring-forest-700/40 text-ink-700 dark:text-cream-100/85'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">Document type</p>
          <select
            className="input"
            value={tplId}
            onChange={(e) => {
              setTplId(e.target.value);
              setParams({});
              setDoc('');
            }}
          >
            <option value="">Choose a document...</option>
            {inGroup.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {tpl && (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1">
              {tpl.blurb}
            </p>
          )}
        </div>

        {tpl &&
          tpl.fields.map((f) => (
            <label key={f.name} className="block">
              <span className="block text-[12px] font-medium text-forest-900 dark:text-cream-100 mb-1">
                {f.label}
                {f.optional && (
                  <span className="text-ink-400 dark:text-cream-100/40">
                    {' '}
                    (optional)
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
          <p className="text-[12px] text-rose-600 dark:text-rose-300">
            {error}
          </p>
        )}
        {tpl && (
          <button
            type="button"
            onClick={generate}
            disabled={busy}
            className="btn-primary w-full"
          >
            {busy ? 'Drafting...' : 'Generate document'}
          </button>
        )}
        <p className="text-[11px] text-ink-400 dark:text-cream-100/45 leading-relaxed">
          Drafted as your firm&rsquo;s work product. A licensed
          attorney should review before it is signed or filed.
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
                className="text-[12px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 py-1.5 text-ink-700 dark:text-cream-100/85"
              >
                Copy text
              </button>
              <button
                type="button"
                onClick={exportPdf}
                disabled={exporting}
                className="btn-primary !py-1.5 text-[13px]"
              >
                {exporting ? 'Exporting...' : 'Export PDF'}
              </button>
            </div>
            <article
              id="print-block"
              className="bg-white text-[#15110a] rounded-lg ring-1 ring-ink-200 shadow-card overflow-hidden"
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
                  <p
                    className="text-[11px] font-bold uppercase tracking-[0.18em]"
                    style={{ color: meta.accent }}
                  >
                    {meta.brandName}
                  </p>
                  <p className="text-[12px] text-[#6b6555]">{meta.title}</p>
                </div>
              </div>
              <div className="px-8 py-7">
                <h2 className="font-display text-2xl text-[#15110a] mb-4">
                  {meta.title}
                </h2>
                <pre className="whitespace-pre-wrap font-serif text-[13.5px] leading-[1.7] text-[#1a1a1a]">
                  {doc}
                </pre>
              </div>
              <div className="px-8 py-4 text-[10px] text-[#8a8472] border-t border-[#ece8dd]">
                {meta.firmName} · Generated{' '}
                {new Date().toLocaleDateString()} · Draft for attorney
                review
              </div>
            </article>
          </>
        ) : (
          <div className="card p-10 text-center text-[13px] text-ink-500 dark:text-cream-100/55">
            Pick a document type, fill in the parties and key terms,
            then generate a branded draft you can export as PDF.
          </div>
        )}
      </div>
    </div>
  );
}
