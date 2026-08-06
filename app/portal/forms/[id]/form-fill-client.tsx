'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FirmTemplate } from '@/lib/firm-templates';
import type { TemplateSubmission } from '@/lib/template-submission-types';
import {
  resubmitTemplateSubmissionAction,
  submitTemplateForApprovalAction,
} from '@/lib/template-submissions';
import { PdfPreviewDialog } from '@/components/PdfPreviewDialog';
import {
  findSignatureBlockLine,
  formatSignedOn,
  isSelfNameField,
  mergeTemplateDocument,
} from '@/lib/firm-template-placeholders';
import { SignaturePad, type SignaturePadValue } from '@/components/SignaturePad';
import {
  SIGNING_INTENT_PREFIX,
  signingIntentSuffix,
} from '@/lib/signing-intent';
import { DocumentWithMark } from '@/components/DocumentWithMark';
import { PageHeader, SectionTitle } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * Employee fill-and-sign for a firm template. Fields render as inputs, the
 * live preview substitutes {{key}} placeholders, and a typed signature block
 * is appended.
 *
 * Where it goes next depends on the template. A template the legal team marked
 * for review does NOT leave from this page: the employee names the recipient
 * and sends it to legal, who read the finished document and either approve it,
 * which delivers it, or send it back with a note. A template legal cleared for
 * self-service still exports here (the firm-branded PDF route the letter and
 * template studio already use), so an NDA leaves the building looking exactly
 * like legal drafted it.
 */
export function FormFillClient({
  template,
  firmId,
  firmName,
  employeeName,
  employeeEmail,
  submission,
}: {
  template: FirmTemplate;
  firmId: string;
  /** For the live text preview only. The PDF takes its brand from the firm
   *  record on the server, so none of the brand assets are props any more. */
  firmName: string;
  employeeName: string;
  employeeEmail: string;
  /** Set when the employee is fixing a submission legal sent back. */
  submission?: TemplateSubmission;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (submission) return { ...submission.fieldValues };
    const v: Record<string, string> = {};
    for (const f of template.fields) {
      if (isSelfNameField(f.key) && employeeName) v[f.key] = employeeName;
      if (f.type === 'date') v[f.key] = new Date().toISOString().slice(0, 10);
    }
    return v;
  });
  const [signature, setSignature] = useState(submission?.signatureName ?? employeeName);
  const [recipientEmail, setRecipientEmail] = useState(submission?.recipientEmail ?? '');
  const [recipientName, setRecipientName] = useState(submission?.recipientName ?? '');
  const [recipientNote, setRecipientNote] = useState(submission?.recipientNote ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mark, setMark] = useState<SignaturePadValue>({
    dataUrl: null,
    mode: 'drawn',
    hasInk: false,
    typedName: null,
  });
  const [intentAffirmed, setIntentAffirmed] = useState(false);

  const needsApproval = template.requiresApproval;
  const missing = template.fields.filter((f) => f.required && !(values[f.key] ?? '').trim());
  const recipientOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim());
  const ready =
    !busy &&
    missing.length === 0 &&
    signature.trim().length > 0 &&
    mark.hasInk &&
    intentAffirmed;

  const merged = useMemo(
    () =>
      // Reserved placeholders resolve from the live firm record on every
      // render, so a template that writes {{firm_name}} follows the firm
      // through a rename. The same function builds the copy the legal team
      // reviews, so the preview and the reviewed document cannot drift.
      mergeTemplateDocument({
        body: template.body,
        fields: template.fields,
        values,
        firmName,
        signatureName: signature,
        signerEmail: employeeEmail,
        signedOn: formatSignedOn(new Date()),
      }),
    [template, values, signature, employeeEmail, firmName],
  );

  // Where the mark goes, decided by the same function the PDF renderer and the
  // reviewer's page call. Splitting the preview here is what makes what the
  // employee sees and what the recipient receives the same document.
  const markLine = useMemo(() => findSignatureBlockLine(merged), [merged]);

  // The server renders from the firm's own stored template and the values
  // below, not from the text on this page, and refuses outright for a template
  // the legal team marked for review. So the finished, letterheaded document
  // only ever reaches a browser that is allowed to hold it.
  const buildPdf = async (): Promise<Blob> => {
    const res = await fetch('/api/counsel/draft-template/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firmId,
        templateId: template.id,
        values,
        signatureName: signature,
        signatureDataUrl: mark.dataUrl,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.blob();
  };

  const sendForReview = async () => {
    setBusy(true);
    setError(null);
    const input = {
      recipientEmail: recipientEmail.trim(),
      recipientName: recipientName.trim(),
      recipientNote: recipientNote.trim(),
      values,
      signatureName: signature.trim(),
      signatureDataUrl: mark.dataUrl ?? undefined,
      signatureMode: mark.mode,
      signatureIntentAt: new Date().toISOString(),
    };
    const res = submission
      ? await resubmitTemplateSubmissionAction(submission.id, input)
      : await submitTemplateForApprovalAction(firmId, template.id, input);
    setBusy(false);
    if (!res.ok || !res.submission) {
      setError(res.error ?? 'Could not send this for review.');
      return;
    }
    router.push(`/portal/forms/submissions/${res.submission.id}`);
    router.refresh();
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
      <PageHeader
        size="sm"
        backLink={
          <Link href="/portal/forms" className="text-[12px] text-ink-500 hover:underline dark:text-cream-100/55">
            ← All forms
          </Link>
        }
        title={template.name}
        subtitleClassName="mt-1"
        subtitle={template.description || undefined}
      />

      {submission?.decisionNote && (
        <div className="rounded-xl border border-gold-500/40 bg-gold-500/5 px-4 py-3">
          <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
            <T>What the legal team asked for</T>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-ink-700 dark:text-cream-100/80" data-no-translate>
            {submission.decisionNote}
          </p>
          <p className="mt-2 text-[12px] text-ink-500 dark:text-cream-100/55">
            <T>Make the change below and send it back. Nothing you already filled in is lost.</T>
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        {/* Fields */}
        <div className="space-y-4">
          <section className="space-y-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
            <SectionTitle>Your details</SectionTitle>
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
                <T>Your full legal name</T>
              </span>
              <input
                type="text"
                className={`${inputCls} font-serif italic`}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Your full name"
              />
              <span className="mt-1 block text-[12px] text-ink-500 dark:text-cream-100/55">
                <T>This is the name printed under your signature on the document.</T>
              </span>
            </label>
          </section>

          <section className="space-y-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
            <SectionTitle>Your signature</SectionTitle>
            <SignaturePad
              defaultTypedName={signature}
              onChange={setMark}
              onError={setError}
            />
            <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70">
              <T>
                Draw it, type it, or upload an image of your signature. A typed name is a valid
                signature; drawing one is simply closer to signing on paper.
              </T>
            </p>
            {/* The intent affirmation. This is the definitional element of an
                electronic signature under 15 USC 7006(5) and UETA 2(8), and it
                is the part of the outside signer's ceremony that genuinely
                carries over. The consumer disclosure in
                app/sign/[token]/signature-capture.tsx does not: an employee
                signing their employer's own paper is not a consumer under
                15 USC 7006(1), so the paper-copy right and the withdrawal
                notice are addressed to a situation that is not this one. */}
            <label className="flex items-start gap-3 text-[13px] text-ink-700 dark:text-cream-100/80">
              <input
                type="checkbox"
                checked={intentAffirmed}
                onChange={(e) => setIntentAffirmed(e.currentTarget.checked)}
                className="mt-1"
              />
              <span>
                {/* The words come from lib/signing-intent.ts, which the outside
                    signer's checkbox reads too. This page kept its own copy of
                    the sentence until that module existed; the two had already
                    started to differ in their typography, which is exactly the
                    drift a shared constant prevents. Neither surface holds the
                    words now.

                    The signer's own name stays in its own element so the
                    runtime translation layer does not machine-translate a
                    person's name in the operative clause. */}
                {SIGNING_INTENT_PREFIX}
                <strong data-no-translate>{signature || employeeName || employeeEmail}</strong>
                {signingIntentSuffix(template.name)}
              </span>
            </label>
          </section>

          {needsApproval && (
            <section className="space-y-3 rounded-xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40">
              <SectionTitle>Who receives it</SectionTitle>
              <p className="text-[12.5px] text-ink-600 dark:text-cream-100/70">
                <T>
                  This document goes to your legal team first. Once someone there approves it,
                  Advottic sends it to the address below as an encrypted link. The full text you
                  are sending is shown on the right.
                </T>
              </p>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
                  <T>Recipient email</T>
                </span>
                <input
                  type="email"
                  className={inputCls}
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  placeholder="recipient@company.com"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
                  <T>Recipient name (optional)</T>
                </span>
                <input
                  type="text"
                  className={inputCls}
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
                  <T>Note for the recipient (optional)</T>
                </span>
                <input
                  type="text"
                  className={inputCls}
                  value={recipientNote}
                  onChange={(e) => setRecipientNote(e.target.value)}
                />
              </label>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            {/* No PDF preview for a template that needs review. The dialog
                offers Print, Download and Open in a new tab, and once the
                bytes are in the browser they can be forwarded, so a preview
                is a send. The full text of the document is on this page
                already, and it is the same text the reviewer reads. */}
            {!needsApproval && (
              <button
                type="button"
                disabled={!ready}
                onClick={() => setPreviewOpen(true)}
                className="btn-primary disabled:opacity-50"
              >
                Preview PDF
              </button>
            )}

            {needsApproval ? (
              <button
                type="button"
                disabled={!ready || !recipientOk}
                onClick={() => void sendForReview()}
                className="btn-primary disabled:opacity-50"
              >
                {busy ? (
                  <T>Sending…</T>
                ) : submission ? (
                  <T>Send back to legal</T>
                ) : (
                  <T>Send to legal for review</T>
                )}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => void exportPdf(false)}
                  className="rounded-lg border border-ink-200 px-4 py-2 text-[14px] font-medium text-forest-900 hover:bg-cream-50 disabled:opacity-50 dark:border-forest-700/50 dark:text-cream-100 dark:hover:bg-forest-800/50"
                >
                  {busy ? 'Preparing…' : 'Download PDF'}
                </button>
                <button
                  type="button"
                  disabled={!ready}
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
              </>
            )}
          </div>

          {needsApproval && !recipientOk && ready && (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
              <T>Add the recipient email address to send this for review.</T>
            </p>
          )}
          {missing.length > 0 && (
            <p className="text-[12px] text-ink-500 dark:text-cream-100/55">
              Fill the required fields to continue: {missing.map((f) => f.label).join(', ')}.
            </p>
          )}
        </div>

        {/* Live preview */}
        <section className="rounded-xl border border-ink-200 bg-white p-6 dark:border-forest-700/50 dark:bg-forest-900/40">
          <SectionTitle className="mb-3">Preview</SectionTitle>
          <div
            className="max-h-[70vh] overflow-y-auto whitespace-pre-wrap font-serif text-[13.5px] leading-relaxed text-forest-900 dark:text-cream-100/90"
            data-no-translate
          >
            <DocumentWithMark text={merged} markLine={markLine} markSrc={mark.dataUrl} />
          </div>
        </section>
      </div>

      {previewOpen && (
        <PdfPreviewDialog
          title={template.name}
          filename={`${template.name.replace(/[^\w -]+/g, '')}.pdf`}
          buildPdf={buildPdf}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
