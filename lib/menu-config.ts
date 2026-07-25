/**
 * Per-firm Counsel sidebar customization.
 *
 * Enterprises don't all want the same 15-item rail - a small in-house
 * legal team has no use for Leads / Referrals / Trust. This lets an
 * admin hide items they don't need, rename them to their own
 * vocabulary, and reorder both items and whole sections. Config lives
 * in firms.metadata.menuConfig (no schema). Pure + icon-free so the
 * settings UI and the server-rendered sidebar share it; the sidebar
 * supplies icons keyed by href.
 *
 * "Firm settings" is deliberately NOT customizable - it's the way
 * back into this very editor, so it always shows for owner/admin.
 */

export type MenuItem = { href: string; label: string; hint: string };
export type MenuSection = { section: string; items: MenuItem[] };

/**
 * The Time & Billing group (the "Finance" section). When a firm turns
 * on firm_settings.hide_time_billing these hrefs are hidden from the
 * sidebar + mobile nav and the routes are blocked. Kept here so the
 * sidebar, the header's mobile nav, and the route guards share one
 * source of truth.
 */
export const TIME_BILLING_HREFS = [
  '/counsel/time',
  '/counsel/billing',
  '/counsel/trust',
];

/** Fold a set of extra hidden hrefs into an existing menu config. */
export function withHiddenHrefs(
  config: MenuConfig,
  hrefs: string[],
): MenuConfig {
  if (hrefs.length === 0) return config;
  return { ...config, hidden: [...config.hidden, ...hrefs] };
}

export const DEFAULT_MENU: MenuSection[] = [
  {
    section: 'Overview',
    items: [
      { href: '/counsel', label: 'Dashboard', hint: 'Overview' },
      { href: '/counsel/analytics', label: 'Impact', hint: 'Firm-wide case analytics' },
      { href: '/counsel/aid', label: 'Advottic Aid', hint: 'Ask about cases + law' },
      { href: '/counsel/calendar', label: 'Calendar', hint: 'Meetings, deadlines + integrations' },
      { href: '/counsel/import', label: 'Import data', hint: 'Migrate clients, cases + documents' },
    ],
  },
  {
    section: 'Matters',
    items: [
      { href: '/counsel/inbox', label: 'Request inbox', hint: 'Triage internal + external requests' },
      { href: '/counsel/intake', label: 'New intake', hint: 'Open a new request + conflict check' },
      { href: '/counsel/templates', label: 'Templates', hint: 'Branded document drafting' },
      { href: '/counsel/forms', label: 'Form templates', hint: 'Self-service forms for employees' },
      { href: '/counsel/policies', label: 'Policy library', hint: 'Powers the employee doc checker' },
      { href: '/counsel/letters', label: 'Letters', hint: 'AI letters on your letterhead' },
      { href: '/counsel/analyze', label: 'Analyze', hint: 'Contract breakdown + risk' },
      { href: '/counsel/cases', label: 'Cases', hint: 'All firm matters' },
      { href: '/counsel/projects', label: 'Projects', hint: 'Folders, notes + files' },
      { href: '/counsel/documents', label: 'Documents', hint: 'Case-linked vault' },
      { href: '/counsel/contracts', label: 'Contracts', hint: 'Repo + Bella review' },
      { href: '/counsel/signing', label: 'Signing', hint: 'E-sign requests' },
    ],
  },
  {
    section: 'People',
    items: [
      { href: '/counsel/clients', label: 'Clients', hint: 'Roster + invites' },
      { href: '/counsel/employees', label: 'Employees', hint: 'Directory of all users' },
      { href: '/counsel/access', label: 'Access requests', hint: 'Approve external sign-ups' },
      { href: '/counsel/team', label: 'Team', hint: 'Members + roles' },
      { href: '/counsel/chat', label: 'Chat', hint: 'Channels + DMs' },
    ],
  },
  {
    section: 'Growth',
    items: [
      { href: '/counsel/leads', label: 'Leads', hint: 'Inbound from /find-counsel' },
      { href: '/counsel/referrals', label: 'Referrals', hint: 'Co-counsel + fee splits' },
    ],
  },
  {
    section: 'Finance',
    items: [
      { href: '/counsel/time', label: 'Time', hint: 'Time entries' },
      { href: '/counsel/billing', label: 'Billing', hint: 'Invoices' },
      { href: '/counsel/trust', label: 'Trust', hint: 'IOLTA ledger' },
    ],
  },
  {
    section: 'Support',
    items: [
      { href: '/counsel/help', label: 'Help & support', hint: 'Contact Advottic' },
    ],
  },
];

export type MenuConfig = {
  /** hrefs the firm hid. */
  hidden: string[];
  /** href -> custom label. */
  labels: Record<string, string>;
  /** section names in the firm's preferred order. */
  sectionOrder: string[];
  /** section name -> hrefs in the firm's preferred order. */
  itemOrder: Record<string, string[]>;
};

export const EMPTY_MENU_CONFIG: MenuConfig = {
  hidden: [],
  labels: {},
  sectionOrder: [],
  itemOrder: {},
};

const KNOWN_HREFS = new Set(
  DEFAULT_MENU.flatMap((s) => s.items.map((i) => i.href)),
);
const KNOWN_SECTIONS = new Set(DEFAULT_MENU.map((s) => s.section));

/** Parse firms.metadata.menuConfig defensively. */
export function readMenuConfig(metadata: unknown): MenuConfig {
  const raw = (metadata as { menuConfig?: unknown } | null)?.menuConfig;
  if (!raw || typeof raw !== 'object') return EMPTY_MENU_CONFIG;
  const o = raw as Record<string, unknown>;
  const hidden = Array.isArray(o.hidden)
    ? o.hidden.map(String).filter((h) => KNOWN_HREFS.has(h))
    : [];
  const labels: Record<string, string> = {};
  if (o.labels && typeof o.labels === 'object') {
    for (const [k, v] of Object.entries(o.labels as object)) {
      if (KNOWN_HREFS.has(k) && typeof v === 'string' && v.trim()) {
        labels[k] = v.trim().slice(0, 40);
      }
    }
  }
  const sectionOrder = Array.isArray(o.sectionOrder)
    ? o.sectionOrder.map(String).filter((s) => KNOWN_SECTIONS.has(s))
    : [];
  const itemOrder: Record<string, string[]> = {};
  if (o.itemOrder && typeof o.itemOrder === 'object') {
    for (const [k, v] of Object.entries(o.itemOrder as object)) {
      if (KNOWN_SECTIONS.has(k) && Array.isArray(v)) {
        itemOrder[k] = v.map(String).filter((h) => KNOWN_HREFS.has(h));
      }
    }
  }
  return { hidden, labels, sectionOrder, itemOrder };
}

function orderBy<T>(
  items: T[],
  keyOf: (t: T) => string,
  desired: string[],
): T[] {
  if (desired.length === 0) return items;
  const rank = new Map(desired.map((k, i) => [k, i]));
  return [...items].sort((a, b) => {
    const ra = rank.has(keyOf(a)) ? rank.get(keyOf(a))! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(keyOf(b)) ? rank.get(keyOf(b))! : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

/**
 * Apply a config to the default menu: reorder sections, reorder +
 * rename + hide items, drop sections that end up empty.
 */
export function applyMenuConfig(config: MenuConfig): MenuSection[] {
  const hidden = new Set(config.hidden);
  const sections = orderBy(
    DEFAULT_MENU,
    (s) => s.section,
    config.sectionOrder,
  );
  return sections
    .map((sec) => {
      const ordered = orderBy(
        sec.items,
        (i) => i.href,
        config.itemOrder[sec.section] ?? [],
      );
      const items = ordered
        .filter((i) => !hidden.has(i.href))
        .map((i) => ({
          ...i,
          label: config.labels[i.href] ?? i.label,
        }));
      return { section: sec.section, items };
    })
    .filter((sec) => sec.items.length > 0);
}
