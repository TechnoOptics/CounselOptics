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
  counterpartyLabel,
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
import { DocumentSheets } from '@/components/DocumentSheets';
import { DocumentPdfDeck } from '@/components/DocumentPdfDeck';
import { PageHeader, SectionTitle } from '@/components/counsel/ui';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { employeeFieldsOf } from '@/lib/counterparty-fields';
import {
  checkTemplateFieldValue,
  invalidFieldValues,
  templateFieldInputAttributes,
} from '@/lib/template-field-formats';
import { padModesFor } from '@/lib/signature-methods';
import { PhoneMarkHandoff } from './phone-mark-handoff';
import { PhoneMarkComplete } from './phone-mark-complete';

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
  phoneHandoffAvailable,
  submission,
}: {
  template: FirmTemplate;
  firmId: string;
  /** For the live text preview only. The PDF takes its brand from the firm
   *  record on the server, so none of the brand assets are props any more. */
  firmName: string;
  employeeName: string;
  employeeEmail: string;
  /**
   * Whether the phone handoff exists in this database at all, established by
   * the server. Not optional and not defaulted: a caller that forgets it is a
   * type error rather than a page that quietly offers the route again.
   */
  phoneHandoffAvailable: boolean;
  /** Set when the employee is fixing a submission legal sent back. */
  submission?: TemplateSubmission;
}) {
  const router = useRouter();
  const t = useT();
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (submission) return { ...submission.fieldValues };
    const v: Record<string, string> = {};
    for (const f of employeeFieldsOf(template.fields)) {
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
  /**
   * Which field the person is filling in, so the preview can show the clause it
   * belongs to.
   *
   * Asked for directly: "whenever a user starts filling out a field in the left
   * panel, set focus to that section on the place they are filling". On a seven
   * page agreement the field and the sentence it changes are usually pages
   * apart, so without this the preview is a document you scroll rather than a
   * document that answers you.
   */
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [mark, setMark] = useState<SignaturePadValue>({
    dataUrl: null,
    mode: 'drawn',
    hasInk: false,
    typedName: null,
  });
  const [intentAffirmed, setIntentAffirmed] = useState(false);
  // A mark drawn on the employee's own phone, and the handoff it came back
  // through. The id travels with the submission so the SERVER can establish
  // that this was signed on a phone; a page saying so would be a page's word
  // for it, and 'phone' is the one method that does not have to be taken on
  // anyone's word.
  const [phoneMark, setPhoneMark] = useState<{
    dataUrl: string;
    handoffId: string;
    /** The server's instant, shown beside the returned mark. Never this
     *  browser's clock: see PhoneMarkComplete. */
    markAt: string | null;
  } | null>(null);

  /**
   * The affirmation gates the signature section, and this is that gate.
   *
   * Asked FIRST and enforced, rather than asked underneath a pad somebody has
   * already drawn on. The affirmation is what makes a mark a signature under
   * 15 USC 7006(5) and UETA 2(8), and collecting it afterwards invites the
   * answer "I had already signed, I only clicked the box later".
   *
   * It is not decoration and it is not opacity. Every control the section
   * offers is genuinely disabled while this is true, the canvas refuses
   * pointers, and the QR cannot be minted, which is the one route that would
   * otherwise go around a shut pad entirely.
   *
   * NONE OF THIS IS A CONTROL. It is an ordering, in a browser. The server
   * refuses an unaffirmed mark on its own account in storeMarkForHandoff, and
   * that gate is untouched by this file.
   */
  const signatureLocked = !intentAffirmed;

  /**
   * Drop the mark and go back to an empty section.
   *
   * Both halves matter. Clearing only the phone's mark would uncover whatever
   * the pad last reported, because markSrc prefers the phone's bytes and falls
   * back to the pad's, and the person would then send a stale picture they had
   * already replaced. The pad itself unmounts while a phone mark is showing,
   * so it comes back empty on its own.
   */
  const signAgain = () => {
    setPhoneMark(null);
    setMark({ dataUrl: null, mode: 'drawn', hasInk: false, typedName: null });
  };

  // What this template may be signed with, and therefore what the pad may
  // offer. An empty list is a real answer and not a missing one: it is what a
  // template restricted to the phone produces, and the pad says so rather than
  // widening back to all three. The QR below is the route that case leaves
  // open, which is why it is rendered whenever the phone is permitted and not
  // only when the pad has nothing.
  const padModes = padModesFor(template.signatureMethods);
  const phonePermitted =
    template.signatureMethods === null ||
    template.signatureMethods.includes('phone');
  // Two questions, asked of two different authorities, and an offer needs
  // both. The firm's setting above says whether the phone is ALLOWED; the
  // prop says whether it is POSSIBLE in this database.
  //
  // They were one question until today, and the one they asked was the wrong
  // one. A template with no restriction recorded reads as allowing all four
  // methods, which is correct and deliberately fail-open, because a database
  // without 20260814_signature_methods.sql must not refuse every method. But
  // 20260815_mark_handoffs.sql is unapplied as well, so that default was also
  // answering "does the phone handoff exist", which it knows nothing about.
  // The card rendered, and the employee found out by tapping it.
  const phoneOffered = phonePermitted && phoneHandoffAvailable;
  // No pad, and no phone either. Two ways to arrive here and they are told
  // apart below, because one is the firm's decision and one is not.
  //
  // The firm's is a restriction that leaves this employee nothing at all:
  // unreachable through the picker, the save path and the CHECK constraint,
  // all three of which refuse an empty selection, but lib/signature-methods.ts
  // reads a stored [] as "refuse everything" rather than quietly widening it,
  // and this is the surface honouring that. A template nobody can sign is a
  // visible problem the firm can fix; a restriction silently lifted is not
  // visible at all, so this says so plainly instead of finding the employee a
  // route the firm did not grant.
  const noWayToSign = padModes.length === 0 && !phoneOffered;
  // The other way: the firm restricted this template to the phone, and the
  // phone is the one thing this deployment cannot do yet. Not the firm's
  // doing, so it does not read as the firm's fault.
  const phoneOnlyNotProvisioned = noWayToSign && phonePermitted;

  const needsApproval = template.requiresApproval;
  const forSignature = template.deliveryMode === 'signature';
  // The other side's fields are not this employee's to answer, so they are
  // neither asked for below nor required here. They are collected on the
  // signing page, from the person whose facts they are.
  const ownFields = employeeFieldsOf(template.fields);
  const recipientFields = template.fields.filter((f) => f.party === 'counterparty');
  const missing = ownFields.filter((f) => f.required && !(values[f.key] ?? '').trim());
  /**
   * The answers that do not fit the kind of detail their field asks for.
   *
   * The same rule the server refuses on (fieldFormatRefusal, over the same
   * module), run here so somebody is told what to fix while they are still
   * looking at the field, rather than after a round trip. It is NOT the gate:
   * submitTemplateForApprovalAction is a `'use server'` export and therefore a
   * public HTTP endpoint, and it runs the rule again over whatever it is sent.
   *
   * Keyed by field so the sentence can sit under the input it is about.
   */
  const formatProblems = invalidFieldValues(ownFields, values);
  const problemFor = new Map(formatProblems.map((p) => [p.key, p.message]));

  /**
   * The answers AS THEY WILL BE STORED, which is what the preview beside this
   * form has to merge.
   *
   * sanitizeTemplateValues normalises on the server, so a phone typed
   * 555.123.4567 reaches the document as (555) 123-4567. Merging the raw state
   * here would show the employee one string and send another, on the page
   * whose whole job is to show what is being sent. An answer that does not fit
   * its format is left exactly as typed, which is the same thing
   * sanitizeTemplateValues does with it.
   */
  const normalizedValues = useMemo(() => {
    const out: Record<string, string> = { ...values };
    for (const f of ownFields) {
      const checked = checkTemplateFieldValue(f.type, values[f.key] ?? '');
      if (checked.ok && checked.value) out[f.key] = checked.value;
    }
    return out;
  }, [values, ownFields]);
  const recipientOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim());

  // The mark that will be sent, and it is the PHONE'S OWN BYTES when there is
  // one rather than the pad's redraw of them. The pad scales an external image
  // to fit its canvas, so re-exporting it would produce a different picture
  // from the one the bound phone drew, and the server checks the bytes it is
  // given against the fingerprint that phone left. Sending the redraw would
  // fail that check and silently demote a phone signature to an ordinary one.
  const markSrc = phoneMark?.dataUrl ?? mark.dataUrl;
  /**
   * The text to look for in the rendered document.
   *
   * The field's own VALUE, not its label and not its {{key}}: the placeholder
   * is gone by the time the document is rendered, and the label usually does
   * not appear in the text at all.
   *
   * Three characters minimum. Below that a value matches half the document, and
   * a preview that jumps to the wrong clause on every keystroke is worse than
   * one that stays put. An empty or too-short field simply does not move it.
   */
  const focusText = (() => {
    if (!focusedKey) return null;
    const v = (values[focusedKey] ?? '').trim();
    return v.length >= 3 ? v : null;
  })();
  // A phone mark counts as ink. On a template restricted to the phone the pad
  // renders no canvas at all, so it never reports any, and reading only its
  // answer would leave the send button disabled forever with no way to enable
  // it. That was the dead end this whole change is about.
  const hasMark = phoneMark !== null || mark.hasInk;
  const ready =
    !busy &&
    missing.length === 0 &&
    // An answer that will be refused by the server must not reach a button
    // that says Send. The sentence under the field says what to fix.
    formatProblems.length === 0 &&
    signature.trim().length > 0 &&
    hasMark &&
    intentAffirmed;

  const merged = useMemo(
    () =>
      // Reserved placeholders resolve from the live firm record on every
      // render, so a template that writes {{firm_name}} follows the firm
      // through a rename. The same function builds the copy the legal team
      // reviews, so the preview and the reviewed document cannot drift.
      //
      // The counterparty block follows the same discipline: the rule that
      // decides whether it appears and what it is labelled with lives in
      // counterpartyLabel, and the server calls it too, so the block the
      // employee reads here is the block the reviewer reads.
      mergeTemplateDocument({
        body: template.body,
        fields: template.fields,
        values: normalizedValues,
        firmName,
        signatureName: signature,
        signerEmail: employeeEmail,
        signedOn: formatSignedOn(new Date()),
        deliveryMode: template.deliveryMode,
        counterpartyName: counterpartyLabel({
          deliveryMode: template.deliveryMode,
          recipientName,
          recipientEmail,
        }),
      }),
    [
      template,
      normalizedValues,
      signature,
      employeeEmail,
      firmName,
      recipientName,
      recipientEmail,
    ],
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
        signatureDataUrl: markSrc,
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
      signatureDataUrl: markSrc ?? undefined,
      // A mark made on a phone is a drawn mark, which is what the column
      // stores. Whether it was made on a PHONE is a separate question, and one
      // this page is not trusted to answer: the handoff id below is what lets
      // the server establish it for itself.
      signatureMode: phoneMark ? 'drawn' : mark.mode,
      signatureHandoffId: phoneMark?.handoffId,
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
    'w-full rounded-lg border border-edge bg-surface px-3 py-2 text-[14px] text-foreground outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25';

  return (
    <div className="space-y-5">
      <PageHeader
        size="sm"
        backLink={
          <Link href="/portal/forms" className="text-[12px] text-muted hover:underline">
            ← All forms
          </Link>
        }
        title={template.name}
        subtitleClassName="mt-1"
        subtitle={template.description || undefined}
      />

      {submission?.decisionNote && (
        <div className="rounded-xl border border-gold-500/40 bg-gold-500/5 px-4 py-3">
          <p className="text-[13px] font-semibold text-foreground">
            <T>What the legal team asked for</T>
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-foreground" data-no-translate>
            {submission.decisionNote}
          </p>
          <p className="mt-2 text-[12px] text-muted">
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
          <section className="space-y-3 rounded-xl border border-edge bg-surface p-4">
            <SectionTitle>Your details</SectionTitle>
            {ownFields.map((f) => {
              const problem = problemFor.get(f.key);
              // The sentence's own id, so the input can point at it. A message
              // that merely sits under an input is not part of it: a screen
              // reader announces the label and the value and nothing else, and
              // the person who most needs to be told what to fix is the one
              // who is not told.
              const problemId = `field-problem-${f.key}`;
              const attrs = templateFieldInputAttributes(f.type);
              const shared = {
                className: `${inputCls} ${problem ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-400/25 dark:border-rose-500/70' : ''}`,
                value: values[f.key] ?? '',
                'aria-invalid': problem ? (true as const) : undefined,
                'aria-describedby': problem ? problemId : undefined,
                onChange: (
                  e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
                ) => setValues((v) => ({ ...v, [f.key]: e.target.value })),
                // Focusing a field points the preview at the clause it fills.
                //
                // Also fired on CHANGE above via focusedKey, so typing into a
                // field that was already focused still moves the preview once
                // the value becomes findable. Setting it here rather than only
                // on change means tabbing through the form walks the document
                // with you.
                onFocus: () => setFocusedKey(f.key),
              };
              return (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-[13px] font-medium text-foreground">
                    <span data-no-translate>{f.label}</span>
                    {f.required && <span className="text-rose-500"> *</span>}
                  </span>
                  {f.type === 'textarea' ? (
                    <textarea rows={3} {...shared} />
                  ) : (
                    <input
                      type={attrs.type}
                      inputMode={attrs.inputMode}
                      autoComplete={attrs.autoComplete}
                      {...shared}
                    />
                  )}
                  {problem && (
                    <span
                      id={problemId}
                      // Announced when it appears, not only when the input is
                      // next focused. Polite, because somebody typing an email
                      // address should not be interrupted mid-word.
                      role="status"
                      className="mt-1 block text-[12px] leading-relaxed text-rose-700 dark:text-rose-300"
                    >
                      {/* Through t() rather than <T>{...}</T>. The sentence
                          comes out of a constant map in
                          lib/template-field-formats.ts, so it is ours and not
                          user data, and a braced <T> wrap is the pattern
                          scripts/test/counsel-i18n-invariants.mjs makes
                          somebody review. Same reasoning as the failure copy
                          in components/PdfViewer.tsx. */}
                      {t(problem)}
                    </span>
                  )}
                </label>
              );
            })}
            {recipientFields.length > 0 && (
              <p className="border-t border-edge pt-3 text-[12.5px] leading-relaxed text-muted">
                <T>
                  The legal team has left some parts of this document for the
                  recipient to complete: they type them on the signing page and
                  see them in place before they sign. You do not need to fill
                  them in.
                </T>{' '}
                <span data-no-translate>
                  {recipientFields.map((f) => f.label).join(', ')}
                </span>
              </p>
            )}
            <label className="block border-t border-edge pt-3">
              <span className="mb-1 block text-[13px] font-medium text-foreground">
                <T>Your full legal name</T>
              </span>
              <input
                type="text"
                className={`${inputCls} font-serif italic`}
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Your full name"
              />
              <span className="mt-1 block text-[12px] text-muted">
                <T>This is the name printed under your signature on the document.</T>
              </span>
            </label>
          </section>

          <section className="space-y-3 rounded-xl border border-edge bg-surface p-4">
            <SectionTitle>Your signature</SectionTitle>

            {/* The intent affirmation, and it comes FIRST.
                This is the definitional element of an electronic signature
                under 15 USC 7006(5) and UETA 2(8), and it used to sit at the
                foot of this section, under the pad. So a person drew their
                name and was asked afterwards whether they had meant it to be a
                signature, which is the ceremony backwards.

                The consumer disclosure in
                app/sign/[token]/signature-capture.tsx still does not carry
                over: an employee signing their employer's own paper is not a
                consumer under 15 USC 7006(1), so the paper-copy right and the
                withdrawal notice are addressed to a situation that is not this
                one.

                Not asked when there is no way to make a mark. Affirming that
                "the mark above" be a signature, above an apology and no pad,
                asks somebody to attest to something that cannot exist. */}
            {!noWayToSign && (
            <label className="flex items-start gap-3 text-[13px] text-foreground">
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
            )}

            {/* Said out loud, because a section of controls that are all shut
                and nothing explaining why is a page that reads as broken. */}
            {!noWayToSign && signatureLocked && (
              <p className="text-[12.5px] leading-relaxed text-muted">
                <T>The signature options turn on once you tick the box above.</T>
              </p>
            )}

            {phoneMark ? (
              /* Signed on the phone. The pad is REPLACED, not covered: see the
                 header of phone-mark-complete.tsx for why a canvas that is
                 still mounted is still a canvas. */
              <PhoneMarkComplete
                dataUrl={phoneMark.dataUrl}
                markAt={phoneMark.markAt}
                onSignAgain={signAgain}
              />
            ) : (
            <>
            {(padModes.length > 0 || phoneOffered) && (
              <SignaturePad
                defaultTypedName={signature}
                allowedModes={padModes}
                disabled={signatureLocked}
                onChange={setMark}
                onError={setError}
                // The fourth way, in the strip with the other three. It used
                // to sit in its own card below the pad, which is why it was
                // reported as missing from the options: three tabs on one row
                // and the fourth way further down does not read as four ways
                // of signing. Absent when the firm has not allowed a phone, or
                // when this deployment has no handoff to give, because an
                // offer that would be refused on scanning is worse than none.
                phoneTab={
                  phoneOffered
                    ? {
                        label: 'Phone',
                        panel: (
                          <PhoneMarkHandoff
                            templateId={template.id}
                            available={phoneHandoffAvailable}
                            onlyRoute={padModes.length === 0}
                            disabled={signatureLocked}
                            onMark={(dataUrl, handoffId, markAt) =>
                              setPhoneMark({ dataUrl, handoffId, markAt })
                            }
                          />
                        ),
                      }
                    : null
                }
              />
            )}
            {/* Only when all three are on the table. The firm can narrow this
                to one, and a sentence naming three ways of signing beside a
                single Type tab describes a page that is not on screen. */}
            {padModes.length === 3 && (
              <p className="text-[12.5px] text-muted">
                <T>
                  Draw it, type it, or upload an image of your signature. A typed name is a valid
                  signature; drawing one is simply closer to signing on paper.
                </T>
              </p>
            )}

            {noWayToSign && (
              <p className="rounded-lg border border-edge bg-surface-2 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground">
                {phoneOnlyNotProvisioned ? (
                  <T>
                    This form is set to be signed on a phone, and signing on a
                    phone is not available yet. Ask your legal team to allow
                    another way to sign it, then open this page again.
                  </T>
                ) : (
                  <T>
                    Your legal team has not left a way to sign this form. Ask
                    them to enable a signature method on it, then open this page
                    again.
                  </T>
                )}
              </p>
            )}

            </>
            )}
          </section>

          {needsApproval && (
            <section className="space-y-3 rounded-xl border border-edge bg-surface p-4">
              <SectionTitle>Who receives it</SectionTitle>
              <p className="text-[12.5px] text-muted">
                {forSignature ? (
                  <T>
                    This document goes to your legal team first. Once legal approves this, we
                    will email this person a link and a separate access code, and ask them to
                    sign it. The full text you are sending is shown on the right.
                  </T>
                ) : (
                  <T>
                    This document goes to your legal team first. Once someone there approves it,
                    Advottic sends it to the address below as an encrypted link. The full text you
                    are sending is shown on the right.
                  </T>
                )}
              </p>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-foreground">
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
                <span className="mb-1 block text-[13px] font-medium text-foreground">
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
                <span className="mb-1 block text-[13px] font-medium text-foreground">
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
                  className="rounded-lg border border-edge px-4 py-2 text-[14px] font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
                >
                  {busy ? 'Preparing…' : 'Download PDF'}
                </button>
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => void exportPdf(true)}
                  className="rounded-lg border border-edge px-4 py-2 text-[14px] font-medium text-foreground hover:bg-surface-2 disabled:opacity-50"
                >
                  Print
                </button>
                <button
                  type="button"
                  onClick={emailDraft}
                  className="rounded-lg border border-edge px-4 py-2 text-[14px] font-medium text-foreground hover:bg-surface-2"
                >
                  Share via email
                </button>
              </>
            )}
          </div>

          {needsApproval && !recipientOk && ready && (
            <p className="text-[12px] text-muted">
              <T>Add the recipient email address to send this for review.</T>
            </p>
          )}
          {missing.length > 0 && (
            <p className="text-[12px] text-muted">
              Fill the required fields to continue: {missing.map((f) => f.label).join(', ')}.
            </p>
          )}
          {/* Beside the button that is off, as well as under the field that is
              at fault. The fields sit above the fold on a phone and the button
              does not, so a button disabled with nothing said next to it is a
              page that reads as broken. */}
          {formatProblems.length > 0 && (
            <p className="text-[12px] text-muted">
              <T>Check these before you continue:</T>{' '}
              <span data-no-translate>
                {formatProblems.map((p) => p.label).join(', ')}
              </span>
              .
            </p>
          )}
        </div>

        {/* Live preview */}
        <section className="rounded-xl border border-edge bg-surface p-6">
          <SectionTitle className="mb-3">Preview</SectionTitle>
          {/*
            No max-height and no overflow here on purpose. The sheets lay out at
            full height and the PAGE scrolls, so nothing captures the wheel. The
            pane this replaced was 530px around 4168px of content.
          */}
          <div data-no-translate>
            {/*
              The REAL document, rendered from the PDF this page can build, so
              the employee sees the pages and the layout the recipient will
              receive rather than an estimate of them. The text sheets stay as
              the fallback: they need nothing but the words, so a slow or failed
              build leaves a readable document rather than an empty frame.

              `revision` is what the PDF is built FROM. Anything that changes
              the document has to appear in it or the preview goes stale while
              looking settled, which on a contract is worse than looking busy.
            */}
            <DocumentPdfDeck
              buildPdf={buildPdf}
              revision={JSON.stringify([values, signature, markSrc])}
              signed={Boolean(markSrc)}
              focusText={focusText}
              fallback={
                <DocumentSheets text={merged} markLine={markLine} markSrc={markSrc} />
              }
            />
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
