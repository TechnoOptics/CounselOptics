import { cookies } from 'next/headers';
import { getCurrentUser } from './supabase/server';
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
  type PortalFeature,
} from './portal-features';
import { emailDomain, firmInternalDomains } from './access-requests';

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
      kind: 'employee';
      firm: Firm;
      employee: FirmEmployee;
      entitlements: PortalFeature[];
      /** True when an owner/admin is previewing the portal. */
      preview?: boolean;
      /** Role name being previewed (for the banner). */
      previewRoleName?: string;
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

function readPreviewCookie(): { firmId: string; roleKey: string } | null {
  try {
    const raw = cookies().get(PORTAL_PREVIEW_COOKIE)?.value;
    if (!raw) return null;
    const o = JSON.parse(raw) as { firmId?: string; roleKey?: string };
    if (!o.firmId) return null;
    return { firmId: o.firmId, roleKey: String(o.roleKey ?? '') };
  } catch {
    return null;
  }
}

export async function getWorkspacePersona(): Promise<WorkspacePersona> {
  const user = await getCurrentUser();
  if (!user) return { kind: 'none' };

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
      const role = preview.roleKey
        ? roles.find((r) => r.key === preview.roleKey)
        : undefined;
      const who =
        m.membership.displayName || user.email || 'Preview';
      return {
        kind: 'employee',
        firm: m.firm,
        employee: {
          id: 'preview',
          firmId: m.firm.id,
          userId: user.id,
          email: user.email ?? '',
          displayName: `${who} (preview)`,
          department: null,
          source: 'manual',
          externalId: null,
          deactivatedAt: null,
          createdAt: new Date().toISOString(),
        },
        entitlements: resolveEntitlements(preview.roleKey || null, roles),
        preview: true,
        previewRoleName: role ? role.name : 'Default access',
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
