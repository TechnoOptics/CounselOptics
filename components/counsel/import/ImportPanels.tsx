'use client';

import { useRef, useState, useTransition } from 'react';
import { T } from '@/components/i18n/LocaleProvider';
import {
  importBulkDocumentAction,
  importCasesCsvAction,
  importClientsCsvAction,
  importEmployeesCsvAction,
  importJsonDumpAction,
  previewCsvAction,
  previewJsonDumpAction,
  type CasesImportMapping,
  type ClientsImportMapping,
  type EmployeesImportMapping,
} from '@/lib/import-actions';

/**
 * The four lanes of /counsel/import: Clients CSV, Cases CSV,
 * Bulk documents, JSON dump. Each is a self-contained client
 * component that talks to import-actions.ts via the wrapping
 * server-action calls. Kept in one file so the import page stays a
 * thin shell and shared atoms (panel header, file picker, toast)
 * live next to the only thing using them.
 */

/* ----- shared atoms ----- */

function PanelHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="eyebrow mb-1"><T>{eyebrow}</T></p>
      <h2 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        <T>{title}</T>
      </h2>
      <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
        <T>{description}</T>
      </p>
    </div>
  );
}

function Banner({
  tone,
  text,
}: {
  tone: 'ok' | 'warn' | 'error';
  text: string;
}) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-300/50 dark:ring-emerald-500/30 text-emerald-900 dark:text-emerald-200'
      : tone === 'warn'
        ? 'bg-amber-50 dark:bg-amber-950/30 ring-amber-300/60 dark:ring-amber-500/30 text-amber-900 dark:text-amber-200'
        : 'bg-rose-50 dark:bg-rose-950/30 ring-rose-300/50 dark:ring-rose-500/30 text-rose-900 dark:text-rose-200';
  return (
    <p className={`rounded-lg ring-1 px-4 py-3 text-sm ${cls}`}>{text}</p>
  );
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = String(reader.result ?? '');
      // dataURL: "data:<mime>;base64,XXXX", so strip the prefix.
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

/* ----- shared CSV preview state ----- */

type CsvPreview =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | {
      phase: 'ready';
      fileName: string;
      csvText: string;
      headers: string[];
      sample: Record<string, string>[];
      totalRows: number;
    }
  | { phase: 'error'; message: string };

function FilePickerCsv({
  state,
  setState,
  accept = '.csv,text/csv',
}: {
  state: CsvPreview;
  setState: (s: CsvPreview) => void;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  async function onPick(file: File) {
    setState({ phase: 'loading' });
    try {
      const text = await readFileAsText(file);
      const res = await previewCsvAction({ csvText: text, previewRows: 5 });
      if (!res.ok) {
        setState({ phase: 'error', message: res.error });
        return;
      }
      setState({
        phase: 'ready',
        fileName: file.name,
        csvText: text,
        headers: res.headers,
        sample: res.sample,
        totalRows: res.totalRows,
      });
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : 'Read failed.',
      });
    }
  }
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="btn-secondary"
      >
        {state.phase === 'ready' ? (
          <T>Choose a different CSV</T>
        ) : (
          <T>Choose CSV</T>
        )}
      </button>
      {state.phase === 'ready' && (
        <span className="ml-3 text-[12.5px] text-ink-600 dark:text-cream-100/60">
          {state.fileName} - {state.totalRows} <T>row</T>
          {state.totalRows === 1 ? '' : 's'} <T>detected</T>
        </span>
      )}
      {state.phase === 'loading' && (
        <span className="ml-3 text-[12.5px] text-ink-500 dark:text-cream-100/55">
          <T>Reading...</T>
        </span>
      )}
      {state.phase === 'error' && <Banner tone="error" text={state.message} />}
    </div>
  );
}

function CsvSampleTable({ preview }: { preview: CsvPreview }) {
  if (preview.phase !== 'ready') return null;
  return (
    <div className="card p-4 overflow-x-auto">
      <p className="text-[10px] uppercase tracking-[0.2em] text-cream-100/55 mb-2">
        <T>Preview - first</T> {preview.sample.length} <T>row</T>
        {preview.sample.length === 1 ? '' : 's'}
      </p>
      <table className="text-[12px] min-w-full">
        <thead>
          <tr>
            {preview.headers.map((h) => (
              <th
                key={h}
                className="text-left px-2 py-1 font-mono text-cream-100/70"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {preview.sample.map((r, i) => (
            <tr key={i} className="border-t border-forest-700/30">
              {preview.headers.map((h) => (
                <td
                  key={h}
                  className="px-2 py-1 text-cream-100/85 max-w-[18rem] truncate"
                >
                  {r[h]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MapDropdown({
  label,
  helper,
  headers,
  value,
  onChange,
  required,
}: {
  label: string;
  helper?: string;
  headers: string[];
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[12px] uppercase tracking-[0.16em] text-cream-100/55 mb-0.5">
        <T>{label}</T>
        {required ? ' *' : ''}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-forest-900/60 ring-1 ring-forest-700/40 rounded-md px-3 py-2 text-[13px] text-cream-100"
      >
        <option value=""><T>- not mapped -</T></option>
        {headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      {helper && (
        <span className="block text-[11px] text-cream-100/50 mt-1">
          <T>{helper}</T>
        </span>
      )}
    </label>
  );
}

/* ----- LANE 1: Clients CSV ----- */

export function ClientsImporter() {
  const [preview, setPreview] = useState<CsvPreview>({ phase: 'idle' });
  const [mapping, setMapping] = useState<ClientsImportMapping>({ email: '' });
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | null
    | {
        created: number;
        skipped: number;
        failures: Array<{ row: number; reason: string }>;
      }
    | { error: string }
  >(null);

  function submit() {
    if (preview.phase !== 'ready') return;
    setResult(null);
    startTransition(async () => {
      const res = await importClientsCsvAction({
        csvText: preview.csvText,
        mapping,
      });
      if (!res.ok) {
        setResult({ error: res.error });
        return;
      }
      setResult({
        created: res.created,
        skipped: res.skipped,
        failures: res.failures,
      });
    });
  }

  return (
    <section className="space-y-4">
      <PanelHeader
        eyebrow="Lane 1"
        title="Clients CSV"
        description={
          'Export your client roster from Clio, PracticePanther, a spreadsheet, anywhere. Map the email column (required) and any extras you have. Each unique email becomes an Advottic auth user + a firm_clients row; existing clients are skipped.'
        }
      />
      <FilePickerCsv state={preview} setState={setPreview} />
      <CsvSampleTable preview={preview} />

      {preview.phase === 'ready' && (
        <>
          <div className="card p-5 space-y-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-cream-100/55">
              <T>Map columns</T>
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <MapDropdown
                label="Email"
                required
                headers={preview.headers}
                value={mapping.email}
                onChange={(v) => setMapping((m) => ({ ...m, email: v }))}
              />
              <MapDropdown
                label="Display name"
                headers={preview.headers}
                value={mapping.displayName ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, displayName: v || undefined }))
                }
              />
              <MapDropdown
                label="Status"
                helper="active / invited / archived. Anything else -> invited."
                headers={preview.headers}
                value={mapping.status ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, status: v || undefined }))
                }
              />
              <MapDropdown
                label="Primary attorney email"
                helper="If set + matched to a firm member, overrides the firm default (paralegal)."
                headers={preview.headers}
                value={mapping.attorneyEmail ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, attorneyEmail: v || undefined }))
                }
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !mapping.email}
              onClick={submit}
            >
              {pending ? (
                <T>Importing...</T>
              ) : (
                <>
                  <T>Import</T> {preview.totalRows}{' '}
                  <T>{preview.totalRows === 1 ? 'client' : 'clients'}</T>
                </>
              )}
            </button>
            <span className="text-[11px] text-cream-100/55">
              <T>Unassigned rows default to the firm&rsquo;s paralegal.</T>
            </span>
          </div>
        </>
      )}

      {result && 'error' in result && <Banner tone="error" text={result.error} />}
      {result && 'created' in result && (
        <ResultPanel
          summary={`Imported ${result.created} client${result.created === 1 ? '' : 's'}`}
          subline={
            result.skipped > 0
              ? `${result.skipped} already on the firm and skipped.`
              : undefined
          }
          failures={result.failures}
        />
      )}
    </section>
  );
}

/* ----- LANE: Employees CSV (#8) ----- */

export function EmployeesImporter() {
  const [preview, setPreview] = useState<CsvPreview>({ phase: 'idle' });
  const [mapping, setMapping] = useState<EmployeesImportMapping>({ email: '' });
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | null
    | {
        created: number;
        skipped: number;
        failures: Array<{ row: number; reason: string }>;
      }
    | { error: string }
  >(null);

  function submit() {
    if (preview.phase !== 'ready') return;
    setResult(null);
    startTransition(async () => {
      const res = await importEmployeesCsvAction({
        csvText: preview.csvText,
        mapping,
      });
      if (!res.ok) {
        setResult({ error: res.error });
        return;
      }
      setResult({
        created: res.created,
        skipped: res.skipped,
        failures: res.failures,
      });
    });
  }

  return (
    <section className="space-y-4">
      <PanelHeader
        eyebrow="Lane"
        title="Employees CSV"
        description={
          'Export your people roster from ServiceNow, Workday, an HRIS, or a spreadsheet. Map the email column (required) and any extras. Each person becomes a pre-provisioned Hub account with their details already filled in - it links to them automatically the first time they sign in with that email. Existing employees are skipped.'
        }
      />
      <FilePickerCsv state={preview} setState={setPreview} />
      <CsvSampleTable preview={preview} />

      {preview.phase === 'ready' && (
        <>
          <div className="card p-5 space-y-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-cream-100/55">
              <T>Map columns</T>
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <MapDropdown
                label="Email"
                required
                headers={preview.headers}
                value={mapping.email}
                onChange={(v) => setMapping((m) => ({ ...m, email: v }))}
              />
              <MapDropdown
                label="Display name"
                headers={preview.headers}
                value={mapping.displayName ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, displayName: v || undefined }))
                }
              />
              <MapDropdown
                label="Department"
                headers={preview.headers}
                value={mapping.department ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, department: v || undefined }))
                }
              />
              <MapDropdown
                label="Role key"
                helper="Optional portal role key (from Team → Roles). Blank = default access."
                headers={preview.headers}
                value={mapping.roleKey ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, roleKey: v || undefined }))
                }
              />
              <MapDropdown
                label="External ID"
                helper="Optional source system ID (e.g. ServiceNow sys_id) for later reconciliation."
                headers={preview.headers}
                value={mapping.externalId ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, externalId: v || undefined }))
                }
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !mapping.email}
              onClick={submit}
            >
              {pending ? (
                <T>Importing...</T>
              ) : (
                <>
                  <T>Import</T> {preview.totalRows}{' '}
                  {preview.totalRows === 1 ? <T>person</T> : <T>people</T>}
                </>
              )}
            </button>
            <span className="text-[11px] text-cream-100/55">
              <T>No email is sent; accounts activate on first sign-in.</T>
            </span>
          </div>
        </>
      )}

      {result && 'error' in result && <Banner tone="error" text={result.error} />}
      {result && 'created' in result && (
        <ResultPanel
          summary={`Pre-provisioned ${result.created} ${result.created === 1 ? 'person' : 'people'}`}
          subline={
            result.skipped > 0
              ? `${result.skipped} already on the firm and skipped.`
              : undefined
          }
          failures={result.failures}
        />
      )}
    </section>
  );
}

/* ----- LANE 2: Cases CSV ----- */

export function CasesImporter() {
  const [preview, setPreview] = useState<CsvPreview>({ phase: 'idle' });
  const [mapping, setMapping] = useState<CasesImportMapping>({ title: '' });
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<
    | null
    | { created: number; failures: Array<{ row: number; reason: string }> }
    | { error: string }
  >(null);

  function submit() {
    if (preview.phase !== 'ready') return;
    setResult(null);
    startTransition(async () => {
      const res = await importCasesCsvAction({
        csvText: preview.csvText,
        mapping,
      });
      if (!res.ok) {
        setResult({ error: res.error });
        return;
      }
      setResult({ created: res.created, failures: res.failures });
    });
  }

  return (
    <section className="space-y-4">
      <PanelHeader
        eyebrow="Lane 2"
        title="Cases CSV"
        description={
          'Bulk-create case shells from a CSV. Title is required; the rest map onto the same fields the New Case form uses. Imported cases land in the firm vault assigned to the importer; link them to a client from the Cases page once both sides are migrated.'
        }
      />
      <FilePickerCsv state={preview} setState={setPreview} />
      <CsvSampleTable preview={preview} />

      {preview.phase === 'ready' && (
        <>
          <div className="card p-5 space-y-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-cream-100/55">
              <T>Map columns</T>
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              <MapDropdown
                label="Title"
                required
                headers={preview.headers}
                value={mapping.title}
                onChange={(v) => setMapping((m) => ({ ...m, title: v }))}
              />
              <MapDropdown
                label="Subject name"
                headers={preview.headers}
                value={mapping.subjectName ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, subjectName: v || undefined }))
                }
              />
              <MapDropdown
                label="Subject type"
                helper="individual / business / vehicle / other."
                headers={preview.headers}
                value={mapping.subjectType ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, subjectType: v || undefined }))
                }
              />
              <MapDropdown
                label="Case type"
                helper="contract / employment / family / criminal / etc."
                headers={preview.headers}
                value={mapping.caseType ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, caseType: v || undefined }))
                }
              />
              <MapDropdown
                label="State"
                headers={preview.headers}
                value={mapping.jurisdictionState ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({
                    ...m,
                    jurisdictionState: v || undefined,
                  }))
                }
              />
              <MapDropdown
                label="City"
                headers={preview.headers}
                value={mapping.jurisdictionCity ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({
                    ...m,
                    jurisdictionCity: v || undefined,
                  }))
                }
              />
              <MapDropdown
                label="Status"
                headers={preview.headers}
                value={mapping.status ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, status: v || undefined }))
                }
              />
              <MapDropdown
                label="Description"
                headers={preview.headers}
                value={mapping.description ?? ''}
                onChange={(v) =>
                  setMapping((m) => ({ ...m, description: v || undefined }))
                }
              />
            </div>
          </div>

          <button
            type="button"
            className="btn-primary"
            disabled={pending || !mapping.title}
            onClick={submit}
          >
            {pending ? (
              <T>Importing...</T>
            ) : (
              <>
                <T>Import</T> {preview.totalRows}{' '}
                <T>{preview.totalRows === 1 ? 'case' : 'cases'}</T>
              </>
            )}
          </button>
        </>
      )}

      {result && 'error' in result && <Banner tone="error" text={result.error} />}
      {result && 'created' in result && (
        <ResultPanel
          summary={`Imported ${result.created} case${result.created === 1 ? '' : 's'}`}
          failures={result.failures}
        />
      )}
    </section>
  );
}

/* ----- LANE 3: Bulk documents ----- */

export function DocumentsImporter() {
  const [tag, setTag] = useState('migration');
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<
    null | { uploaded: number; failed: Array<{ name: string; reason: string }> }
  >(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function upload(files: FileList) {
    setResult(null);
    setPending(true);
    const list = Array.from(files);
    setProgress({ done: 0, total: list.length });
    let uploaded = 0;
    const failed: Array<{ name: string; reason: string }> = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      try {
        if (f.size > 50 * 1024 * 1024) {
          failed.push({ name: f.name, reason: 'Over 50 MB cap.' });
          setProgress({ done: i + 1, total: list.length });
          continue;
        }
        const base64 = await readFileAsBase64(f);
        const res = await importBulkDocumentAction({
          fileName: f.name,
          mimeType: f.type || 'application/octet-stream',
          base64,
          options: { tag: tag || null },
        });
        if (!res.ok) {
          failed.push({ name: f.name, reason: res.error });
        } else {
          uploaded += 1;
        }
      } catch (err) {
        failed.push({
          name: f.name,
          reason: err instanceof Error ? err.message : 'upload failed',
        });
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setPending(false);
    setResult({ uploaded, failed });
  }

  return (
    <section className="space-y-4">
      <PanelHeader
        eyebrow="Lane 3"
        title="Bulk document upload"
        description={
          'Drag a folder of files (PDF, DOCX, images, anything) or pick them all at once. Each lands in the firm vault tagged so you can find them later. 50 MB per file cap on this surface.'
        }
      />
      <div className="card p-5 space-y-3">
        <label className="block">
          <span className="block text-[12px] uppercase tracking-[0.16em] text-cream-100/55 mb-0.5">
            <T>Tag for this batch</T>
          </span>
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="migration"
            className="w-full bg-forest-900/60 ring-1 ring-forest-700/40 rounded-md px-3 py-2 text-[13px] text-cream-100"
          />
          <span className="block text-[11px] text-cream-100/50 mt-1">
            <T>All uploaded files get this tag plus &ldquo;imported&rdquo; so the Documents page can filter to just this batch.</T>
          </span>
        </label>
        <input
          ref={inputRef}
          type="file"
          multiple
          // The non-standard webkitdirectory / directory attributes
          // let users drop an entire folder. They aren't in React's
          // typings, so spread them via a cast - plain multi-select
          // still works in browsers that ignore the attribute.
          {...({
            webkitdirectory: 'true',
            directory: 'true',
          } as Record<string, string>)}
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              upload(e.target.files);
            }
          }}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="btn-primary"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? <T>Uploading...</T> : <T>Choose files / folder</T>}
          </button>
          {progress && (
            <span className="text-[12.5px] text-cream-100/65">
              {progress.done} / {progress.total} <T>processed</T>
            </span>
          )}
        </div>
      </div>

      {result && (
        <ResultPanel
          summary={`Uploaded ${result.uploaded} file${result.uploaded === 1 ? '' : 's'}`}
          failures={result.failed.map((f, i) => ({
            row: i + 1,
            reason: `${f.name}: ${f.reason}`,
          }))}
        />
      )}
    </section>
  );
}

/* ----- LANE 4: JSON dump ----- */

export function JsonDumpImporter() {
  const [text, setText] = useState('');
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<
    null | { clients: number; cases: number; intakes: number } | { error: string }
  >(null);
  const [result, setResult] = useState<
    null
    | {
        clientsCreated: number;
        casesCreated: number;
        intakesCreated: number;
        failures: string[];
      }
    | { error: string }
  >(null);

  function check() {
    setPreview(null);
    setResult(null);
    startTransition(async () => {
      const res = await previewJsonDumpAction({ jsonText: text });
      if (!res.ok) {
        setPreview({ error: res.error });
        return;
      }
      setPreview(res.counts);
    });
  }

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await importJsonDumpAction({ jsonText: text });
      if (!res.ok) {
        setResult({ error: res.error });
        return;
      }
      setResult({
        clientsCreated: res.clientsCreated,
        casesCreated: res.casesCreated,
        intakesCreated: res.intakesCreated,
        failures: res.failures,
      });
    });
  }

  return (
    <section className="space-y-4">
      <PanelHeader
        eyebrow="Lane 4"
        title="JSON data dump"
        description={
          'Paste a JSON envelope with { clients: [], cases: [], intakes: [] }. Use this when migrating from another Advottic install or a structured tool. Each section runs independently; failures on one row never block the rest.'
        }
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder='{ "clients": [{ "email": "alice@example.com", "display_name": "Alice" }], "cases": [{ "title": "Sample matter" }] }'
        className="w-full font-mono text-[12px] bg-forest-900/60 ring-1 ring-forest-700/40 rounded-md px-3 py-2 text-cream-100"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          className="btn-secondary"
          disabled={pending || !text.trim()}
          onClick={check}
        >
          {pending ? <T>Checking...</T> : <T>Preview</T>}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={pending || !text.trim() || !(preview && !('error' in preview))}
          onClick={run}
        >
          {pending ? <T>Importing...</T> : <T>Run import</T>}
        </button>
      </div>
      {preview && 'error' in preview && <Banner tone="error" text={preview.error} />}
      {preview && !('error' in preview) && (
        <Banner
          tone="ok"
          text={`Preview: ${preview.clients} client${preview.clients === 1 ? '' : 's'}, ${preview.cases} case${preview.cases === 1 ? '' : 's'}, ${preview.intakes} intake${preview.intakes === 1 ? '' : 's'} ready to import.`}
        />
      )}
      {result && 'error' in result && <Banner tone="error" text={result.error} />}
      {result && !('error' in result) && (
        <ResultPanel
          summary={`Imported ${result.clientsCreated} client${result.clientsCreated === 1 ? '' : 's'}, ${result.casesCreated} case${result.casesCreated === 1 ? '' : 's'}, ${result.intakesCreated} intake${result.intakesCreated === 1 ? '' : 's'}.`}
          failures={result.failures.map((f, i) => ({
            row: i + 1,
            reason: f,
          }))}
        />
      )}
    </section>
  );
}

/* ----- shared result panel ----- */

function ResultPanel({
  summary,
  subline,
  failures,
}: {
  summary: string;
  subline?: string;
  failures: Array<{ row: number; reason: string }>;
}) {
  return (
    <div className="card p-5 space-y-2">
      <p className="font-display text-lg text-forest-900 dark:text-cream-100">
        {summary}
      </p>
      {subline && (
        <p className="text-[13px] text-cream-100/65">{subline}</p>
      )}
      {failures.length > 0 && (
        <details className="mt-2">
          <summary className="text-[12.5px] text-rose-300 cursor-pointer">
            {failures.length}{' '}
            <T>
              {failures.length === 1
                ? 'failure - expand to inspect'
                : 'failures - expand to inspect'}
            </T>
          </summary>
          <ul className="mt-2 space-y-1 text-[12px] text-cream-100/85 max-h-56 overflow-y-auto">
            {failures.map((f, i) => (
              <li key={i} className="font-mono">
                #{f.row}: {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
