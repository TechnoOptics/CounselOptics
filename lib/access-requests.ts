/**
 * Self-serve workspace access: classification + parsing helpers.
 *
 * A person lands on /join, picks their organization, and enters their
 * work email. If the email's domain matches one the firm has marked
 * as internal, they are an employee and get provisioned straight
 * away. Anyone else (an outside client, a vendor, a counterparty) is
 * EXTERNAL: their request is queued for a legal-team admin to approve
 * before any account exists, and even once approved they never get
 * the employee-only surfaces.
 *
 * Pure + dependency-free so the public page, the server action, and
 * the counsel approval screen all share one source of truth.
 *
 * Allowed internal domains live in firms.metadata.emailDomains as
 * either a string[] or a comma/space/newline-separated string, e.g.
 *   "emailDomains": ["zinpro.com", "zinpro.legal"]
 * With none configured every signup is treated as external (safe by
 * default - a misconfiguration can never silently hand someone an
 * internal account).
 */

export type AccessClassification = 'internal' | 'external';

export type SignupRequestRow = {
  id: string;
  firm_id: string;
  email: string;
  full_name: string | null;
  classification: AccessClassification;
  status: 'pending' | 'approved' | 'denied';
  note: string | null;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).trim().toLowerCase();
}

/** Read the firm's configured internal email domains. */
export function firmInternalDomains(
  metadata: Record<string, unknown> | null | undefined,
): string[] {
  const raw = (metadata ?? {}).emailDomains;
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw.map((x) => String(x));
  } else if (typeof raw === 'string') {
    list = raw.split(/[,;\s]+/);
  }
  return list
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, ''),
    )
    .filter((d) => d.includes('.') && d.length <= 253);
}

/**
 * Internal when the email's domain (or a parent of it) is on the
 * firm's allow-list. Sub-domain match so mail.zinpro.com counts as
 * zinpro.com.
 */
export function classifyEmail(
  metadata: Record<string, unknown> | null | undefined,
  email: string,
): AccessClassification {
  const domain = emailDomain(email);
  if (!domain) return 'external';
  const allowed = firmInternalDomains(metadata);
  for (const d of allowed) {
    if (domain === d || domain.endsWith(`.${d}`)) return 'internal';
  }
  return 'external';
}
