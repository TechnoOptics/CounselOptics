import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import {
  getActiveFirmContext,
  getFirmById,
  listMyFirms,
} from './firm-storage';
import type { Firm, FirmEmployee, FirmMember } from './firm-types';

/**
 * Resolve the signed-in user's workspace persona.
 *
 * One axis on top of FirmRole, NOT a new column:
 *
 *  - `admin`    : firm_members row, role owner|admin -> full Counsel
 *                 app + tenant settings.
 *  - `legal`    : firm_members row, any other role  -> full Counsel.
 *  - `employee` : NO firm_members row, but a firm_employees row ->
 *                 the scoped /portal/* surface only.
 *  - `none`     : neither -> no access.
 *
 * Legal membership always wins: if a person is on the legal team they
 * get the full app even if they also have an employee row. This is
 * the single chokepoint both /counsel and /portal gate on, so an
 * employee can never reach /counsel/* (there is no firm_members row
 * for them) and a legal user landing on /portal is sent to /counsel.
 *
 * See docs/ENTERPRISE_WORKSPACE.md.
 */
export type WorkspacePersona =
  | { kind: 'none' }
  | { kind: 'legal' | 'admin'; firm: Firm; membership: FirmMember }
  | { kind: 'employee'; firm: Firm; employee: FirmEmployee };

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

export async function getWorkspacePersona(): Promise<WorkspacePersona> {
  const user = await getCurrentUser();
  if (!user) return { kind: 'none' };

  // Legal team takes precedence. Mirror the counsel layout's
  // resolution: prefer the active firm, else the first membership.
  const myFirms = await listMyFirms();
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

  // Not on any legal team. Are they a directory-synced / admin-added
  // employee? Admin client because (a) a row may still be unlinked
  // (user_id null - added by email before the person ever signed in,
  // so the self-select RLS policy can't see it yet) and (b) listing
  // is service-role per the design doc. The query stays pinned to
  // THIS user (id or email), so nothing else is reachable.
  try {
    const admin = createAdminSupabase();
    if (admin) {
      // 1. Already linked to this user_id.
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
      // 2. Not linked yet: match by email and backfill user_id so
      //    every subsequent load is the fast path above.
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
      if (row) {
        const employee = employeeFromRow(row);
        const firm = await getFirmById(employee.firmId);
        if (firm) return { kind: 'employee', firm, employee };
      }
    }
  } catch {
    // Table not migrated yet, or transient failure. Degrade to
    // 'none' so the portal shows a clean "no access" state instead
    // of a 500.
  }

  return { kind: 'none' };
}
