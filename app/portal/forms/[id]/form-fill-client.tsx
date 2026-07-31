'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { FirmTemplate } from '@/lib/firm-templates';
import { PdfPreviewDialog } from '@/components/PdfPreviewDialog';

/**
 * Employee fill-and-sign for a firm template. Fields render as inputs, the
 * live preview substitutes {{key}} placeholders, and a typed signature block
 * is appended. Export = the firm-branded PDF route the letter/template studio
 * already uses (letterhead, accent), so an employee NDA leaves the building
 * looking exactly like legal drafted it. Print uses the same PDF; Email opens
 * a draft referencing the downloaded file.
 */
export function FormFillClient({
  template,
  firmName,
  firmAccent,
  letterheadUrl,
  logoUrl,
  employeeName,
  employeeEmail,
}: {
  template: FirmTemplate;
  firmName: string;
  firmAccent: string | null;
  letterheadUrl: string | null;
  logoUrl: string | null;
  employeeName: string;
  employeeEmail: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of template.fields) {
      if (/name/.test(f.key) && employeeName) v[f.key] = employeeName;
      if (f.type === 'date') v[f.key] = new Date().toISOString().slice(0, 10);
    }
    return v;
  });
  const [signature, setSignature] = useState(employeeName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [shareDone, setShareDone] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const missing = template.fields.filter((f) => f.required && !(values[f.key] ?? '').trim());

  const merged = useMemo(() => {
    let text = template.body;
    for (const f of template.fields) {
      const val = (values[f.key] ?? '').trim() || `[${f.label}]`;
      text = text.split(`{{${f.key}}}`).join(val);
    }
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    text += `\n\n\nSigned: ${signature.trim() || '____________________'}\nDate: ${today}\nEmail: ${employeeEmail}`;
    return text;
  }, [template, values, signature, employeeEmail]);

  const buildPdf = async (): Promise<Blob> => {
    const res = await fetch('/api/counsel/draft-template/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document: merged,
        title: template.name,
        brandName: firmName,
        firmName,
        accent: firmAccent ?? undefined,
        letterheadUrl: letterheadUrl ?? undefined,
        logoUrl: logoUrl ?? undefined,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.blob();
  };

  const secureShare = async () => {
    setBusy(true);
    setError(null);
    setShareDone(null);
    try {
      const pdf = await buildPdf();
      const fd = new FormData();
      fd.set('file', new File([pdf], `${template.name.replace(/[^\w -]+/g, '')}.pdf`, { type: 'application/pdf' }));
      fd.set('recipientEmail', shareEmail);
      fd.set('label', template.name);
      if (shareNote.trim()) fd.set('note', shareNote);
      const res = await fetch('/portal/share', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not share the document.');
      setShareDone(
        body.emailSent
          ? `Sent. ${shareEmail} received the secure link and, in a separate email, the decryption key.`
          : `The encrypted link is ready (${body.link}) but the emails could not be sent. Copy the link and this key to the recipient yourself: ${body.key}`,
      );
      setShareOpen(false);
      setShareEmail('');
      setShareNote('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share the document.');
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = async (print: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await buildPdf();
      const url = URL.createObjectURL(blob);
      if (print) {
        const w = window.open(url, '_blank');
        w?.addEventListener('load', () => w.print());
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${template.name.replace(/[^\w -]+/g, '')}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export the PDF.');
    } finally {
      setBusy(false);
    }
  };

  const emailDraft = () => {
    const subject = encodeURIComponent(`${template.name} - ${signature || employeeName}`);
    const body = encodeURIComponent(
      `Hi,\n\nPlease find the completed "${template.name}" attached.\n\n(Download it from the Hub first, then attach it to this email.)\n\nBest,\n${signature || employeeName}`,
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const inputCls =
    'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[14px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100';

  return (
    <div className="space-y-5">
      <header className="min-w-0">
        <Link href="/portal/forms" className="text-[12px] text-ink-500 hover:underline dark:text-cream-100/55">
          ← All forms
        </Link>
        <h1 className="mt-1 font-display text-2xl font-medium text-forest-900 dark:text-cream-100">
          {template.name}
        </h1>
        {template.description && (
          <p className="mt-1 text-sm text-ink-600 dark:text-cream-100/70">{template.description}</p>
        )}
      </header>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        {/* Fields */}
        <div className="space-y-4">
          <section className="space-y-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
              Your details
            </h2>
            {template.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
                  {f.label}
                  {f.required && <span className="text-rose-500"> *</span>}
                </span>
                {f.type === 'textarea' ? (
                  <textarea
                    rows={3}
                    className={inputCls}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                ) : (
                  <input
                    type={f.type === 'date' ? 'date' : 'text'}
                    className={inputCls}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
              </label>
            ))}
            <label className="block border-t border-ink-100 pt-3 dark:border-forest-800/50">
              <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
                Signature (type your full legal name)
              </span>
              <input
                type="text"
                className={`${inputCls} font-serif italic`}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Your full name"
              />
            </label>
          </section>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || missing.length > 0 || !signature.trim()}
              onClick={() => setPreviewOpen(true)}
              className="btn-primary disabled:opacity-50"
            >
              Preview PDF
            </button>
            <button
              type="button"
              disabled={busy || missing.length > 0 || !signature.trim()}
              onClick={() => void exportPdf(false)}
              className="rounded-lg border border-ink-200 px-4 py-2 text-[14px] font-medium text-forest-900 hover:bg-cream-50 disabled:opacity-50 dark:border-forest-700/50 dark:text-cream-100 dark:hover:bg-forest-800/50"
            >
              {busy ? 'Preparing…' : 'Download PDF'}
            </button>
            <button
              type="button"
              disabled={busy || missing.length > 0 || !signature.trim()}
              onClick={() => void exportPdf(true)}
              className="rounded-lg border border-ink-200 px-4 py-2 text-[14px] font-medium text-forest-900 hover:bg-cream-50 disabled:opacity-50 dark:border-forest-700/50 dark:text-cream-100 dark:hover:bg-forest-800/50"
            >
              Print
            </button>
            <button
              type="button"
              onClick={emailDraft}
              className="rounded-lg border border-ink-200 px-4 py-2 text-[14px] font-medium text-forest-900 hover:bg-cream-50 dark:border-forest-700/50 dark:text-cream-100 dark:hover:bg-forest-800/50"
            >
              Share via email
            </button>
            <button
              type="button"
              disabled={busy || missing.length > 0 || !signature.trim()}
              onClick={() => setShareOpen((v) => !v)}
              className="rounded-lg border border-gold-500/50 bg-gold-500/10 px-4 py-2 text-[14px] font-medium text-gold-700 hover:bg-gold-500/20 disabled:opacity-50 dark:text-gold-300"
            >
              Share securely
            </button>
          </div>

          {shareDone && (
            <p className="rounded-lg border border-forest-200 bg-forest-50 px-3 py-2 text-[13px] text-forest-800 dark:border-forest-700/40 dark:bg-forest-900/60 dark:text-cream-100/85">
              {shareDone}
            </p>
          )}

          {shareOpen && (
            <div className="space-y-3 rounded-xl border border-gold-500/40 bg-gold-500/5 p-4">
              <p className="text-[13px] text-ink-700 dark:text-cream-100/80">
                The document is encrypted before it leaves Advottic. The recipient gets the secure
                link in one email and the decryption key in a <strong>separate</strong> email.
              </p>
              <input
                type="email"
                value={shareEmail}
                onChange={(e) => setShareEmail(e.target.value)}
                placeholder="recipient@company.com"
                className={inputCls}
              />
              <input
                type="text"
                value={shareNote}
                onChange={(e) => setShareNote(e.target.value)}
                placeholder="Optional note for the recipient"
                className={inputCls}
              />
              <button
                type="button"
                disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shareEmail)}
                onClick={() => void secureShare()}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? 'Encrypting & sending…' : 'Encrypt & send'}
              </button>
            </div>
          )}
          {missing.length > 0 && (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
              Fill the required fields to enable export: {missing.map((f) => f.label).join(', ')}.
            </p>
          )}
        </div>

        {/* Live preview */}
        <section className="rounded-xl border border-ink-200 bg-white p-6 dark:border-forest-700/50 dark:bg-forest-900/40">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
            Preview
          </h2>
          <div className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-forest-900 dark:text-cream-100/90">
            {merged}
          </div>
        </section>
      </div>

      {previewOpen && (
        <PdfPreviewDialog
          title={template.name}
          filename={`${template.name.replace(/[^\w -]+/g, '')}.pdf`}
          buildPdf={buildPdf}
          onClose={() => setPreviewOpen(false)}
          actions={
            <button
              type="button"
              onClick={() => {
                setPreviewOpen(false);
                setShareOpen(true);
              }}
              className="rounded-lg border border-gold-500/50 bg-gold-500/10 px-4 py-2 text-[14px] font-medium text-gold-700 hover:bg-gold-500/20 dark:text-gold-300"
            >
              Looks good, share securely
            </button>
          }
        />
      )}
    </div>
  );
}
