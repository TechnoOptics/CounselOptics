/**
 * Employee-portal capability model.
 *
 * The enterprise admin builds named roles/groups (firms.metadata
 * .portalRoles). Each role grants a set of FEATURE KEYS. An employee
 * is assigned one role (firm_employees.role_key); their portal
 * entitlements are that role's features. No role -> DEFAULT_FEATURES
 * (the core request loop) so the portal is never dead, while roles
 * gradually unlock more (messaging, document review, ...).
 *
 * Pure + dependency-free so it is shared by the persona resolver,
 * the portal pages, the admin Roles UI, and the preview banner.
 */

export type PortalFeature =
  | 'requests.view'
  | 'requests.create'
  | 'requests.message'
  | 'review';

export const PORTAL_FEATURES: ReadonlyArray<{
  key: PortalFeature;
  label: string;
  description: string;
  /** Always granted - the portal is pointless without it. */
  base?: boolean;
}> = [
  {
    key: 'requests.view',
    label: 'View my requests',
    description: 'See the requests they filed and their status.',
    base: true,
  },
  {
    key: 'requests.create',
    label: 'File new requests',
    description: 'Open a new request to legal (typed intake).',
  },
  {
    key: 'requests.message',
    label: 'Message legal',
    description: 'Two-way thread with legal on their requests.',
  },
  {
    key: 'review',
    label: 'Advottic Review',
    description: 'Run AI plain-English document review.',
  },
];

export const ALL_FEATURE_KEYS: PortalFeature[] = PORTAL_FEATURES.map(
  (f) => f.key,
);

// No role assigned -> the core loop: see + file + discuss your own
// requests. `review` is intentionally NOT in the default so a role
// can be the thing that unlocks it ("gradually unlocks more").
export const DEFAULT_FEATURES: PortalFeature[] = [
  'requests.view',
  'requests.create',
  'requests.message',
];

// Always-on regardless of role, so a misconfigured/empty role can
// never lock a person out of seeing their own requests.
const ALWAYS: PortalFeature[] = ['requests.view'];

// An external collaborator (vendor / counterparty / outside party) is
// NOT an in-house employee: they receive documents to review or sign
// and can message legal about them, but they don't file internal
// intake requests the way staff do. This is the entitlement set used
// by the owner/admin "preview as external vendor" test profile so the
// previewed hub visibly differs from the employee one (no "New
// request"). Kept here alongside the other capability sets so the
// portal, the persona resolver, and the preview banner share it.
export const VENDOR_PREVIEW_FEATURES: PortalFeature[] = [
  'requests.view',
  'requests.message',
  'review',
];

export type PortalRole = {
  key: string;
  name: string;
  features: PortalFeature[];
};

/** One-click starter roles the admin can drop in. */
export const ROLE_PRESETS: ReadonlyArray<PortalRole> = [
  { key: 'viewer', name: 'Viewer', features: ['requests.view'] },
  {
    key: 'requester',
    name: 'Requester',
    features: ['requests.view', 'requests.create', 'requests.message'],
  },
  {
    key: 'power',
    name: 'Power user',
    features: [
      'requests.view',
      'requests.create',
      'requests.message',
      'review',
    ],
  },
];

export function sanitizeFeatures(input: unknown): PortalFeature[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<string>(input.map((x) => String(x)));
  return ALL_FEATURE_KEYS.filter((k) => set.has(k));
}

/** Parse firms.metadata.portalRoles defensively. */
export function readPortalRoles(metadata: unknown): PortalRole[] {
  const raw = (metadata as { portalRoles?: unknown } | null)?.portalRoles;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const key = String(o.key ?? '').trim();
      const name = String(o.name ?? '').trim();
      if (!key || !name) return null;
      return { key, name, features: sanitizeFeatures(o.features) };
    })
    .filter((r): r is PortalRole => r !== null);
}

/**
 * Resolve an employee's effective entitlements. Unknown / missing
 * role falls back to the default set; ALWAYS keys are forced on.
 */
export function resolveEntitlements(
  roleKey: string | null | undefined,
  roles: PortalRole[],
): PortalFeature[] {
  const role = roleKey
    ? roles.find((r) => r.key === roleKey)
    : undefined;
  const base = role ? role.features : DEFAULT_FEATURES;
  const merged = new Set<PortalFeature>([...ALWAYS, ...base]);
  return ALL_FEATURE_KEYS.filter((k) => merged.has(k));
}

export function hasFeature(
  entitlements: PortalFeature[],
  feature: PortalFeature,
): boolean {
  return entitlements.includes(feature);
}
