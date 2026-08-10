'use client';

import { useMemo, useRef, useState } from 'react';
import {
  createFirmTemplateAction,
  importTemplateDocumentAction,
  updateFirmTemplateAction,
  type FirmTemplate,
  type TemplateField,
} from '@/lib/firm-templates';
import {
  counterpartyFieldsGoUnfilled,
  deliveryModeFlipped,
  isReservedFirmKey,
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
import {
  resolveDocumentLayout,
  type DocumentLayout,
} from '@/lib/document-layout';
import {
  DocumentLayoutFields,
  type LetterheadAvailability,
} from '@/components/counsel/DocumentLayoutFields';
import { EmptyState } from '@/components/counsel/ui';
import { PdfPreviewDialog } from '@/components/PdfPreviewDialog';
import {
  Chip,
  MonoRef,
  ViewStrip,
  shortRef,
  type ViewOption,
} from '@/components/counsel/patterns';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { StatusPill, PILL_COLORS } from '@/components/counsel/StatusPill';

/**
 * Create/edit/publish firm form templates. The field list is derived FROM the
 * body: every {{placeholder}} found becomes a configurable field row (label,
 * type, required), so authors never have to keep two lists in sync.
 */
export function FormsManageClient({
  firmId,
  initialTemplates,
  firmLayout,
  letterhead,
  brandName,
}: {
  firmId: string;
  initialTemplates: FirmTemplate[];
  /** The firm's own page layout. Every template starts from it and inherits
   *  every band it does not override. */
  firmLayout: DocumentLayout;
  letterhead: LetterheadAvailability;
  brandName: string;
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [editing, setEditing] = useState<FirmTemplate | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (draft: {
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
  }) => {
    setBusy(true);
    setError(null);
    const res = draft.id
      ? await updateFirmTemplateAction(firmId, draft.id, draft)
      : await createFirmTemplateAction(firmId, draft);
    setBusy(false);
    if (!res.ok || !res.template) {
      setError(res.error ?? 'Could not save.');
      return;
    }
    const t = res.template;
    setTemplates((list) => {
      const i = list.findIndex((x) => x.id === t.id);
      if (i === -1) return [t, ...list];
      const next = [...list];
      next[i] = t;
      return next;
    });
    setEditing(null);
  };

  const archive = async (id: string) => {
    setBusy(true);
    const res = await updateFirmTemplateAction(firmId, id, { status: 'archived' });
    setBusy(false);
    if (res.ok) setTemplates((list) => list.filter((t) => t.id !== id));
    else setError(res.error ?? 'Could not archive.');
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {editing ? (
        <TemplateEditor
          firmId={firmId}
          initial={editing === 'new' ? null : editing}
          busy={busy}
          firmLayout={firmLayout}
          letterhead={letterhead}
          brandName={brandName}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      ) : (
        <>
          <button type="button" onClick={() => setEditing('new')} className="btn-primary">
            + New template
          </button>
          {templates.length === 0 ? (
            <EmptyState
              title="No templates yet"
              sub="Create your first: an NDA is the classic starting point."
            />
          ) : (
            <TemplateCards
              templates={templates}
              busy={busy}
              onEdit={setEditing}
              onArchive={(id) => void archive(id)}
            />
          )}
        </>
      )}
    </div>
  );
}

/** The three field types a template body can produce, in reading order. */
const FIELD_TYPES: { type: TemplateField['type']; label: string }[] = [
  { type: 'text', label: 'Short text' },
  { type: 'textarea', label: 'Long text' },
  { type: 'date', label: 'Date' },
];

/**
 * The configuration-list pattern from PARITY-SPEC.md section 3: one
 * card per template rather than one row, carrying what an author has
 * to know before opening the editor.
 *
 * Every number on a card is counted from that template's own fields,
 * and every phrase after them names a setting the template actually
 * has: `requiresApproval` and `deliveryMode`. There is no DEFAULT
 * badge and no Categories button, because a firm template has neither
 * a default flag nor anywhere to manage categories, and the mono
 * reference is the template's id rather than a slug, because a
 * template has no slug.
 *
 * The scope strip only appears once there are at least two categories
 * to choose between. One category is not a filter, it is a label, and
 * a strip with a single option would be a control that does nothing.
 */
export function TemplateCards({
  templates,
  busy,
  onEdit,
  onArchive,
}: {
  templates: FirmTemplate[];
  busy: boolean;
  onEdit: (t: FirmTemplate) => void;
  onArchive: (id: string) => void;
}) {
  const t = useT();
  const [scope, setScope] = useState('');

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const tpl of templates) {
      const c = (tpl.category ?? '').trim();
      if (c && !seen.includes(c)) seen.push(c);
    }
    return seen.sort((a, b) => a.localeCompare(b));
  }, [templates]);

  const shown = scope
    ? templates.filter((tpl) => (tpl.category ?? '').trim() === scope)
    : templates;

  const options: ViewOption[] = [
    { key: '', label: <T>All</T>, count: templates.length },
    ...categories.map((c) => ({
      key: c,
      // A firm-authored category name is data, not UI copy, so it is
      // not wrapped for translation.
      label: <span data-no-translate>{c}</span>,
      count: templates.filter((tpl) => (tpl.category ?? '').trim() === c).length,
    })),
  ];

  return (
    <div className="space-y-3">
      {/* The count lives here rather than in the page subtitle because
          archiving a template updates this list without a reload, and a
          server-rendered count would sit there being wrong. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {categories.length > 1 ? (
          <ViewStrip
            options={options}
            active={scope}
            onSelect={setScope}
            label={t('Template categories')}
          />
        ) : (
          <span />
        )}
        <p className="text-[12px] tabular-nums text-muted">
          {shown.length}/{templates.length} <T>templates shown</T>
        </p>
      </div>

      <ul className="grid gap-3">
        {shown.map((tpl) => {
          const required = tpl.fields.filter((f) => f.required).length;
          const counterparty = tpl.fields.filter(
            (f) => f.party === 'counterparty',
          ).length;
          // TEMPLATES THAT WERE ALREADY SAVED. The save gate can only speak to
          // the next person who edits one, and a firm may hold a template with
          // a stray placeholder in it that nobody opens for a year while
          // colleagues keep sending documents from it. Shown on the list so it
          // is visible without opening anything, from the template's own
          // stored body and fields.
          const unmerged = unmergedPlaceholders({
            body: tpl.body,
            fields: tpl.fields,
          });
          return (
            <li key={tpl.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className="text-[14px] font-semibold text-foreground"
                      data-no-translate
                    >
                      {tpl.name}
                    </p>
                    {tpl.category && (
                      <Chip tone="accent">
                        <span data-no-translate>{tpl.category}</span>
                      </Chip>
                    )}
                    <StatusPill
                      size="sm"
                      dot
                      color={
                        tpl.status === 'published'
                          ? PILL_COLORS.good
                          : PILL_COLORS.neutral
                      }
                    >
                      {t(tpl.status === 'published' ? 'Published' : 'Draft')}
                    </StatusPill>
                  </div>
                  {tpl.description && (
                    <p
                      className="mt-1.5 text-[12.5px] leading-relaxed text-muted"
                      data-no-translate
                    >
                      {tpl.description}
                    </p>
                  )}
                </div>
                <MonoRef title={`${t('Template id')} ${tpl.id}`}>
                  {shortRef(tpl.id)}
                </MonoRef>
              </div>

              <p className="mt-2.5 text-[12px] text-muted">
                {tpl.fields.length}{' '}
                {tpl.fields.length === 1 ? <T>field</T> : <T>fields</T>}
                {' · '}
                {required} <T>required</T>
                {counterparty > 0 && (
                  <>
                    {' · '}
                    {counterparty} <T>filled by the other side</T>
                  </>
                )}
                {' · '}
                {tpl.requiresApproval ? (
                  <T>reviewed before it is sent</T>
                ) : (
                  <T>employees send it themselves</T>
                )}
                {' · '}
                {tpl.deliveryMode === 'signature' ? (
                  <T>sent for signature</T>
                ) : (
                  <T>shared read-only</T>
                )}
              </p>

              {unmerged.length > 0 && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[12px] leading-relaxed text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100">
                  {unmerged.length === 1 ? (
                    <T>One placeholder in this template fills in as nothing and prints as written:</T>
                  ) : (
                    <T>Some placeholders in this template fill in as nothing and print as written:</T>
                  )}{' '}
                  <span className="font-mono" data-no-translate>
                    {unmerged.join(' ')}
                  </span>
                </p>
              )}

              {tpl.fields.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {FIELD_TYPES.map(({ type, label }) => {
                    const n = tpl.fields.filter((f) => f.type === type).length;
                    if (n === 0) return null;
                    return (
                      <Chip key={type}>
                        {t(label)}
                        <span className="tabular-nums opacity-70">{n}</span>
                      </Chip>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 flex items-center gap-4 border-t border-edge pt-3">
                <button
                  type="button"
                  onClick={() => onEdit(tpl)}
                  className="text-[13px] font-medium text-accent-text hover:underline"
                >
                  <T>Edit</T>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onArchive(tpl.id)}
                  className="text-[13px] text-muted hover:text-danger-text"
                >
                  <T>Archive</T>
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function extractKeys(body: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    const k = m[1].toLowerCase();
    // Reserved keys resolve from the firm record, so they are not something
    // an employee fills in. Deriving a field from one would put an empty
    // required "Firm Name" input on the form and disable the very
    // substitution the author asked for.
    if (isReservedFirmKey(k)) continue;
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

const LAYOUT_BANDS = ['margins', 'letterhead', 'watermark', 'footer'] as const;
type LayoutBand = (typeof LAYOUT_BANDS)[number];
const LAYOUT_BAND_LABELS: Record<LayoutBand, string> = {
  margins: 'Margins',
  letterhead: 'Letterhead',
  watermark: 'Watermark',
  footer: 'Footer',
};

function TemplateEditor({
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
  onSave: (draft: {
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
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [body, setBody] = useState(
    initial?.body ??
      'NON-DISCLOSURE AGREEMENT\n\nThis Agreement is made on {{date}} between {{company}} and {{recipient_name}} ("Recipient").\n\n1. ...',
  );
  const [requiresApproval, setRequiresApproval] = useState(initial?.requiresApproval ?? true);
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
  // What actually gets written: only the bands the author took over. Null when
  // they took over none, which is the same value as "follow the firm".
  const documentLayout = (() => {
    const out: Record<string, unknown> = {};
    for (const band of LAYOUT_BANDS) {
      if (overriddenBands.has(band)) out[band] = layoutDraft[band];
    }
    return Object.keys(out).length > 0 ? out : null;
  })();
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
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<{ notes: string[] } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

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

  const keys = extractKeys(body);
  const fields: TemplateField[] = keys.map(
    (k) =>
      fieldMeta[k] ?? {
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        type: /date/.test(k) ? 'date' : 'text',
        required: true,
      },
  );

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
  const identify = (b: DetectedBlank) =>
    `${b.kind}|${b.key ?? b.label ?? ''}|${b.context}`;
  const dismiss = (b: DetectedBlank) =>
    setDismissed((s) => new Set(s).add(identify(b)));

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
    // default a hand-typed placeholder already gets a few lines above.
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

  const live = detected.filter((b) => !dismissed.has(identify(b)));
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
  const unmergedSignature = unmerged.join(' ');
  const [acknowledgedFor, setAcknowledgedFor] = useState<string | null>(null);
  const placeholdersSettled =
    unmerged.length === 0 || acknowledgedFor === unmergedSignature;

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

  const inputCls =
    'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[14px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100';

  return (
    <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-5 dark:border-forest-700/50 dark:bg-forest-900/40">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Mutual NDA" />
        </label>
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">Category</span>
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="NDA" />
        </label>
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">Description</span>
          <input
            className={inputCls}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Standard mutual NDA for pilots and vendor talks"
          />
        </label>
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
            <T>How this goes out</T>
          </span>
          <select
            className={inputCls}
            value={deliveryMode}
            onChange={(e) => setDeliveryMode(e.target.value === 'signature' ? 'signature' : 'share')}
          >
            <option value="share">Secure link, read only</option>
            <option value="signature">For signature</option>
          </select>
          <span className="mt-1 block text-[12px] text-ink-500 dark:text-cream-100/55">
            <T>
              For signature sends the recipient a link and a code, and asks them to sign.
              A secure link only lets them read it.
            </T>
          </span>
          {/* Stated at the flip, because the change does not reach work
              already in flight and nothing else on this page would say so.
              Deliberately not a count: reading one would put a query on the
              editor's render path, and the sentence is true whether the
              queue holds one document or none. */}
          {deliveryModeFlipped(initial?.deliveryMode, deliveryMode) && (
            <span className="mt-1 block text-[12px] text-amber-700 dark:text-amber-300">
              <T>
                Documents already waiting for approval under this template keep the way
                they were set up when they were filed. This change applies to the ones
                your colleagues fill in from now on.
              </T>
            </span>
          )}
        </label>
      </div>

      <div className="rounded-lg border border-ink-200 bg-cream-50/60 p-3 dark:border-forest-700/50 dark:bg-forest-900/60">
        <p className="text-[13px] font-medium text-forest-900 dark:text-cream-100">
          <T>Import a document</T>
        </p>
        <p className="mt-0.5 text-[12px] text-ink-500 dark:text-cream-100/55">
          <T>
            Upload a document your team already uses. Bella reads it and suggests
            the body, the blanks to fill in and their types, and whether it needs
            to be signed. You review everything here first, and nothing is saved
            until you press Save.
          </T>
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void runImport(file);
            // Cleared so choosing the same file again still fires a change.
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={busy || importing}
          onClick={() => fileRef.current?.click()}
          className="btn-secondary mt-2 text-sm disabled:opacity-50"
        >
          {importing ? <T>Reading the document…</T> : <T>Choose a file</T>}
        </button>
        <span className="ml-2 text-[12px] text-ink-500 dark:text-cream-100/55">
          <T>PDF, Word (.docx) or plain text.</T>
        </span>
        {importError && (
          <p className="mt-2 text-[12.5px] text-rose-800 dark:text-rose-200">{importError}</p>
        )}
      </div>

      {imported && (
        <div className="rounded-lg border border-gold-500/30 bg-gold-500/5 p-3">
          <p className="text-[13px] font-semibold text-forest-900 dark:text-cream-100">
            <T>Check these suggestions before you publish</T>
          </p>
          <p className="mt-0.5 text-[12.5px] text-ink-600 dark:text-cream-100/70">
            <T>
              Bella filled the body, the fields and the delivery setting in from
              the file you uploaded. Read every field and every signature line
              against your own document and correct anything that is wrong.
              Nothing is saved until you press Save.
            </T>
          </p>
          {imported.notes.length > 0 && (
            <ul
              className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-ink-600 dark:text-cream-100/70"
              data-no-translate
            >
              {imported.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
          Body: use {'{{field_key}}'} where the employee should fill something in
        </span>
        <span className="mb-1 block text-[12px] text-ink-500 dark:text-cream-100/55">
          {'{{firm_name}}'} fills itself in with your firm&rsquo;s current name.
          Use it instead of typing the name, so a rename carries through to
          every document already published.
        </span>
        <textarea rows={14} className={`${inputCls} font-mono text-[12.5px]`} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>

      {/* Under the body, because that is where the text it is about is, and
          above everything else, because it is the one thing on this page that
          stops the Save buttons working. The tokens are quoted exactly as
          typed: an author hunting for `{{ client_name }}` in fourteen lines of
          agreement needs the spaces to find it. */}
      {unmerged.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="text-[13px] font-semibold">
            {unmerged.length === 1 ? (
              <T>Nothing will fill in this placeholder</T>
            ) : (
              <T>Nothing will fill in these placeholders</T>
            )}
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5" data-no-translate>
            {unmerged.map((token) => (
              <li
                key={token}
                className="rounded bg-amber-100/80 px-1.5 py-0.5 font-mono text-[11.5px] dark:bg-amber-900/40"
              >
                {token}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] leading-relaxed">
            <T>
              The document prints these exactly as they are written here, braces
              and all, in front of whoever receives it. A placeholder only fills
              itself in when it matches one of the fields below character for
              character: lower case letters, numbers and underscores, with no
              spaces inside the braces.
            </T>
          </p>
          <label className="mt-2.5 flex items-start gap-2 text-[12.5px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acknowledgedFor === unmergedSignature}
              onChange={(e) =>
                setAcknowledgedFor(e.target.checked ? unmergedSignature : null)
              }
            />
            <span>
              <T>
                I have read these and they are meant to print as they are. Saving
                is off until this is ticked or the placeholders are corrected.
              </T>
            </span>
          </label>
        </div>
      )}

      <div className="rounded-lg border border-ink-200 p-3.5 dark:border-forest-700/50">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
          <T>Page layout</T>
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-500 dark:text-cream-100/55">
          <T>
            This template follows your firm layout unless you take a part of it
            over here. Anything you leave to the firm keeps following it, so a
            change in firm settings reaches this template too.
          </T>
        </p>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-2">
          {LAYOUT_BANDS.map((band) => (
            <label
              key={band}
              className="flex items-center gap-2 text-[12.5px] text-forest-900 dark:text-cream-100"
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-gold-500"
                disabled={busy}
                checked={overriddenBands.has(band)}
                onChange={(e) => toggleBand(band, e.target.checked)}
              />
              <span data-no-translate>{LAYOUT_BAND_LABELS[band]}</span>
            </label>
          ))}
        </div>
        <div className="mt-3">
          <DocumentLayoutFields
            layout={layoutDraft}
            onChange={setLayoutDraft}
            has={letterhead}
            brandName={brandName}
            disabled={busy}
            lockedBands={LAYOUT_BANDS.filter((b) => !overriddenBands.has(b))}
          />
        </div>
      </div>

      {/* WHAT THE DOCUMENT SAYS, next to the list of what the template
          declares, because the two answer the same question from opposite
          ends: the Fields list below is every blank the author has already
          marked up, and this is every blank the document still carries that
          nobody has. Directly above Fields so that accepting a suggestion and
          seeing the field row appear is one glance. */}
      {body.trim() !== '' && (
        <div className="rounded-lg border border-edge p-3.5">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">
            <T>Blanks found in this document</T>
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            <T>
              Read from the body above. Nothing here is part of your template
              until you add it, and adding one writes a placeholder into the
              body where the rule is, so you can see exactly what changed.
            </T>
          </p>

          {addable.length > 0 && (
            <>
              <p className="mt-3 text-[12.5px] font-medium text-foreground">
                <T>Blanks somebody has to fill in</T>
              </p>
              {/* Said ONCE for the group, not on every row it applies to. The
                  first version repeated the whole sentence per blank, and on a
                  real NDA that is five identical lines of amber down the panel,
                  which is how a warning stops being read. The rows carry a
                  three-word marker and this explains what the marker means.
                  mergeTemplateDocument appends its own signature and date lines
                  per party, so a printed name or a date taken from inside an
                  execution block puts the same fact on the instrument twice.
                  Said, not decided: the author may genuinely want it. */}
              {addable.some((b) => b.inExecutionBlock) && (
                <p className="mt-1 text-[12px] leading-relaxed text-amber-700 dark:text-amber-300">
                  <T>
                    Some of these sit in the signature block, marked below. The
                    signature and date lines are added for you when the document
                    goes out, so adding one of those would put the same thing on
                    the page twice.
                  </T>
                </p>
              )}
              <ul className="mt-1.5 space-y-1.5">
                {addable.map((b) => (
                  <li key={identify(b)} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <code
                      className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground dark:bg-forest-800"
                      data-no-translate
                    >
                      {'{{'}
                      {b.key}
                      {'}}'}
                    </code>
                    <span className="text-[12.5px] text-foreground" data-no-translate>
                      {b.label}
                    </span>
                    {b.inExecutionBlock && (
                      <span className="text-[12px] text-amber-700 dark:text-amber-300">
                        <T>in the signature block</T>
                      </span>
                    )}
                    {/* Pushed to one edge so the actions line up down the list.
                        Left inline they followed a label and an optional marker,
                        both variable width, and landed at a different place on
                        every row. */}
                    <span className="ml-auto flex items-center gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => acceptBlank(b)}
                        className="text-[12.5px] font-medium text-accent-text hover:underline disabled:opacity-50"
                      >
                        <T>Add as a field</T>
                      </button>
                      <button
                        type="button"
                        onClick={() => dismiss(b)}
                        className="text-[12.5px] text-muted hover:text-danger-text"
                      >
                        <T>Not a field</T>
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(signaturePlaces.length > 0 || signatureEvidence) && (
            <>
              <p className="mt-3 text-[12.5px] font-medium text-foreground">
                <T>Places somebody signs</T>
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                <T>
                  These do not become fields. The signature and date lines are
                  added for you when the document goes out, so a rule left here
                  would be a second place to sign that nothing stamps and
                  nothing records.
                </T>
              </p>
              {signaturePlaces.length > 0 && (
                <ul className="mt-1.5 space-y-1.5">
                  {signaturePlaces.map((b) => (
                    <li key={identify(b)} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <code
                        className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground dark:bg-forest-800"
                        data-no-translate
                      >
                        {b.context}
                      </code>
                      <span className="ml-auto flex items-center gap-3">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removeRule(b)}
                          className="text-[12.5px] font-medium text-accent-text hover:underline disabled:opacity-50"
                        >
                          <T>Remove this rule</T>
                        </button>
                        <button
                          type="button"
                          onClick={() => dismiss(b)}
                          className="text-[12.5px] text-muted hover:text-danger-text"
                        >
                          <T>Leave it</T>
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {/* ONLY when there is nothing on the page to point at. "IN WITNESS
                  WHEREOF" and "[Signature Page Follows]" are both signed
                  documents carrying no rule at all, and this is the sentence for
                  them. Shown alongside a list of rules it just quotes one of the
                  rules back, which the list above has already said better. */}
              {signatureEvidence && signaturePlaces.length === 0 && (
                <p className="mt-1.5 text-[12px] text-muted">
                  <T>This body carries</T>{' '}
                  <span data-no-translate>{signatureEvidence}</span>.
                </p>
              )}
              {deliveryMode !== 'signature' && (
                <p className="mt-1.5 text-[12.5px]">
                  <span className="text-amber-700 dark:text-amber-300">
                    <T>
                      This template is set to go out as a secure read-only link,
                      so nobody will be asked to sign it.
                    </T>
                  </span>{' '}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDeliveryMode('signature')}
                    className="font-medium text-accent-text hover:underline disabled:opacity-50"
                  >
                    <T>Set it to go out for signature</T>
                  </button>
                </p>
              )}
            </>
          )}

          {unnamed.length > 0 && (
            <>
              <p className="mt-3 text-[12.5px] font-medium text-foreground">
                <T>Blanks with no name to give them</T>
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                <T>
                  There is a blank here but nothing beside it that says what goes
                  in it, so it is left alone rather than given an invented name.
                  If somebody should fill one in, put a placeholder where the
                  rule is and it becomes a field.
                </T>
              </p>
              <ul className="mt-1.5 space-y-1" data-no-translate>
                {unnamed.map((b) => (
                  <li
                    key={identify(b)}
                    className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground dark:bg-forest-800"
                  >
                    {b.context}
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* A body with nothing to find says so. An empty panel reads as a
              panel that failed rather than as a document with no blanks in it,
              and the two need to be told apart at a glance. */}
          {live.length === 0 && !signatureEvidence && (
            <p className="mt-3 text-[12.5px] text-muted">
              {detected.length === 0 ? (
                <T>
                  No blanks were found in this body. Type a placeholder in double
                  braces wherever somebody should fill something in, and it
                  becomes a field below.
                </T>
              ) : (
                <T>
                  Every blank found here has been set aside. Edit the body to
                  look again.
                </T>
              )}
            </p>
          )}
        </div>
      )}

      {fields.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55">
            Fields (from the body)
          </p>
          <p className="mb-2 text-[12px] text-ink-500 dark:text-cream-100/55">
            <T>
              A field the recipient fills in is left as a blank on the document
              your colleague sends. The recipient types it on the signing page
              and sees it in place before they sign. This only applies to
              templates that go out for signature.
            </T>
          </p>
          {/* Said here rather than left to be discovered by the person who
              receives the document. Nothing below is disabled: a firm may be
              drafting a template it means to switch over later, so the
              consequence is stated and the choice is left alone. */}
          {counterpartyFieldsGoUnfilled({ deliveryMode, fields }) && (
            <p className="mb-2 text-[12px] text-amber-700 dark:text-amber-300">
              <T>
                This template goes out as a secure link, so nobody will fill in the
                fields marked for the recipient: there is no signing page for them to
                type on, and the document prints those fields as their labels. Set them
                to Your colleague fills in, or change How this goes out to For
                signature.
              </T>
            </p>
          )}
          <div className="space-y-2">
            {fields.map((f) => (
              <div key={f.key} className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-cream-100 px-1.5 py-0.5 text-[11.5px] dark:bg-forest-800" data-no-translate>
                  {'{{'}{f.key}{'}}'}
                </code>
                {/* Which of these rows the author put there and which this page
                    suggested, while the difference can still change what they
                    do. It lasts as long as the editing session: once the
                    template is saved, the placeholder is in the author's own
                    body and there is nothing left to attribute. */}
                {fromDetection.has(f.key) && (
                  <span className="rounded bg-gold-500/15 px-1.5 py-0.5 text-[11px] text-accent-text">
                    <T>Suggested</T>
                  </span>
                )}
                <input
                  className={`${inputCls} !w-56`}
                  value={f.label}
                  onChange={(e) => setFieldMeta((m) => ({ ...m, [f.key]: { ...f, label: e.target.value } }))}
                />
                <select
                  className={`${inputCls} !w-32`}
                  value={f.type}
                  onChange={(e) =>
                    setFieldMeta((m) => ({ ...m, [f.key]: { ...f, type: e.target.value as TemplateField['type'] } }))
                  }
                >
                  <option value="text">Text</option>
                  <option value="date">Date</option>
                  <option value="textarea">Paragraph</option>
                </select>
                {/* Who fills this in. Only the legal team decides this, which
                    is why the control is here and nowhere else: the employee
                    filling a form must not be able to invent obligations for
                    the other side, and the counterparty must not be able to
                    invent fields for themselves. */}
                <select
                  className={`${inputCls} !w-44`}
                  value={f.party ?? 'employee'}
                  onChange={(e) =>
                    setFieldMeta((m) => ({
                      ...m,
                      [f.key]: {
                        ...f,
                        party:
                          e.target.value === 'counterparty' ? 'counterparty' : 'employee',
                      },
                    }))
                  }
                  aria-label={`Who fills in ${f.label}`}
                >
                  <option value="employee">Your colleague fills in</option>
                  <option value="counterparty">The recipient fills in</option>
                </select>
                <label className="flex items-center gap-1.5 text-[12.5px] text-ink-600 dark:text-cream-100/70">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => setFieldMeta((m) => ({ ...m, [f.key]: { ...f, required: e.target.checked } }))}
                  />
                  Required
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      <label className="flex items-start gap-2 rounded-lg border border-ink-200 bg-cream-50/60 p-3 dark:border-forest-700/50 dark:bg-forest-900/60">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={requiresApproval}
          onChange={(e) => setRequiresApproval(e.target.checked)}
        />
        <span className="text-[13px] text-ink-700 dark:text-cream-100/80">
          <span className="block font-medium text-forest-900 dark:text-cream-100">
            <T>Review this before it leaves the company</T>
          </span>
          <T>
            The employee fills it in and names the recipient, and it comes to the legal
            team first. It is sent only after an owner, admin, or attorney approves it.
            Turn this off only for documents employees may send on their own.
          </T>
        </span>
      </label>

      <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4 dark:border-forest-800/50">
        {/* Before the Save buttons, in reading order, because that is the
            order the decision is made in. Disabled on exactly the condition
            the Save buttons are disabled on, so what can be previewed and
            what can be saved are the same draft. */}
        <button
          type="button"
          disabled={busy || !name.trim() || !body.trim()}
          onClick={() => setPreviewOpen(true)}
          className="btn-secondary text-sm disabled:opacity-50"
        >
          <T>Preview as PDF</T>
        </button>
        {previewOpen && (
          <PdfPreviewDialog
            title={name.trim() || 'Template'}
            filename={`${(name.trim() || 'template').replace(/[^a-z0-9]+/gi, '-')}.pdf`}
            buildPdf={buildPreviewPdf}
            onClose={() => setPreviewOpen(false)}
            note={
              <>
                {/* Said on the preview as well as in the editor, because the
                    preview is where an author actually reads the page, and the
                    token is sitting in the PDF behind this sentence. */}
                {unmerged.length > 0 && (
                  <span className="mb-1.5 block font-medium text-amber-800 dark:text-amber-200">
                    <T>
                      This document still has placeholders nothing will fill in.
                      They are on the page below exactly as they are written in
                      the body, braces and all.
                    </T>
                  </span>
                )}
                <T>
                  This is your template drawn by the same renderer that produces the
                  document your colleague sends, on your firm&rsquo;s letterhead and this
                  template&rsquo;s page layout. Two things look different here: the blanks
                  show their labels until someone fills them in, and nothing has been
                  signed yet, so anything your firm shows on an unsigned page is not on
                  a signed one.
                </T>{' '}
                {deliveryMode === 'signature' && (
                  <T>
                    This template goes out for signature, so the copy that is sent also
                    carries a block naming the recipient and a place for them to sign,
                    added once your colleague has addressed it.
                  </T>
                )}
              </>
            }
          />
        )}
        {/* BOTH Save buttons wait on the acknowledgement, the draft one
            included. A draft is one click from published, and a firm that
            could park a broken body as a draft would have moved the same
            problem one step closer to a recipient with nothing said. */}
        <button
          type="button"
          disabled={busy || !name.trim() || !body.trim() || !placeholdersSettled}
          onClick={() =>
            onSave({
              id: initial?.id,
              name,
              description,
              category,
              body,
              fields,
              status: 'published',
              requiresApproval,
              documentLayout,
              deliveryMode,
              acknowledgeUnmergedPlaceholders: unmerged.length > 0,
            })
          }
          className="btn-primary disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save & publish'}
        </button>
        <button
          type="button"
          disabled={busy || !name.trim() || !body.trim() || !placeholdersSettled}
          onClick={() =>
            onSave({
              id: initial?.id,
              name,
              description,
              category,
              body,
              fields,
              status: 'draft',
              requiresApproval,
              documentLayout,
              deliveryMode,
              acknowledgeUnmergedPlaceholders: unmerged.length > 0,
            })
          }
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
