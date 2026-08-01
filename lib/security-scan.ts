/**
 * Security Center scan engine.
 *
 * Pure, dependency-free risk logic plus admin-client aggregations
 * used by the HQ Security Center (/admin/security-center). It reuses
 * the existing security-pulse for posture and adds a real attachment
 * threat scan over the file-metadata tables (firm_documents,
 * exhibits, user_receipts) - no fabricated numbers.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PulseSummary } from './security-pulse';

// --- File risk classification ---------------------------------------

const DANGEROUS_EXT = new Set([
  'exe', 'dll', 'scr', 'bat', 'cmd', 'com', 'pif', 'msi', 'msp',
  'hta', 'cpl', 'jar', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'wsh',
  'ps1', 'psm1', 'sh', 'apk', 'app', 'deb', 'rpm', 'lnk', 'reg',
  'gadget', 'inf', 'scf',
]);
const MACRO_EXT = new Set([
  'docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'potm', 'xlam', 'ppam',
]);
const ACTIVE_EXT = new Set(['html', 'htm', 'xhtml', 'svg', 'mht', 'mhtml', 'xml']);
const ARCHIVE_EXT = new Set([
  'zip', 'rar', '7z', 'gz', 'tar', 'bz2', 'xz', 'iso', 'img',
  'cab', 'ace', 'arj',
]);
const SAFE_EXT = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff',
  'txt', 'csv', 'md', 'rtf', 'docx', 'xlsx', 'pptx', 'odt', 'ods',
  'mp4', 'mov', 'm4a', 'mp3', 'wav', 'heic',
]);
const EXEC_MIME = new Set([
  'application/x-msdownload', 'application/x-executable',
  'application/x-dosexec', 'application/x-sh', 'application/x-bat',
  'application/vnd.microsoft.portable-executable',
]);

export type RiskLevel = 'critical' | 'high' | 'medium' | 'clean';

export type FileRisk = { level: RiskLevel; reasons: string[] };

function extOf(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

export function classifyFileRisk(input: {
  name: string;
  mime: string | null;
  size: number | null;
}): FileRisk {
  const name = (input.name || '').trim();
  const mime = (input.mime || '').toLowerCase();
  const size = typeof input.size === 'number' ? input.size : null;
  const ext = extOf(name);
  const reasons: string[] = [];
  let level: RiskLevel = 'clean';
  const bump = (l: RiskLevel) => {
    const rank = { clean: 0, medium: 1, high: 2, critical: 3 } as const;
    if (rank[l] > rank[level]) level = l;
  };

  // Double extension hiding an executable (invoice.pdf.exe).
  const parts = name.toLowerCase().split('.');
  if (
    parts.length >= 3 &&
    DANGEROUS_EXT.has(parts[parts.length - 1]) &&
    SAFE_EXT.has(parts[parts.length - 2])
  ) {
    reasons.push('Double extension disguising an executable');
    bump('critical');
  }
  if (DANGEROUS_EXT.has(ext) || EXEC_MIME.has(mime)) {
    reasons.push('Executable / script payload type');
    bump('critical');
  }
  if (MACRO_EXT.has(ext)) {
    reasons.push('Macro-enabled Office document');
    bump('high');
  }
  if (ACTIVE_EXT.has(ext)) {
    reasons.push('Active-content document (script-capable)');
    bump('high');
  }
  if (
    ext &&
    SAFE_EXT.has(ext) &&
    mime &&
    mime !== 'application/octet-stream' &&
    !mimeMatchesExt(ext, mime)
  ) {
    reasons.push(`Type mismatch: .${ext} sent as ${mime}`);
    bump('high');
  }
  if (ARCHIVE_EXT.has(ext)) {
    reasons.push('Archive (contents not inspectable at rest)');
    bump('medium');
  }
  if (!ext && (!mime || mime === 'application/octet-stream')) {
    reasons.push('Unidentifiable type (no extension, opaque MIME)');
    bump('medium');
  }
  if (size === 0) {
    reasons.push('Zero-byte file');
    bump('medium');
  }
  if (size !== null && size > 75 * 1024 * 1024) {
    reasons.push('Unusually large (>75 MB)');
    bump('medium');
  }
  return { level, reasons };
}

function mimeMatchesExt(ext: string, mime: string): boolean {
  const map: Record<string, RegExp> = {
    pdf: /pdf/,
    png: /image\/png/,
    jpg: /image\/jpe?g/,
    jpeg: /image\/jpe?g/,
    webp: /image\/webp/,
    gif: /image\/gif/,
    txt: /text\//,
    csv: /csv|text\//,
    md: /markdown|text\//,
    docx: /word|officedocument|zip/,
    xlsx: /sheet|excel|officedocument|zip/,
    pptx: /presentation|officedocument|zip/,
    mp4: /video\/mp4/,
    mov: /video\/quicktime/,
  };
  const re = map[ext];
  return re ? re.test(mime) : true;
}

// --- Aggregations over the file-metadata tables ---------------------

export type ScanItem = {
  source: 'Firm document' | 'Case exhibit' | 'User receipt';
  name: string;
  level: RiskLevel;
  reasons: string[];
};

export type AttachmentScan = {
  scanned: number;
  clean: number;
  flagged: { critical: number; high: number; medium: number };
  items: ScanItem[];
  /** Known control gap: uploads are not MIME-allow-listed yet. */
  uploadMimeAllowlistMissing: boolean;
};

export async function scanAttachments(
  admin: SupabaseClient | null,
): Promise<AttachmentScan> {
  const empty: AttachmentScan = {
    scanned: 0,
    clean: 0,
    flagged: { critical: 0, high: 0, medium: 0 },
    items: [],
    uploadMimeAllowlistMissing: true,
  };
  if (!admin) return empty;

  const out: AttachmentScan = { ...empty, items: [] };
  const consider = (
    source: ScanItem['source'],
    name: string,
    mime: string | null,
    size: number | null,
  ) => {
    if (!name) return;
    out.scanned += 1;
    const r = classifyFileRisk({ name, mime, size });
    if (r.level === 'clean') {
      out.clean += 1;
      return;
    }
    out.flagged[r.level] += 1;
    if (out.items.length < 25) {
      out.items.push({ source, name, level: r.level, reasons: r.reasons });
    }
  };

  try {
    const [docs, exh, rcpt] = await Promise.all([
      admin
        .from('firm_documents')
        .select('name, mime_type, file_size')
        .order('created_at', { ascending: false })
        .limit(400),
      admin
        .from('exhibits')
        .select('file_name, file_type, file_size')
        .order('created_at', { ascending: false })
        .limit(400),
      admin
        .from('user_receipts')
        .select('title, mime_type, file_size')
        .order('created_at', { ascending: false })
        .limit(400),
    ]);
    for (const d of (docs.data ?? []) as Array<{
      name: string;
      mime_type: string | null;
      file_size: number | null;
    }>) {
      consider('Firm document', d.name, d.mime_type, d.file_size);
    }
    for (const e of (exh.data ?? []) as Array<{
      file_name: string;
      file_type: string | null;
      file_size: number | null;
    }>) {
      consider('Case exhibit', e.file_name, e.file_type, e.file_size);
    }
    for (const r of (rcpt.data ?? []) as Array<{
      title: string;
      mime_type: string | null;
      file_size: number | null;
    }>) {
      consider('User receipt', r.title, r.mime_type, r.file_size);
    }
  } catch {
    /* table may not exist on a given env; degrade to what we have */
  }
  // Highest-severity first for the table.
  const rank = { critical: 0, high: 1, medium: 2, clean: 3 } as const;
  out.items.sort((a, b) => rank[a.level] - rank[b.level]);
  return out;
}

// --- Posture grade derived from the existing security pulse ---------

export type PostureGrade = {
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  label: string;
  tone: 'green' | 'amber' | 'red';
};

export function gradeFromPulse(s: PulseSummary | null): PostureGrade {
  if (!s) {
    return { grade: 'C', label: 'Awaiting first scan', tone: 'amber' };
  }
  const { healthy, warning, critical, unknown } = s.counts;
  const total = healthy + warning + critical + unknown || 1;
  if (critical > 0) {
    return {
      grade: critical >= 3 ? 'F' : 'D',
      label: `${critical} critical control${critical === 1 ? '' : 's'} need attention`,
      tone: 'red',
    };
  }
  if (warning === 0 && unknown === 0) {
    return { grade: 'A', label: 'All controls passing', tone: 'green' };
  }
  // An unchecked control is not a passing one. The page states that the grade
  // "only reaches A when every control passes with zero advisories"; before
  // this, `unknown` was left out of the arithmetic entirely, so a sweep that
  // could not read a control still graded A.
  if (warning === 0) {
    // A sweep that could read almost everything is a B; one that could read
    // little is not, or a battery where nothing ran would still grade B.
    const unchecked = unknown / total;
    return {
      grade: unchecked > 0.5 ? 'D' : unchecked > 0.15 ? 'C' : 'B',
      label: `${unknown} control${unknown === 1 ? '' : 's'} could not be checked`,
      tone: 'amber',
    };
  }
  const unchecked =
    unknown > 0 ? `, ${unknown} unchecked` : '';
  const ratio = healthy / total;
  if (ratio >= 0.85) {
    return {
      grade: 'B',
      label: `${warning} advisory item${warning === 1 ? '' : 's'}${unchecked}`,
      // Amber whenever something could not be read: the operator scanning
      // for colour must not be told all-clear about a control nobody looked at.
      tone: unknown > 0 ? 'amber' : 'green',
    };
  }
  return {
    grade: 'C',
    label: `${warning} controls in advisory state${unchecked}`,
    tone: 'amber',
  };
}

// --- Cheap env-posture signals --------------------------------------

export type PostureSignal = { label: string; ok: boolean; note: string };

export function getPostureSignals(): PostureSignal[] {
  const has = (v: string | undefined) => Boolean(v && v.trim());
  return [
    {
      label: 'Service-role isolation',
      ok: has(process.env.SUPABASE_SERVICE_ROLE_KEY),
      note: 'Privileged DB access kept server-only, never shipped to the browser',
    },
    {
      label: 'Token encryption at rest (AES-256-GCM)',
      ok: has(process.env.INTEGRATION_ENCRYPTION_KEY),
      note: 'Integration OAuth tokens are envelope-encrypted before storage',
    },
    {
      label: 'Cron / job authentication',
      ok: has(process.env.CRON_SECRET),
      note: 'Scheduled jobs require a shared secret; no anonymous trigger',
    },
    {
      label: 'Web Push signing keys (VAPID)',
      ok:
        has(process.env.VAPID_PRIVATE_KEY) ||
        has(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY),
      note: 'Notifications are cryptographically signed end to end',
    },
    {
      label: 'AI provider key server-scoped',
      ok: has(process.env.ANTHROPIC_API_KEY),
      note: 'Model access runs server-side only; key never exposed to clients',
    },
  ];
}
