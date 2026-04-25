'use client';

import { useState, useTransition } from 'react';
import { rescanExhibitAction, transcribeExhibitAction } from '@/lib/actions';
import type { Exhibit, ScanData } from '@/lib/types';

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
  const ct = (exhibit.fileType || '').toLowerCase();
  const isMedia = ct.startsWith('audio/') || ct.startsWith('video/');
  const isScannable = ct.startsWith('image/') || ct === 'application/pdf';
  const scan = exhibit.scanData;

  function rescan() {
    setError(null);
    startTransition(async () => {
      try {
        await rescanExhibitAction(exhibit.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Scan failed.');
      }
    });
  }
  function transcribe() {
    setError(null);
    startTransition(async () => {
      try {
        await transcribeExhibitAction(exhibit.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Transcription failed.');
      }
    });
  }

  if (!scan) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {isMedia ? (
          <button
            type="button"
            onClick={transcribe}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-forest-200 bg-white text-forest-900 px-2.5 py-1 hover:bg-cream-50 hover:border-gold-500"
          >
            {pending ? <Spinner /> : <WaveIcon />}
            {pending ? 'Transcribing...' : 'Transcribe'}
          </button>
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
  const docLabel = DOC_TYPE_LABEL[scan.docType] ?? prettyDocType(scan.docType);
  const accent = accentForDocType(scan.docType);

  return (
    <details className="group mt-3 rounded-lg border border-ink-200 bg-cream-50/40 open:bg-cream-50">
      <summary className="cursor-pointer list-none px-3 py-2 flex items-start gap-2 hover:bg-cream-50/60 rounded-lg">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide ${accent}`}
        >
          <SparkIcon />
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
        {scan.transcript && (
          <Section title="Transcript">
            <p className="whitespace-pre-wrap leading-relaxed text-ink-800 max-h-56 overflow-y-auto bg-white border border-ink-200 rounded-md p-2.5">
              {scan.transcript}
            </p>
          </Section>
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
          <p className="text-[10.5px] text-ink-400 font-mono">
            Scanned {new Date(scan.scannedAt).toLocaleString()} · {scan.modelUsed}
            {scan.isDemo && ' · demo'}
          </p>
          <div className="flex gap-2">
            {isMedia && (
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
