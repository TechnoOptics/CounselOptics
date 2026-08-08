'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  removeFirmDocumentLayoutAction,
  saveFirmDocumentLayoutAction,
} from '@/lib/firm-actions';
import {
  DEFAULT_DOCUMENT_LAYOUT,
  normalizeDocumentLayout,
  type DocumentLayout,
} from '@/lib/document-layout';
import {
  DocumentLayoutFields,
  type LetterheadAvailability,
} from '@/components/counsel/DocumentLayoutFields';
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * The firm's own page layout, which every document it produces starts from.
 *
 * A template can override any part of this in the forms editor; whatever it
 * does not name it inherits from here, and keeps inheriting when this changes.
 *
 * Saving cannot move a document that has already been rendered. A document's
 * bytes and the geometry of every blank the other side fills in are stored at
 * first render, and nothing re-renders one, so this changes what the next
 * document looks like and nothing that is already out for signature. The panel
 * says so, because a legal team about to widen a margin will want to know.
 */
export function DocumentLayoutBuilder({
  firmId,
  initial,
  has,
  brandName,
}: {
  firmId: string;
  initial: DocumentLayout | null;
  has: LetterheadAvailability;
  brandName: string;
}) {
  const t = useT();
  const router = useRouter();
  const [layout, setLayout] = useState<DocumentLayout>(initial ?? DEFAULT_DOCUMENT_LAYOUT);
  const [configured, setConfigured] = useState(initial !== null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, startTransition] = useTransition();

  const change = (next: DocumentLayout) => {
    setOk(false);
    setError(null);
    setLayout(next);
  };

  const save = () => {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await saveFirmDocumentLayoutAction(firmId, layout);
      if (res.ok) {
        setOk(true);
        setConfigured(true);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save the layout.'));
      }
    });
  };

  const reset = () => {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await removeFirmDocumentLayoutAction(firmId);
      if (res.ok) {
        setLayout(normalizeDocumentLayout(null));
        setConfigured(false);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not go back to the standard layout.'));
      }
    });
  };

  return (
    <div className="space-y-4">
      <DocumentLayoutFields
        layout={layout}
        onChange={change}
        has={has}
        brandName={brandName}
        disabled={pending}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>
          {pending ? <T>Saving...</T> : <T>Save layout</T>}
        </button>
        {configured && (
          <button
            type="button"
            className="text-[12.5px] text-rose-700 hover:underline disabled:opacity-50 dark:text-rose-300"
            disabled={pending}
            onClick={reset}
          >
            <T>Go back to the standard layout</T>
          </button>
        )}
        {ok && !error && (
          <span className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
            <T>Saved. New documents will use this layout.</T>
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </p>
      )}
    </div>
  );
}
