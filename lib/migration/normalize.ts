/**
 * Source adapters: turn raw input into a normalized MigrationBundle.
 * Add a new platform by adding a case here + a branch in normalizeToBundle.
 */
import { parseCsv } from '../csv';
import type {
  MigrationAttachment,
  MigrationBundle,
  MigrationCase,
  MigrationSourceInput,
} from './types';

export async function normalizeToBundle(
  input: MigrationSourceInput,
): Promise<MigrationBundle> {
  switch (input.kind) {
    case 'json':
      return jsonToBundle(input.text);
    case 'csv':
      return csvToBundle(input.text, input.mapping);
    case 'servicenow':
      return serviceNowToBundle(input);
  }
}

/** A full export already in our universal shape (the richest path). */
function jsonToBundle(text: string): MigrationBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const obj = parsed as Partial<MigrationBundle>;
  if (!obj || !Array.isArray(obj.cases)) {
    throw new Error('JSON must be an object with a "cases" array.');
  }
  return {
    source: typeof obj.source === 'string' ? obj.source : 'JSON import',
    cases: obj.cases as MigrationCase[],
  };
}

/** Flat CSV of records (no binaries; use JSON/connector for attachments). */
function csvToBundle(text: string, mapping: Record<string, string>): MigrationBundle {
  const { rows } = parseCsv(text);
  // mapping maps our field -> the CSV header; rows are keyed by header.
  const val = (row: Record<string, string>, field: string) => {
    const h = mapping[field];
    return h ? (row[h] ?? '').trim() : '';
  };
  const cases: MigrationCase[] = rows
    .map((row) => ({
      title: val(row, 'title') || 'Imported matter',
      subjectName: val(row, 'subjectName') || undefined,
      caseType: val(row, 'caseType') || undefined,
      status: val(row, 'status') || undefined,
      description: val(row, 'description') || undefined,
      jurisdictionState: val(row, 'jurisdictionState') || undefined,
      jurisdictionCity: val(row, 'jurisdictionCity') || undefined,
      openedAt: val(row, 'openedAt') || undefined,
    }))
    .filter((c) => c.title);
  return { source: 'CSV import', cases };
}

/**
 * ServiceNow Table API + Attachment API adapter. Pulls records from a
 * table (default: incident), maps the common fields, and downloads each
 * record's attachments inline. Requires a valid instance URL + token;
 * validate against a real instance before relying on it in production.
 */
async function serviceNowToBundle(
  input: Extract<MigrationSourceInput, { kind: 'servicenow' }>,
): Promise<MigrationBundle> {
  const base = input.instanceUrl.replace(/\/+$/, '');
  const table = input.table || 'incident';
  const auth = /^(Basic|Bearer)\s/i.test(input.token)
    ? input.token
    : `Bearer ${input.token}`;
  const headers = { Authorization: auth, Accept: 'application/json' };
  const listUrl =
    `${base}/api/now/table/${encodeURIComponent(table)}` +
    `?sysparm_display_value=all&sysparm_limit=${input.limit ?? 200}` +
    (input.query ? `&sysparm_query=${encodeURIComponent(input.query)}` : '');

  const res = await fetch(listUrl, { headers });
  if (!res.ok) {
    throw new Error(
      `ServiceNow request failed (${res.status}). Check the instance URL and credentials.`,
    );
  }
  const body = (await res.json()) as { result?: Array<Record<string, unknown>> };
  const records = body.result ?? [];
  const dv = (v: unknown): string =>
    v && typeof v === 'object'
      ? String(
          (v as { display_value?: unknown; value?: unknown }).display_value ??
            (v as { value?: unknown }).value ??
            '',
        )
      : v == null
        ? ''
        : String(v);

  const cases: MigrationCase[] = [];
  for (const r of records) {
    const sysId = dv(r.sys_id);
    const attachments = await fetchServiceNowAttachments(base, headers, sysId);
    cases.push({
      externalId: dv(r.number) || sysId,
      title: dv(r.short_description) || dv(r.number) || 'ServiceNow record',
      subjectName: dv(r.caller_id) || dv(r.company) || undefined,
      subjectType: 'matter',
      caseType: dv(r.category) || undefined,
      status: dv(r.state) || undefined,
      description: dv(r.description) || undefined,
      openedAt: dv(r.opened_at) || dv(r.sys_created_on) || undefined,
      history: [
        ...(dv(r.sys_created_on)
          ? [
              {
                at: dv(r.sys_created_on),
                actor: dv(r.sys_created_by) || undefined,
                event: 'Created in ServiceNow',
              },
            ]
          : []),
        ...(dv(r.closed_at)
          ? [{ at: dv(r.closed_at), event: 'Closed in ServiceNow' }]
          : []),
      ],
      notes: dv(r.comments) ? [{ body: dv(r.comments) }] : [],
      attachments,
    });
  }
  return { source: 'ServiceNow', cases };
}

async function fetchServiceNowAttachments(
  base: string,
  headers: Record<string, string>,
  tableSysId: string,
): Promise<MigrationAttachment[]> {
  if (!tableSysId) return [];
  try {
    const res = await fetch(
      `${base}/api/now/attachment?sysparm_query=table_sys_id=${encodeURIComponent(tableSysId)}`,
      { headers },
    );
    if (!res.ok) return [];
    const { result } = (await res.json()) as {
      result?: Array<Record<string, string>>;
    };
    const out: MigrationAttachment[] = [];
    for (const a of result ?? []) {
      try {
        const fileRes = await fetch(`${base}/api/now/attachment/${a.sys_id}/file`, {
          headers,
        });
        if (!fileRes.ok) continue;
        const b64 = Buffer.from(await fileRes.arrayBuffer()).toString('base64');
        out.push({
          name: a.file_name || 'attachment',
          mimeType: a.content_type || 'application/octet-stream',
          dataBase64: b64,
          capturedAt: a.sys_created_on,
        });
      } catch {
        /* skip a single attachment, keep the rest */
      }
    }
    return out;
  } catch {
    return [];
  }
}
