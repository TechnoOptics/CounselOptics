'use client';

import { useRef } from 'react';
import {
  DocumentLayoutFields,
  type LetterheadAvailability,
} from '@/components/counsel/DocumentLayoutFields';
import type { DocumentLayout } from '@/lib/document-layout';
import { T } from '@/components/i18n/LocaleProvider';
import {
  INPUT_CLS,
  LAYOUT_BANDS,
  LAYOUT_BAND_LABELS,
  type LayoutBand,
} from './template-editor-model';

/**
 * WHAT THE DOCUMENT IS: its name, where its text came from, the text
 * itself, and how it sits on the page.
 *
 * The unmerged-placeholder notice lives here, directly under the body,
 * because that is where the text it is about is. It is the one thing in
 * this editor that holds the Save buttons, so the editor ALSO carries a
 * standing banner outside the sections; see template-editor.tsx.
 */
export function DocumentTab({
  busy,
  name,
  setName,
  category,
  setCategory,
  description,
  setDescription,
  body,
  setBody,
  importing,
  importError,
  imported,
  onImport,
  unmerged,
  unmergedSignature,
  acknowledgedFor,
  setAcknowledgedFor,
  letterhead,
  brandName,
  layoutDraft,
  setLayoutDraft,
  overriddenBands,
  toggleBand,
}: {
  busy: boolean;
  name: string;
  setName: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  importing: boolean;
  importError: string | null;
  imported: { notes: string[] } | null;
  onImport: (file: File) => void;
  unmerged: string[];
  unmergedSignature: string;
  acknowledgedFor: string | null;
  setAcknowledgedFor: (v: string | null) => void;
  letterhead: LetterheadAvailability;
  brandName: string;
  layoutDraft: DocumentLayout;
  setLayoutDraft: (next: DocumentLayout) => void;
  overriddenBands: Set<LayoutBand>;
  toggleBand: (band: LayoutBand, on: boolean) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">Name</span>
          <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} placeholder="Mutual NDA" />
        </label>
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">Category</span>
          <input className={INPUT_CLS} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="NDA" />
        </label>
        <label className="sm:col-span-1">
          <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">Description</span>
          <input
            className={INPUT_CLS}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Standard mutual NDA for pilots and vendor talks"
          />
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
            if (file) onImport(file);
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
        <textarea rows={14} className={`${INPUT_CLS} font-mono text-[12.5px]`} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>

      {/* Under the body, because that is where the text it is about is, and
          above everything else, because it is the one thing on this page that
          stops the Save buttons working. The tokens are quoted exactly as
          typed: an author hunting for `{{ client_name }}` in fourteen lines of
          agreement needs the spaces to find it. */}
      {unmerged.length > 0 && (
        <div
          id="unmerged-placeholders"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/30 dark:text-amber-100"
        >
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
              id="unmerged-ack"
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
    </div>
  );
}
