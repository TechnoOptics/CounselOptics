'use client';

import { useState } from 'react';
import {
  createFirmTemplateAction,
  updateFirmTemplateAction,
  type FirmTemplate,
} from '@/lib/firm-templates';
import type { DocumentLayout } from '@/lib/document-layout';
import type { LetterheadAvailability } from '@/components/counsel/DocumentLayoutFields';
import { EmptyState } from '@/components/counsel/ui';
import { TemplateCards } from './template-cards';
import { TemplateEditor, type TemplateDraft } from './template-editor';

/**
 * The firm's form templates: the list, and the one being edited.
 *
 * Only the switch between those two and the writes themselves live here.
 * The list is ./template-cards.tsx and the editor is ./template-editor.tsx,
 * which is in turn four sections under ./document-tab.tsx, ./fields-tab.tsx,
 * ./signature-tab.tsx and ./preview-tab.tsx. They were one file of about
 * fourteen hundred lines, which is how the body editor, the field panel and
 * the signature rules came to be one unbroken scroll.
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

  const save = async (draft: TemplateDraft) => {
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
