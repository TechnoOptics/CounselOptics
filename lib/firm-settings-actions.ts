'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser, requireUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';
import { isUnknownColumnError } from './signer-view';
import { normalizeMatterPrefix, normalizeTicketPrefix } from './ticket-numbers';
import { FIRM_TYPES, type FirmType } from './firm-types';
import {
  WORKSPACE_SURFACES,
  readSurfaceOverrides,
  type SurfaceOverride,
  type WorkspaceSurface,
} from './firm-workspace';

/**
 * Owner/admin writes for the per-firm surface toggles
 * (firm_settings.hide_search / hide_time_billing). Reads live in
 * lib/firm-settings.ts.
 *
 * The write goes through the admin client with an explicit owner/admin
 * check (defense in depth; the firm_settings_admin_write RLS policy
 * enforces the same rule). We upsert so a firm that has never touched
 * its settings still gets a row created on first save.
 */

async function callerIsFirmAdmin(firmId: string): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) return false;
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'admin';
}

/**
 * The global-search toggle, and only that.
 *
 * It used to write hide_time_billing too. Time & Billing now has a THREE-state
 * control (workspace default / always show / always hide) because its default
 * is derived from the firm's type, and two writers for one fact is how the
 * checkbox and the override would come to disagree. That column is written by
 * updateFirmSurfaceOverrideAction alone now.
 */
export async function updateFirmSurfaceSettingsAction(
  firmId: string,
  input: { hideSearch: boolean },
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change firm settings.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { error } = await admin
    .from('firm_settings')
    .upsert(
      {
        firm_id: firmId,
        hide_search: Boolean(input.hideSearch),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id' },
    );
  if (error) return { ok: false, error: error.message };

  // These flags change the chrome the whole workspace renders, so bust
  // the counsel layout + settings caches.
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

/** Read a firm's metadata for a read-modify-write. Not exported: every
 *  export in a 'use server' module is a public HTTP endpoint. */
async function readFirmMetadataForWrite(
  firmId: string,
): Promise<Record<string, unknown>> {
  const admin = createAdminSupabase();
  if (!admin) return {};
  const { data } = await admin
    .from('firms')
    .select('metadata')
    .eq('id', firmId)
    .maybeSingle();
  const m = (data as { metadata: unknown } | null)?.metadata;
  return m && typeof m === 'object' && !Array.isArray(m)
    ? (m as Record<string, unknown>)
    : {};
}

/**
 * What kind of legal team this is.
 *
 * Set at onboarding and, until now, never again - which is why in-house teams
 * were sitting in workspaces built for law firms. Firms are misclassified at
 * signup and firms change, so this has to be editable, and the settings page is
 * where every other decision about the shape of the workspace already lives.
 *
 * Changing it DESTROYS NOTHING. It changes which surfaces are shown by default
 * and what things are called. Invoices, time entries, trust ledgers, leads and
 * referrals stay exactly where they are; if the new type's default hides the
 * surface they live on, an owner sets that surface to "Always show" and it
 * comes back with every row still in it.
 */
export async function updateFirmTypeAction(
  firmId: string,
  firmType: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change firm settings.' };
  }
  // Validated against the same list the production CHECK constraint holds
  // (supabase/fixes/2026-07-04-token-economy-schema.sql). An unrecognized value
  // would be refused by the database anyway; refusing it here means the person
  // gets a sentence rather than a constraint violation.
  if (!FIRM_TYPES.includes(firmType as FirmType)) {
    return { ok: false, error: 'That is not a workspace type we recognize.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const { error } = await admin
    .from('firms')
    .update({ firm_type: firmType, updated_at: new Date().toISOString() })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };

  // The type decides the rail, the vocabulary and which routes answer, so the
  // whole shell's cache has to go, not just this page's.
  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

/**
 * Override one surface group against its type default, or clear the override
 * and go back to the default.
 *
 * Stored in firms.metadata.surfaceOverrides beside menuConfig. No migration is
 * owed for two optional strings, and the firms table already carries this
 * firm's other display configuration in that exact field.
 *
 * Clearing an override for timeBilling also clears the legacy
 * firm_settings.hide_time_billing, because leaving it set would keep hiding the
 * surface and the person would have asked for the default and not got it.
 */
export async function updateFirmSurfaceOverrideAction(
  firmId: string,
  surface: string,
  choice: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change firm settings.' };
  }
  if (!WORKSPACE_SURFACES.includes(surface as WorkspaceSurface)) {
    return { ok: false, error: 'That is not a surface we recognize.' };
  }
  if (choice !== 'show' && choice !== 'hide' && choice !== 'default') {
    return { ok: false, error: 'Choose show, hide, or the workspace default.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const metadata = await readFirmMetadataForWrite(firmId);
  const overrides = readSurfaceOverrides(metadata);
  if (choice === 'default') {
    delete overrides[surface as WorkspaceSurface];
  } else {
    overrides[surface as WorkspaceSurface] = choice as SurfaceOverride;
  }

  const { error } = await admin
    .from('firms')
    .update({
      metadata: { ...metadata, surfaceOverrides: overrides },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };

  if (surface === 'timeBilling' && choice === 'default') {
    // Best effort. The override is the authority now; a firm with no
    // firm_settings row has nothing to clear, and a failure here leaves the
    // surface hidden rather than exposing one that was asked to be hidden.
    await admin
      .from('firm_settings')
      .upsert(
        {
          firm_id: firmId,
          hide_time_billing: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'firm_id' },
      );
  }

  revalidatePath('/counsel', 'layout');
  revalidatePath('/counsel/settings');
  return { ok: true };
}

/**
 * The letters in front of every ticket number this firm issues.
 *
 * Its own action, and its own upsert naming only this column, for the same
 * reason getFirmTicketPrefix is its own read: `ticket_prefix` arrives with
 * 20260807_flow_join.sql and is not applied yet. Folding it into the surface
 * toggles above would make saving a toggle fail on an unmigrated database,
 * and a firm would lose the ability to change settings that work today
 * because of a setting that does not exist yet.
 *
 * Changing the prefix renumbers nothing. Every number already on a filed
 * document keeps the prefix it was filed under, and the series carries on
 * from where it was rather than restarting onto numbers that are already out.
 */
export async function updateFirmTicketPrefixAction(
  firmId: string,
  prefix: string,
): Promise<{ ok: boolean; error?: string; prefix?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change firm settings.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  // Normalised before it is stored, not only when it is read, so what the
  // firm sees on the settings page afterwards is what will actually appear on
  // their documents.
  const stored = normalizeTicketPrefix(prefix);
  const { error } = await admin
    .from('firm_settings')
    .upsert(
      { firm_id: firmId, ticket_prefix: stored, updated_at: new Date().toISOString() },
      { onConflict: 'firm_id' },
    );
  if (error) {
    if (isUnknownColumnError(error, 'ticket_prefix')) {
      return {
        ok: false,
        error:
          'Ticket numbers are not switched on yet. Ask your administrator to apply the pending database update.',
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/counsel/settings');
  return { ok: true, prefix: stored };
}

/**
 * The letters in front of every matter reference this firm issues.
 *
 * Its own action and its own single-column upsert, for the reason the ticket
 * prefix above has one: `matter_prefix` arrives with
 * supabase/migrations/20260813_matter_number.sql and is not applied, and
 * folding it into a shared write would make saving a setting that works today
 * fail because of one that does not exist yet.
 *
 * Changing the prefix renumbers nothing. Every matter keeps the reference it
 * was opened under, which is the whole point of a reference, and the series
 * carries on from where it was rather than restarting onto numbers that are
 * already on filings (the allocator reads the trailing digits and ignores
 * whatever is in front of them).
 */
export async function updateFirmMatterPrefixAction(
  firmId: string,
  prefix: string,
): Promise<{ ok: boolean; error?: string; prefix?: string }> {
  await requireUser();
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only an owner or admin can change firm settings.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const stored = normalizeMatterPrefix(prefix);
  const { error } = await admin
    .from('firm_settings')
    .upsert(
      { firm_id: firmId, matter_prefix: stored, updated_at: new Date().toISOString() },
      { onConflict: 'firm_id' },
    );
  if (error) {
    if (isUnknownColumnError(error, 'matter_prefix')) {
      return {
        ok: false,
        error:
          'Matter reference numbers are not switched on yet. Ask your administrator to apply the pending database update.',
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/counsel/settings');
  revalidatePath('/counsel/cases');
  return { ok: true, prefix: stored };
}
