import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';
import { getCurrentUserResult } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import {
  getActiveFirmContext,
  getFirmById,
  listMyFirms,
} from './firm-storage';
import type { Firm, FirmEmployee, FirmMember } from './firm-types';
import {
  readPortalRoles,
  resolveEntitlements,
  VENDOR_PREVIEW_FEATURES,
  type PortalFeature,
} from './portal-features';
import { emailDomain, firmInternalDomains } from './access-requests';
import { resolveGuestContextForUser, type GuestContext } from './counsel-guest';

/**
 * Resolve the signed-in user's workspace persona.
 *
 *  - `admin`    : firm_members row, role owner|admin -> full Counsel.
 *  - `legal`    : firm_members row, any other role  -> full Counsel.
 *  - `employee` : NO firm_members row but a firm_employees row, OR an
 *                 owner/admin in PREVIEW mode -> scoped /portal only.
 *  - `none`     : neither.
 *
 * Legal membership always wins EXCEPT when the user is an owner/admin
 * who explicitly entered employee-portal preview (a cookie they set
 * via a gated action). Preview never reduces their real privileges
 * and never exposes another employee's data - the portal pages still
 * scope every query to the signed-in user.
 *
 * See docs/ENTERPRISE_WORKSPACE.md.
 */
export const PORTAL_PREVIEW_COOKIE = 'adv_portal_preview';

export type WorkspacePersona =
  | { kind: 'none' }
  | { kind: 'legal' | 'admin'; firm: Firm; membership: FirmMember }
  | {
      /**
       * Case-scoped Counsel GUEST: co-counsel / outside collaborator added to
       * one or more firm matters (case_collaborators role 'attorney') who is
       * NOT a firm member. They get the firm-framed Counsel view of ONLY their
       * assigned matter(s) - nothing else in the workspace. See
       * lib/counsel-guest.ts + app/counsel/layout.tsx.
       */
      kind: 'counsel_guest';
      guest: GuestContext;
    }
  | {
      kind: 'employee';
      firm: Firm;
      employee: FirmEmployee;
      entitlements: PortalFeature[];
      /** True when an owner/admin is previewing the portal. */
      preview?: boolean;
      /** Role name being previewed (for the banner). */
      previewRoleName?: string;
      /**
       * True when the previewed persona is an EXTERNAL collaborator
       * (vendor / counterparty / outside party) rather than an
       * in-house employee. Only ever set in preview mode. The portal
       * chrome uses it to relabel "Client hub" -> "Vendor workspace"
       * and drop internal-only nav (trainings) so the owner sees what
       * an outside party would actually see.
       */
      external?: boolean;
    };

type EmployeeRow = {
  id: string;
  firm_id: string;
  user_id: string | null;
  email: string;
  display_name: string | null;
  department: string | null;
  source: string;
  external_id: string | null;
  deactivated_at: string | null;
  created_at: string;
  role_key?: string | null;
};

function employeeFromRow(r: EmployeeRow): FirmEmployee {
  return {
    id: r.id,
    firmId: r.firm_id,
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    department: r.department,
    source:
      r.source === 'azure' || r.source === 'google' ? r.source : 'manual',
    externalId: r.external_id,
    deactivatedAt: r.deactivated_at,
    createdAt: r.created_at,
  };
}

export type PreviewMode = 'employee' | 'vendor';

function readPreviewCookie(): {
  firmId: string;
  roleKey: string;
  mode: PreviewMode;
} | null {
  try {
    const raw = cookies().get(PORTAL_PREVIEW_COOKIE)?.value;
    if (!raw) return null;
    const o = JSON.parse(raw) as {
      firmId?: string;
      roleKey?: string;
      mode?: string;
    };
    if (!o.firmId) return null;
    return {
      firmId: o.firmId,
      roleKey: String(o.roleKey ?? ''),
      // Legacy cookies (pre-vendor-preview) have no `mode`; treat them
      // as the employee preview they were.
      mode: o.mode === 'vendor' ? 'vendor' : 'employee',
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the persona for an already-authenticated user. Split out so
 * the session read (which can THROW on a transient hiccup) stays
 * separable from persona resolution - see getWorkspacePersonaResult.
 */
async function resolvePersonaForUser(user: User): Promise<WorkspacePersona> {
  const myFirms = await listMyFirms();

  // Preview mode: an owner/admin chose to see the employee portal.
  // Only honoured for a firm they actually own/admin, so it can
  // never be an escalation (employee <= legal). Checked BEFORE the
  // legal short-circuit so /portal renders for them.
  const preview = readPreviewCookie();
  if (preview && myFirms.length > 0) {
    const m = myFirms.find(
      (f) =>
        f.firm.id === preview.firmId &&
        (f.membership.role === 'owner' ||
          f.membership.role === 'admin'),
    );
    if (m) {
      const roles = readPortalRoles(m.firm.metadata);
      const isVendor = preview.mode === 'vendor';
      const role = preview.roleKey
        ? roles.find((r) => r.key === preview.roleKey)
        : undefined;
      const who =
        m.membership.displayName || user.email || 'Preview';
      // Vendor preview uses the fixed external-collaborator entitlement
      // set and ignores portal roles (those are for employees); the
      // employee preview resolves the chosen role like a real employee.
      const entitlements = isVendor
        ? [...VENDOR_PREVIEW_FEATURES]
        : resolveEntitlements(preview.roleKey || null, roles);
      const previewRoleName = isVendor
        ? 'External vendor'
        : role
          ? role.name
          : 'Default access';
      return {
        kind: 'employee',
        firm: m.firm,
        employee: {
          id: 'preview',
          firmId: m.firm.id,
          userId: user.id,
          email: user.email ?? '',
          displayName: isVendor
            ? 'External vendor (preview)'
            : `${who} (preview)`,
          department: isVendor ? 'External' : null,
          source: 'manual',
          externalId: null,
          deactivatedAt: null,
          createdAt: new Date().toISOString(),
        },
        entitlements,
        preview: true,
        previewRoleName,
        external: isVendor,
      };
    }
  }

  // Legal team takes precedence.
  if (myFirms.length > 0) {
    const active = (await getActiveFirmContext()) ?? myFirms[0];
    const isAdmin =
      active.membership.role === 'owner' ||
      active.membership.role === 'admin';
    return {
      kind: isAdmin ? 'admin' : 'legal',
      firm: active.firm,
      membership: active.membership,
    };
  }

  // Not on any legal team. Case-scoped co-counsel GUEST? A user added to a
  // firm matter as co-counsel (case_collaborators role 'attorney') who is NOT
  // a firm member gets the strictly matter-scoped Counsel view. Checked BEFORE
  // the employee-portal lookup so an outside attorney invited to a matter sees
  // the matter, not a portal. Fails closed on any error (best-effort). See
  // lib/counsel-guest.ts.
  try {
    const guest = await resolveGuestContextForUser(user);
    if (guest) return { kind: 'counsel_guest', guest };
  } catch {
    // Table not migrated yet, or transient failure - fall through.
  }

  // Not on any legal team. Directory-synced / admin-added employee?
  try {
    const admin = createAdminSupabase();
    if (admin) {
      let row: EmployeeRow | null = null;
      {
        const { data } = await admin
          .from('firm_employees')
          .select('*')
          .eq('user_id', user.id)
          .is('deactivated_at', null)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        row = (data as EmployeeRow | null) ?? null;
      }
      if (!row && user.email) {
        const { data } = await admin
          .from('firm_employees')
          .select('*')
          .is('user_id', null)
          .is('deactivated_at', null)
          .ilike('email', user.email)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        const candidate = (data as EmployeeRow | null) ?? null;
        if (candidate) {
          await admin
            .from('firm_employees')
            .update({ user_id: user.id })
            .eq('id', candidate.id);
          candidate.user_id = user.id;
          row = candidate;
        }
      }
      // Domain auto-membership. If the firm marked their email
      // domain as internal (firms.metadata.emailDomains), anyone on
      // that domain IS an employee - no admin add, no /join request.
      // This is what makes "same domain -> just signed in" true even
      // when the person reached the app via the normal sign-in
      // instead of the /join provisioning form.
      if (!row && user.email) {
        const domain = emailDomain(user.email);
        if (domain) {
          const { data: firmsData } = await admin
            .from('firms')
            .select('id, metadata, created_at')
            .not('metadata->emailDomains', 'is', null)
            .order('created_at', { ascending: true })
            .limit(300);
          const match = ((firmsData ?? []) as Array<{
            id: string;
            metadata: Record<string, unknown> | null;
          }>).find((f) => {
            const allowed = firmInternalDomains(f.metadata);
            return allowed.some(
              (d) => domain === d || domain.endsWith(`.${d}`),
            );
          });
          if (match) {
            // Provision (idempotent: a duplicate just means a
            // concurrent request already created it - re-read it).
            await admin
              .from('firm_employees')
              .insert({
                firm_id: match.id,
                user_id: user.id,
                email: user.email.toLowerCase(),
                display_name:
                  (user.user_metadata?.full_name as string | undefined) ??
                  (user.user_metadata?.name as string | undefined) ??
                  null,
                source: 'manual',
                role_key: null,
              })
              .then(
                () => undefined,
                () => undefined,
              );
            const { data: provisioned } = await admin
              .from('firm_employees')
              .select('*')
              .eq('firm_id', match.id)
              .is('deactivated_at', null)
              .ilike('email', user.email)
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle();
            const pr = (provisioned as EmployeeRow | null) ?? null;
            if (pr) {
              if (!pr.user_id) {
                await admin
                  .from('firm_employees')
                  .update({ user_id: user.id })
                  .eq('id', pr.id);
                pr.user_id = user.id;
              }
              row = pr;
            }
          }
        }
      }
      if (row) {
        const employee = employeeFromRow(row);
        const firm = await getFirmById(employee.firmId);
        if (firm) {
          const roles = readPortalRoles(firm.metadata);
          return {
            kind: 'employee',
            firm,
            employee,
            entitlements: resolveEntitlements(row.role_key ?? null, roles),
          };
        }
      }
    }
  } catch {
    // Table not migrated yet, or transient failure. Degrade to
    // 'none' so the portal shows a clean "no access" state.
  }

  return { kind: 'none' };
}

/**
 * Result of persona resolution that keeps a definitive persona (incl.
 * the legitimate `{ kind: 'none' }` "no workspace yet" state) distinct
 * from a THROWN session read.
 *
 *  - `{ persona }` - the session read SUCCEEDED; the persona is
 *    authoritative (including a genuine `none`).
 *  - `{ error }`   - the session read THREW (corrupted cookie, Edge
 *    decode failure, stale-bundle deploy hiccup). Callers must NOT
 *    render "No workspace yet" or otherwise treat the visitor as
 *    unprivileged; it's a transient failure, not an answer.
 *
 * Without this, a thrown read collapsed to `{ kind: 'none' }` and the
 * portal showed the "No workspace yet" card to a fully-provisioned
 * employee during a deploy window - the same false-eviction class as
 * the sign-in redirect. See getCurrentUserResult.
 */
export type WorkspacePersonaResult =
  | { persona: WorkspacePersona }
  | { error: unknown };

/**
 * Like getWorkspacePersona, but surfaces a thrown session read as
 * `{ error }` instead of silently degrading to `{ kind: 'none' }`.
 * Prefer this at the portal chokepoint so a transient hiccup shows a
 * soft reconnect rather than a misleading "no access" state.
 */
export async function getWorkspacePersonaResult(): Promise<WorkspacePersonaResult> {
  const userResult = await getCurrentUserResult();
  if ('error' in userResult) return { error: userResult.error };
  const { user } = userResult;
  if (!user) return { persona: { kind: 'none' } };
  return { persona: await resolvePersonaForUser(user) };
}

/**
 * Best-effort persona resolution: collapses a thrown session read to
 * `{ kind: 'none' }`. Retained for the portal pages that only need a
 * persona and render fine under the guarded layout; auth chokepoints
 * should prefer getWorkspacePersonaResult.
 */
export async function getWorkspacePersona(): Promise<WorkspacePersona> {
  const result = await getWorkspacePersonaResult();
  return 'error' in result ? { kind: 'none' } : result.persona;
}
