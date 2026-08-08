'use client';

import { useRef, useState } from 'react';
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
} from '@/lib/firm-template-placeholders';
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
            <ul className="divide-y divide-ink-100 overflow-hidden rounded-xl border border-ink-200 dark:divide-forest-800/50 dark:border-forest-700/50">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-3 bg-white px-4 py-3 dark:bg-forest-900/40">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-forest-900 dark:text-cream-100">
                      {t.name}
                      {t.category && (
                        <span className="ml-2 rounded-full bg-gold-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-gold-700 ring-1 ring-gold-500/25 dark:text-gold-300">
                          {t.category}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[12px] text-ink-500 dark:text-cream-100/55">
                      {t.fields.length} field{t.fields.length === 1 ? '' : 's'}
                      {' · '}
                      {t.requiresApproval ? (
                        <T>reviewed before it is sent</T>
                      ) : (
                        <T>employees send it themselves</T>
                      )}
                      {t.description ? ` · ${t.description}` : ''}
                    </p>
                  </div>
                  <StatusPill
                    color={
                      t.status === 'published'
                        ? PILL_COLORS.good
                        : PILL_COLORS.neutral
                    }
                  >
                    {t.status}
                  </StatusPill>
                  <button
                    type="button"
                    onClick={() => setEditing(t)}
                    className="text-[13px] font-medium text-gold-700 hover:underline dark:text-gold-300"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void archive(t.id)}
                    className="text-[13px] text-ink-400 hover:text-rose-600 dark:text-cream-100/40"
                  >
                    Archive
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
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
        <button
          type="button"
          disabled={busy || !name.trim() || !body.trim()}
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
              deliveryMode,
              documentLayout,
            })
          }
          className="btn-primary disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save & publish'}
        </button>
        <button
          type="button"
          disabled={busy || !name.trim() || !body.trim()}
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
              deliveryMode,
              documentLayout,
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
