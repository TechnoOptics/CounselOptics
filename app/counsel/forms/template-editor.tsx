'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  importTemplateDocumentAction,
  type FirmTemplate,
  type TemplateField,
} from '@/lib/firm-templates';
import {
  deliveryModeFlipped,
  unmergedPlaceholders,
} from '@/lib/firm-template-placeholders';
import {
  applyBlankSuggestion,
  detectSignatureEvidence,
  detectTemplateBlanks,
  removeRuledBlank,
  type DetectedBlank,
} from '@/lib/template-blank-detection';
import type { DeliveryMode } from '@/lib/submission-dispatch';
import type { SignatureMethod } from '@/lib/signature-methods';
import { resolveDocumentLayout, type DocumentLayout } from '@/lib/document-layout';
import type { LetterheadAvailability } from '@/components/counsel/DocumentLayoutFields';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { EditorTabs, panelId, tabId } from './editor-tabs';
import { DocumentTab } from './document-tab';
import { FieldsTab } from './fields-tab';
import { SignatureTab } from './signature-tab';
import { PreviewTab } from './preview-tab';
import {
  LAYOUT_BANDS,
  blankIdentity,
  deriveFields,
  layoutOverride,
  type EditorTabId,
  type LayoutBand,
} from './template-editor-model';

export type TemplateDraft = {
  id?: string;
  name: string;
  description: string;
  category: string;
  body: string;
  fields: TemplateField[];
  status: 'draft' | 'published';
  requiresApproval: boolean;
  deliveryMode: DeliveryMode;
  documentLayout: Record<string, unknown> | null;
  acknowledgeUnmergedPlaceholders: boolean;
  /**
   * How a signature may be given on this template, or null for no
   * restriction. Null and a list are deliberately different writes: a draft
   * that omitted the field would otherwise lift a restriction the author
   * never touched. See normalizeSignatureMethodSelection.
   */
  signatureMethods: SignatureMethod[] | null;
};

/**
 * Create or edit one firm form template.
 *
 * FOUR SECTIONS, ONE DRAFT. Every piece of state a template has lives here
 * and is passed down; the sections are markup. That is what makes moving
 * between them free: nothing is submitted per section, nothing is lost by
 * leaving one, and the Save buttons below the sections write the whole
 * template exactly as they always did.
 *
 * The field list is derived FROM the body: every {{placeholder}} found
 * becomes a configurable field row (label, type, required), so authors never
 * have to keep two lists in sync.
 */
export function TemplateEditor({
  firmId,
  initial,
  busy,
  firmLayout,
  letterhead,
  brandName,
  onCancel,
  onSave,
}: {
  firmId: string;
  initial: FirmTemplate | null;
  busy: boolean;
  firmLayout: DocumentLayout;
  letterhead: LetterheadAvailability;
  brandName: string;
  onCancel: () => void;
  onSave: (draft: TemplateDraft) => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<EditorTabId>('document');
  /**
   * Bumped when the standing blocker banner is asked to take the author to
   * the acknowledgement. An effect rather than a callback, because the
   * checkbox belongs to the Document section and does not exist in the DOM
   * until React has committed the section it lives in.
   */
  const [jumpToAck, setJumpToAck] = useState(0);
  useEffect(() => {
    if (jumpToAck === 0) return;
    const box = document.getElementById('unmerged-ack');
    box?.scrollIntoView({ block: 'center' });
    box?.focus();
  }, [jumpToAck]);

  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [body, setBody] = useState(
    initial?.body ??
      'NON-DISCLOSURE AGREEMENT\n\nThis Agreement is made on {{date}} between {{company}} and {{recipient_name}} ("Recipient").\n\n1. ...',
  );
  const [requiresApproval, setRequiresApproval] = useState(initial?.requiresApproval ?? true);
  // Null is "no restriction", which is what every template says today and what
  // an unmigrated column reads back as. It is NOT the same value as a list, so
  // an author who never opens the Signature tab cannot lift a restriction
  // somebody else set.
  const [signatureMethods, setSignatureMethods] = useState<SignatureMethod[] | null>(
    initial?.signatureMethods ?? null,
  );
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(
    initial?.deliveryMode ?? 'share',
  );
  const [fieldMeta, setFieldMeta] = useState<Record<string, TemplateField>>(() => {
    const m: Record<string, TemplateField> = {};
    for (const f of initial?.fields ?? []) m[f.key] = f;
    return m;
  });

  /**
   * Which BANDS this template overrides, and what it sets them to.
   *
   * Band by band rather than field by field, and that is the granularity on
   * purpose. "This template sets its own footer" is a sentence an author can
   * hold; "this template sets its own footer alignment but inherits its text"
   * is not, and an author who could not see which half was inherited would have
   * no way to predict what a change in firm settings does to their template.
   *
   * Every band NOT on this list is inherited live: change the firm's margins
   * tomorrow and this template moves with them.
   */
  const [overriddenBands, setOverriddenBands] = useState<Set<LayoutBand>>(
    () => new Set(LAYOUT_BANDS.filter((b) => initial?.documentLayout?.[b] !== undefined)),
  );
  const [layoutDraft, setLayoutDraft] = useState<DocumentLayout>(() =>
    resolveDocumentLayout(firmLayout, initial?.documentLayout ?? null),
  );
  const documentLayout = layoutOverride(overriddenBands, layoutDraft);
  const toggleBand = (band: LayoutBand, on: boolean) => {
    setOverriddenBands((current) => {
      const next = new Set(current);
      if (on) next.add(band);
      else next.delete(band);
      return next;
    });
    // Handing a band back to the firm puts the firm's own settings on screen
    // straight away, rather than leaving the author looking at values that are
    // no longer going to be saved.
    if (!on) {
      setLayoutDraft((draft) => ({ ...draft, [band]: firmLayout[band] }));
    }
  };

  // What came back from an import, if one has run. `imported` drives the
  // banner: it stays up until the editor is closed, because the reviewer is
  // being asked to check work that is not theirs and the reminder should not
  // scroll away with the first edit.
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ notes: string[] } | null>(null);

  /**
   * Fill the editor from an uploaded document. NOTHING is saved: the proposal
   * lands in the same state the author types into, and the existing Save
   * button is still the only thing that writes.
   */
  const runImport = async (file: File) => {
    setImporting(true);
    setImportError(null);
    let res: Awaited<ReturnType<typeof importTemplateDocumentAction>>;
    try {
      const data = new FormData();
      data.set('file', file);
      res = await importTemplateDocumentAction(firmId, data);
    } catch {
      // A server action can reject outright: the request times out, the
      // deployment is mid-swap, the network drops. Without this the button
      // stays disabled reading "Reading the document" for as long as the page
      // is open, with nothing said, and this call is a whole-document
      // generation measured in minutes rather than seconds.
      setImporting(false);
      setImportError(
        t('The document could not be read just now. Please try again in a moment.'),
      );
      return;
    } finally {
      setImporting(false);
    }
    if (!res.ok || !res.proposal) {
      setImportError(res.error ?? t('Could not read that document.'));
      return;
    }
    const p = res.proposal;
    setBody(p.body);
    setDeliveryMode(p.deliveryMode);
    // Replaced rather than merged. The keys belong to the document that was
    // just imported, and settings left over from a different body would be
    // attached to whichever keys happened to share a name.
    setFieldMeta(() => {
      const m: Record<string, TemplateField> = {};
      for (const f of p.fields) m[f.key] = f;
      return m;
    });
    setImported({ notes: p.notes });
  };

  const fields = deriveFields(body, fieldMeta);

  /**
   * WHAT THE DOCUMENT ITSELF SAYS ABOUT WHERE SOMEBODY WRITES AND SIGNS.
   *
   * The fields above come from `{{placeholders}}`, which only exist because an
   * author typed them. An author who pastes in the agreement their firm already
   * uses has none: they have "Name: ______" and "By: ______", and until now
   * every one of those had to be found by eye and retyped as a placeholder.
   *
   * These two reads answer the other half. lib/template-blank-detection.ts is
   * the same rule set the AI import path has used since it shipped; it is run
   * here over whatever body is on screen, with no upload, no model call and no
   * rate limit. It is deliberately RECOMPUTED from `body` on every render
   * rather than held in state: a suggestion list that could be older than the
   * text it describes is a list of offsets pointing into a document that has
   * moved.
   *
   * NOTHING BELOW IS APPLIED BY BEING FOUND. Detection produces a list; the
   * buttons apply one item at a time; and what a button writes is the BODY,
   * which is the textarea the author is looking at. There is no path by which a
   * field appears on an instrument without somebody clicking for it.
   */
  const detected = useMemo(() => detectTemplateBlanks(body), [body]);
  const signatureEvidence = useMemo(() => detectSignatureEvidence(body), [body]);

  /**
   * Suggestions the author has waved away, by what they describe rather than by
   * where they sit. An index would be invalidated by the next keystroke, and a
   * dismissal that survives an edit to the very text it is about would hide a
   * blank the author has just changed their mind over. This identity resets
   * when the surrounding words change, which is the safe direction: a
   * suggestion coming back is noise, a dismissal outliving its blank is a
   * silence.
   */
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const dismiss = (b: DetectedBlank) =>
    setDismissed((s) => new Set(s).add(blankIdentity(b)));

  /**
   * Keys that reached the field list because the author accepted a suggestion
   * in THIS editing session, so the row can say so.
   *
   * Session-scoped on purpose, and not stored. The accept IS the review: an
   * author who has read the suggestion, pressed the button and then pressed
   * Save has adopted that field, and after the save it is a `{{placeholder}}`
   * in their own body indistinguishable from one they typed, because that is
   * exactly what it is. What has to be attributable is the moment the decision
   * is still open, and this covers all of it.
   */
  const [fromDetection, setFromDetection] = useState<Set<string>>(() => new Set());

  const acceptBlank = (b: DetectedBlank) => {
    if (!b.key) return;
    const next = applyBlankSuggestion(body, b);
    // Null means the body moved under the suggestion. Nothing is written and
    // nothing is said: the list is about to recompute from the current body
    // anyway, and the stale row disappears with it.
    if (next === null) return;
    setBody(next);
    // Seeded with the DOCUMENT'S own label rather than the title-cased key, so
    // "Print Name: ______" becomes a field labelled "Print Name" and not
    // "Print Name" by coincidence of the key. Required is true, matching the
    // default a hand-typed placeholder already gets.
    setFieldMeta((m) => ({
      ...m,
      [b.key as string]: {
        key: b.key as string,
        label: b.label ?? (b.key as string),
        type: b.type,
        required: true,
      },
    }));
    setFromDetection((s) => new Set(s).add(b.key as string));
  };

  const removeRule = (b: DetectedBlank) => {
    const next = removeRuledBlank(body, b);
    if (next === null) return;
    setBody(next);
  };

  const live = detected.filter((b) => !dismissed.has(blankIdentity(b)));
  const addable = live.filter((b) => b.kind === 'fill' && b.key);
  const signaturePlaces = live.filter((b) => b.kind === 'signature');
  const unnamed = live.filter((b) => b.kind === 'fill' && !b.key);

  /**
   * The placeholders in this body that nothing will fill in.
   *
   * The fields above are derived FROM the body, so it is easy to assume this
   * list is always empty. It is not, and the gap is the defect this exists
   * for: extractKeys reads `{{\s*([a-zA-Z0-9_]+)\s*}}` and then LOWERCASES the
   * key, while the merge substitutes the literal `{{key}}` exactly. So
   * `{{ client_name }}` and `{{Client_Name}}` each produce a perfectly good
   * field row that the author fills in, and each prints its own braces on the
   * finished document. `{{client-name}}` produces no field at all, because a
   * hyphen is not in the extractor's alphabet.
   *
   * Computed from the same function the save runs, so what is shown here and
   * what the server refuses cannot drift apart.
   */
  const unmerged = unmergedPlaceholders({ body, fields });
  // Tied to the exact list that was read. Editing the body into a NEW stray
  // token clears the acknowledgement, because what was agreed to was those
  // tokens and not the idea of tokens.
  const unmergedSignature = unmerged.join('\u0000');
  const [acknowledgedFor, setAcknowledgedFor] = useState<string | null>(null);
  const placeholdersSettled = unmerged.length === 0 || acknowledgedFor === unmergedSignature;

  /**
   * The draft, rendered as the PDF it becomes, by the server that renders the
   * real thing.
   *
   * Everything sent is what Save would write: the same body, the same derived
   * fields, the same delivery mode and the same partial layout override. The
   * firm's letterhead, accent and page defaults are NOT sent, because the
   * server reads those off the firm record; a preview that carried its own
   * branding could show a page no colleague would ever receive.
   *
   * Nothing is saved by asking for it. This is a render, and the Save buttons
   * below remain the only thing that writes.
   */
  const buildPreviewPdf = async (): Promise<Blob> => {
    const res = await fetch('/api/counsel/draft-template/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firmId,
        draftTemplate: { name, body, fields, deliveryMode, documentLayout },
      }),
    });
    if (!res.ok) {
      // The server's own sentence, which says whether this was a permission,
      // an empty draft or a failed render. A generic message here is how a
      // preview that refused for a reason the author could fix reads as a
      // fault in the app. Capped, because a proxy or a crash can answer with
      // a page rather than a sentence.
      const said = (await res.text().catch(() => '')).trim().slice(0, 300);
      throw new Error(said || t('The preview could not be prepared. Try again in a moment.'));
    }
    return res.blob();
  };

  const draft = (status: 'draft' | 'published'): TemplateDraft => ({
    id: initial?.id,
    name,
    description,
    category,
    body,
    fields,
    status,
    requiresApproval,
    documentLayout,
    deliveryMode,
    acknowledgeUnmergedPlaceholders: unmerged.length > 0,
    signatureMethods,
  });

  return (
    <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-5 dark:border-forest-700/50 dark:bg-forest-900/40">
      <EditorTabs
        active={tab}
        onSelect={setTab}
        idPrefix="template-editor"
        // The one section that can hold the Save buttons, marked so the
        // author can find it from wherever they are standing.
        attention={placeholdersSettled ? [] : ['document']}
      />

      <div
        role="tabpanel"
        id={panelId('template-editor', tab)}
        aria-labelledby={tabId('template-editor', tab)}
      >
        {tab === 'document' && (
          <DocumentTab
            busy={busy}
            name={name}
            setName={setName}
            category={category}
            setCategory={setCategory}
            description={description}
            setDescription={setDescription}
            body={body}
            setBody={setBody}
            importing={importing}
            importError={importError}
            imported={imported}
            onImport={(file) => void runImport(file)}
            unmerged={unmerged}
            unmergedSignature={unmergedSignature}
            acknowledgedFor={acknowledgedFor}
            setAcknowledgedFor={setAcknowledgedFor}
            letterhead={letterhead}
            brandName={brandName}
            layoutDraft={layoutDraft}
            setLayoutDraft={setLayoutDraft}
            overriddenBands={overriddenBands}
            toggleBand={toggleBand}
          />
        )}
        {tab === 'fields' && (
          <FieldsTab
            busy={busy}
            hasBody={body.trim() !== ''}
            deliveryMode={deliveryMode}
            fields={fields}
            setFieldMeta={setFieldMeta}
            addable={addable}
            unnamed={unnamed}
            fillDetectedCount={detected.filter((b) => b.kind === 'fill').length}
            fromDetection={fromDetection}
            onAccept={acceptBlank}
            onDismiss={dismiss}
          />
        )}
        {tab === 'signature' && (
          <SignatureTab
            busy={busy}
            deliveryMode={deliveryMode}
            setDeliveryMode={setDeliveryMode}
            modeFlipped={deliveryModeFlipped(initial?.deliveryMode, deliveryMode)}
            signaturePlaces={signaturePlaces}
            signatureEvidence={signatureEvidence}
            onRemoveRule={removeRule}
            onDismiss={dismiss}
            requiresApproval={requiresApproval}
            setRequiresApproval={setRequiresApproval}
            signatureMethods={signatureMethods}
            setSignatureMethods={setSignatureMethods}
          />
        )}
        {tab === 'preview' && (
          <PreviewTab
            busy={busy}
            name={name}
            body={body}
            deliveryMode={deliveryMode}
            unmergedCount={unmerged.length}
            buildPdf={buildPreviewPdf}
          />
        )}
      </div>

      {/* THE BLOCKER, OUTSIDE THE SECTIONS.
          The acknowledgement itself belongs under the body it is about, and
          it stays there. But sections can hide it, and a Save button that is
          off for a reason on a screen the author is not looking at is a
          refusal with no sentence attached. So the fact is restated here,
          beside the buttons it holds, on every section. */}
      {!placeholdersSettled && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100"
        >
          <span>
            <T>
              Saving is off until the placeholders nothing will fill in are
              corrected or read and ticked.
            </T>
          </span>
          {tab !== 'document' && (
            <button
              type="button"
              onClick={() => {
                setTab('document');
                setJumpToAck((n) => n + 1);
              }}
              className="font-medium text-accent-text hover:underline"
            >
              <T>Take me to it</T>
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4 dark:border-forest-800/50">
        {/* BOTH Save buttons wait on the acknowledgement, the draft one
            included. A draft is one click from published, and a firm that
            could park a broken body as a draft would have moved the same
            problem one step closer to a recipient with nothing said. */}
        <button
          type="button"
          disabled={busy || !name.trim() || !body.trim() || !placeholdersSettled}
          onClick={() => onSave(draft('published'))}
          className="btn-primary disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save & publish'}
        </button>
        <button
          type="button"
          disabled={busy || !name.trim() || !body.trim() || !placeholdersSettled}
          onClick={() => onSave(draft('draft'))}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          Save as draft
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
