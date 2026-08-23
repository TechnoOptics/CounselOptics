'use client';

import { useState, useTransition } from 'react';
import {
  rescanExhibitAction,
  saveManualTranscriptAction,
  transcribeExhibitAction,
} from '@/lib/actions';
import type { Exhibit, ScanData } from '@/lib/types';
import { formatDateTimeNumeric } from '@/lib/format';
import { exhibitIsScannable, exhibitIsTranscribable } from '@/lib/exhibit-reading';
import {
  MAX_MANUAL_TRANSCRIPT_CHARS,
  isManualTranscript,
  scanProvenanceLine,
  transcriptOriginHeading,
} from '@/lib/manual-transcript';

const DOC_TYPE_LABEL: Record<string, string> = {
  parking_ticket: 'Parking ticket',
  traffic_citation: 'Traffic citation',
  court_summons: 'Court summons',
  complaint: 'Complaint',
  motion: 'Motion',
  eviction_notice: 'Eviction notice',
  demand_letter: 'Demand letter',
  contract: 'Contract',
  receipt: 'Receipt',
  photo: 'Photo',
  screenshot: 'Screenshot',
  voice_note: 'Voice note',
  video: 'Video recording',
  other: 'Document',
};

export function ExhibitScan({ exhibit }: { exhibit: Exhibit }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Asked of lib/exhibit-reading.ts, not answered again here. This row once
  // carried its own copy of the rule, and when spreadsheets became readable
  // that copy would have gone on saying "No auto-scan for this file type" for
  // an expense sheet the server could read perfectly well.
  //
  // `isMedia` was the last surviving copy: it tested the declared content type
  // alone, so a voice memo uploaded as application/octet-stream, which is what
  // several phones send, got no controls on a row whose server action would
  // have accepted it. It now asks the same classification everything else
  // does, which is also what stops the transcript box appearing on a PDF.
  const isMedia = exhibitIsTranscribable(exhibit);
  const isScannable = exhibitIsScannable(exhibit);
  const scan = exhibit.scanData;
  // True when the text on this exhibit is a person's typing rather than a
  // tool's output. Everything this row says about the transcript turns on it.
  const typedByPerson = isManualTranscript(scan);

  // The actions RETURN their refusal. A thrown message is replaced by React
  // with "An error occurred in the Server Components render..." in a
  // production build, which is what this row used to display. The catch stays
  // for a genuine transport failure, where there is no value to read.
  function rescan() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await rescanExhibitAction(exhibit.id);
        if (!res?.ok) setError(res?.error || 'Scan failed.');
      } catch {
        setError('Scan failed. Check your connection and try again.');
      }
    });
  }
  function transcribe() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await transcribeExhibitAction(exhibit.id);
        if (!res?.ok) setError(res?.error || 'Transcription failed.');
      } catch {
        setError('Transcription failed. Check your connection and try again.');
      }
    });
  }

  if (!scan) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {isMedia ? (
          <>
            <button
              type="button"
              onClick={transcribe}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md border border-forest-200 bg-white text-forest-900 px-2.5 py-1 hover:bg-cream-50 hover:border-gold-500"
            >
              {pending ? <Spinner /> : <WaveIcon />}
              {pending ? 'Transcribing...' : 'Transcribe'}
            </button>
            <TranscriptEditor exhibitId={exhibit.id} initial="" />
          </>
        ) : isScannable ? (
          <button
            type="button"
            onClick={rescan}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-forest-200 bg-white text-forest-900 px-2.5 py-1 hover:bg-cream-50 hover:border-gold-500"
          >
            {pending ? <Spinner /> : <ScanIcon />}
            {pending ? 'Scanning...' : 'Scan now'}
          </button>
        ) : (
          <span className="text-ink-400">No auto-scan for this file type.</span>
        )}
        {error && (
          <span className="text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-0.5">
            {error}
          </span>
        )}
      </div>
    );
  }

  // We do have scan data - show summary + identifiers + collapsible detail.
  //
  // The chip is the first thing on the row, and for a typed transcript it must
  // not be the same chip an AI read gets. "Voice note" beside a spark reads as
  // something the software worked out; this text is one person's typing.
  const docLabel = typedByPerson
    ? 'Typed transcript'
    : (DOC_TYPE_LABEL[scan.docType] ?? prettyDocType(scan.docType));
  const accent = typedByPerson
    ? 'bg-white border border-ink-300 text-ink-700'
    : accentForDocType(scan.docType);

  return (
    <details className="group mt-3 rounded-lg border border-ink-200 bg-cream-50/40 open:bg-cream-50">
      <summary className="cursor-pointer list-none px-3 py-2 flex items-start gap-2 hover:bg-cream-50/60 rounded-lg">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${accent}`}
        >
          {typedByPerson ? <PenIcon /> : <SparkIcon />}
          {docLabel}
        </span>
        <span className="flex-1 text-xs text-ink-700 leading-relaxed line-clamp-2">
          {scan.summary}
        </span>
        <span
          aria-hidden
          className="text-ink-400 group-open:rotate-90 transition-transform text-[12px] flex-none mt-0.5"
        >
          ▸
        </span>
      </summary>

      <div className="px-4 pb-4 pt-1 space-y-3 text-xs text-ink-700">
        {scan.readNote && (
          <p className="rounded-md border border-ink-200 bg-white px-2.5 py-2 leading-relaxed text-ink-600">
            {scan.readNote}
          </p>
        )}

        {scan.transcript && (
          <Section title={transcriptOriginHeading(scan)}>
            <p className="whitespace-pre-wrap leading-relaxed text-ink-800 max-h-56 overflow-y-auto bg-white border border-ink-200 rounded-md p-2.5">
              {scan.transcript}
            </p>
          </Section>
        )}

        {isMedia && (
          <TranscriptEditor exhibitId={exhibit.id} initial={scan.transcript ?? ''} />
        )}

        {scan.identifiers && Object.keys(scan.identifiers).length > 0 && (
          <Section title="Identifiers">
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
              {Object.entries(scan.identifiers).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-ink-500 truncate" title={k}>
                    {prettyKey(k)}
                  </dt>
                  <dd className="font-mono text-ink-900 truncate">{v}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {scan.parties.length > 0 && (
          <Section title="Parties">
            <ul className="flex flex-wrap gap-1.5">
              {scan.parties.map((p, i) => (
                <li
                  key={i}
                  className="inline-flex items-center rounded-full bg-white border border-ink-200 px-2 py-0.5"
                >
                  {p}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {scan.dates.length > 0 && (
          <Section title="Dates">
            <ul className="space-y-0.5">
              {scan.dates.map((d, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-ink-500">{d.label}</span>
                  <span className="font-mono text-ink-900">{d.value}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(scan.amounts?.length ?? 0) > 0 && (
          <Section title="Amounts">
            <ul className="flex flex-wrap gap-1.5">
              {(scan.amounts ?? []).map((a, i) => (
                <li
                  key={i}
                  className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 text-amber-900 px-2 py-0.5"
                >
                  {a}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {(scan.statuteRefs?.length ?? 0) > 0 && (
          <Section title="Statute references">
            <ul className="flex flex-wrap gap-1.5">
              {(scan.statuteRefs ?? []).map((s, i) => (
                <li
                  key={i}
                  className="inline-flex items-center rounded-full bg-cream-50 border border-gold-300 text-forest-900 px-2 py-0.5 font-mono text-[10.5px]"
                >
                  {s}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {scan.jurisdiction && (
          <Section title="Jurisdiction">
            <p className="text-ink-800">{scan.jurisdiction}</p>
          </Section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-ink-200/60">
          {/* The provenance line, and it must not overstate what happened.
              "Scanned ... human-transcript" would be two untruths at once:
              nothing scanned anything, and the marker reads like a model id.
              The whole line is built in lib/manual-transcript.ts so that the
              rule is exercised by a test rather than living in JSX that a
              suite with no DOM cannot reach. */}
          <p className="text-[10.5px] text-ink-400 font-mono">
            {scanProvenanceLine(scan, formatDateTimeNumeric(scan.scannedAt))}
          </p>
          <div className="flex gap-2">
            {/* Re-transcribe is not offered over a transcript somebody typed.
                The action refuses it too, which is the check that counts; this
                keeps the row from offering a button that only ever refuses. */}
            {isMedia && !typedByPerson && (
              <button
                type="button"
                onClick={transcribe}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-forest-200 bg-white text-forest-900 px-2.5 py-1 hover:bg-cream-50 hover:border-gold-500"
              >
                {pending ? <Spinner /> : <WaveIcon />}
                Re-transcribe
              </button>
            )}
            {isScannable && (
              <button
                type="button"
                onClick={rescan}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-forest-200 bg-white text-forest-900 px-2.5 py-1 hover:bg-cream-50 hover:border-gold-500"
              >
                {pending ? <Spinner /> : <ScanIcon />}
                Re-scan
              </button>
            )}
          </div>
        </div>
        {error && (
          <p className="text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Type or paste in a transcript, and edit it again later.
 *
 * EDITING IS THE NORMAL CASE, not an afterthought. Somebody correcting a
 * mis-heard name the night before a hearing is exactly who this is for, so the
 * box opens holding whatever is already stored rather than empty.
 *
 * The textarea is deliberately plain. No auto-capitalisation, no spellcheck
 * rewriting, nothing that reflows: speaker labels, timestamps and blank lines
 * carry meaning, and the server stores the string byte for byte.
 *
 * The length is checked here only so the person sees the count while they
 * type. The refusal that matters is the server's, in
 * saveManualTranscriptAction, because this component decides nothing about
 * what may be written.
 */
function TranscriptEditor({ exhibitId, initial }: { exhibitId: string; initial: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(initial);
  const [saving, startSaving] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const overLimit = text.length > MAX_MANUAL_TRANSCRIPT_CHARS;
  const empty = text.trim().length === 0;

  function save() {
    setProblem(null);
    setSaved(false);
    startSaving(async () => {
      try {
        const res = await saveManualTranscriptAction(exhibitId, text);
        if (!res?.ok) setProblem(res?.error || 'That transcript could not be saved.');
        else setSaved(true);
      } catch {
        setProblem('That transcript could not be saved. Check your connection and try again.');
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-ink-300 bg-white text-ink-800 px-2.5 py-1 hover:bg-cream-50 hover:border-gold-500"
      >
        <PenIcon />
        {initial ? 'Edit transcript' : 'Add transcript'}
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-md border border-ink-200 bg-white p-3 space-y-2">
      <p className="text-[11px] text-ink-600 leading-relaxed">
        Transcribe the recording yourself and paste the text here. It is stored
        exactly as you type it, including speaker labels, timestamps and blank
        lines, and it is recorded as your own transcript rather than as
        something the software produced.
      </p>
      <label className="sr-only" htmlFor={`transcript-${exhibitId}`}>
        Transcript
      </label>
      <textarea
        id={`transcript-${exhibitId}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
        rows={10}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={'[00:00:04] Speaker 1: ...\n\n[00:00:11] Speaker 2: ...'}
        className="w-full rounded-md border border-ink-200 p-2 font-mono text-[11.5px] leading-relaxed text-ink-900 focus:border-gold-500 focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-[10.5px] font-mono ${overLimit ? 'text-rose-700' : 'text-ink-400'}`}>
          {text.length.toLocaleString('en-US')} /{' '}
          {MAX_MANUAL_TRANSCRIPT_CHARS.toLocaleString('en-US')} characters
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setText(initial);
              setProblem(null);
              setSaved(false);
            }}
            className="rounded-md border border-ink-200 bg-white text-ink-700 px-2.5 py-1 hover:bg-cream-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || empty || overLimit}
            className="inline-flex items-center gap-1.5 rounded-md border border-forest-200 bg-forest-900 text-white px-3 py-1 disabled:opacity-50"
          >
            {saving ? <Spinner /> : null}
            {saving ? 'Saving...' : 'Save transcript'}
          </button>
        </div>
      </div>
      {empty && (
        <p className="text-[10.5px] text-ink-500">
          Saving an empty box will not clear a transcript. To remove text, edit
          it and save.
        </p>
      )}
      {saved && !problem && (
        <p className="text-[11px] text-forest-800 bg-cream-50 border border-gold-200 rounded px-2 py-1">
          Saved. This transcript is recorded as yours, not as the software s.
        </p>
      )}
      {problem && (
        <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {problem}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gold-700 mb-1">
        {title}
      </p>
      <div>{children}</div>
    </div>
  );
}

function prettyKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyDocType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function accentForDocType(t: string): string {
  if (
    t === 'parking_ticket' ||
    t === 'traffic_citation' ||
    t === 'eviction_notice' ||
    t === 'demand_letter'
  ) {
    return 'bg-amber-50 border border-amber-200 text-amber-900';
  }
  if (t === 'court_summons' || t === 'complaint' || t === 'motion') {
    return 'bg-rose-50 border border-rose-200 text-rose-900';
  }
  if (t === 'voice_note' || t === 'video') {
    return 'bg-sky-50 border border-sky-200 text-sky-900';
  }
  if (t === 'contract' || t === 'receipt') {
    return 'bg-emerald-50 border border-emerald-200 text-emerald-900';
  }
  return 'bg-cream-50 border border-gold-200 text-forest-900';
}

function ScanIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 7V5a2 2 0 012-2h2M21 7V5a2 2 0 00-2-2h-2M3 17v2a2 2 0 002 2h2M21 17v2a2 2 0 01-2 2h-2M3 12h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function WaveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12h2M8 7v10M12 4v16M16 7v10M20 12h0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
/** A pen. Stands for a person having written this, everywhere the spark stands
 *  for the software having read it. */
function PenIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" fill="currentColor" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
