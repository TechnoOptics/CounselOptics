'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadFirmDocumentAction } from '@/lib/firm-actions';
import {
  FIRM_DOCUMENT_STATUS_LABEL,
  type FirmDocumentStatus,
} from '@/lib/firm-types';
import type { Case } from '@/lib/types';

/**
 * Upload + classify a firm document. The form has three layers:
 *   - File + display name
 *   - Case linkage + initial status (received vs submitted - is this
 *     incoming from a counterparty or generated internally?)
 *   - Description, tags, due date for tracking
 *
 * Documents are seldom orphaned in a law-firm context, so the case
 * picker is right next to the file input rather than buried in an
 * "advanced" section.
 */
export function UploadDocumentForm({
  firmId,
  cases,
}: {
  firmId: string;
  cases: Case[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string>('');
  const [expanded, setExpanded] = useState(false);

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await uploadFirmDocumentAction(firmId, formData);
      if (res.ok) {
        formRef.current?.reset();
        setFileLabel('');
        setExpanded(false);
        router.refresh();
      } else {
        setError(res.error ?? 'Upload failed.');
      }
    });
  }

  // Initial-status options: when uploading we typically pick between
  // "received" (incoming from the other side) and "submitted" (we
  // produced this internally). The richer states (sent, signed_*,
  // overdue, on_hold, canceled) are reached after the doc starts
  // moving through the workflow, not at upload time.
  const INITIAL_STATUSES: FirmDocumentStatus[] = [
    'submitted',
    'received',
    'ready',
  ];

  return (
    <form ref={formRef} action={submit} className="card p-5 sm:p-6 space-y-3">
      <p className="eyebrow">Upload a document</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            File
          </span>
          <label
            htmlFor="firm-doc-file"
            className="btn-secondary cursor-pointer inline-flex"
          >
            Choose file
          </label>
          <span className="ml-3 text-sm text-ink-500 dark:text-cream-100/55 truncate">
            {fileLabel || 'No file selected'}
          </span>
          <input
            id="firm-doc-file"
            name="file"
            type="file"
            required
            disabled={pending}
            className="sr-only"
            onChange={(e) =>
              setFileLabel(e.currentTarget.files?.[0]?.name ?? '')
            }
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Display name (optional)
          </span>
          <input name="name" placeholder="Renewal lease - 2026" className="input" />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Attach to case{' '}
            {cases.length === 0 && (
              <span className="text-ink-500 dark:text-cream-100/70 font-normal">
                (no cases yet - create one in the Cases tab)
              </span>
            )}
          </span>
          <select
            name="caseId"
            className="input"
            defaultValue=""
            disabled={pending || cases.length === 0}
          >
            <option value="">No case (general firm document)</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Initial status
          </span>
          <select name="status" className="input" defaultValue="submitted">
            {INITIAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FIRM_DOCUMENT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[12px] font-medium text-ink-600 dark:text-cream-100/70 hover:text-ink-900 dark:hover:text-cream-100 underline"
        >
          {expanded ? 'Hide' : 'Add'} description, tags, and due date
        </button>
      </div>

      {expanded && (
        <div className="space-y-3 rounded-lg p-4 bg-ink-50/40 dark:bg-forest-900/30 ring-1 ring-ink-200 dark:ring-forest-700/40">
          <label className="block">
            <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
              Description{' '}
              <span className="text-ink-500 dark:text-cream-100/70 font-normal">
                (context, scope, what this is for)
              </span>
            </span>
            <textarea
              name="description"
              rows={3}
              placeholder="Counterparty draft of the renewal lease, redlines incoming..."
              className="input"
            />
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Tags{' '}
                <span className="text-ink-500 dark:text-cream-100/70 font-normal">
                  (comma-separated)
                </span>
              </span>
              <input
                name="tags"
                placeholder="lease, renewal, draft"
                className="input"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
                Due date (optional)
              </span>
              <input
                type="datetime-local"
                name="dueAt"
                className="input"
              />
            </label>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
          Up to 50 MB. Stored encrypted in private firm vault.
        </p>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Uploading...' : 'Upload'}
        </button>
      </div>
      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}
    </form>
  );
}
