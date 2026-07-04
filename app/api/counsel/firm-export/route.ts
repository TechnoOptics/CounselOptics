import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Firm data export / backup (#15). Streams a single JSON archive of the
 * firm's own operational data so a firm can keep a portable backup on
 * their own servers - the first, credential-free step toward
 * "back up the data on their own servers or data warehouses". A live
 * scheduled push to a warehouse (BigQuery / Snowflake / S3) is the
 * follow-up that needs the firm's destination credentials.
 *
 * Owner/admin only. Document FILE BYTES are not included (they live in
 * private storage); the export carries their metadata + storage paths.
 *
 * Deliberately EXCLUDES secret-bearing tables - integration tokens,
 * SCIM/API tokens, webhook secrets, invite/grant tokens - so the
 * archive is safe to store outside Advottic.
 */

// firm_id-scoped tables that are safe + useful to export.
const EXPORT_TABLES = [
  'firm_members',
  'firm_employees',
  'firm_clients',
  'cases',
  'case_deadlines',
  'firm_matter_intakes',
  'firm_documents',
  'firm_signing_requests',
  'firm_invoices',
  'firm_time_entries',
  'firm_trust_accounts',
  'firm_trust_transactions',
  'firm_trust_reconciliations',
  'firm_projects',
  'firm_project_folders',
  'firm_project_items',
  'firm_meetings',
  'firm_channels',
  'firm_trainings',
  'firm_training_assignments',
] as const;

export async function GET() {
  if (!isSupabaseConfigured()) {
    return new Response('Not available.', { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) return new Response('Sign in first.', { status: 401 });
  const ctx = await getActiveFirmContext();
  if (!ctx) return new Response('No active firm.', { status: 403 });
  if (ctx.membership.role !== 'owner' && ctx.membership.role !== 'admin') {
    return new Response('Only an owner or admin can export firm data.', {
      status: 403,
    });
  }
  const admin = createAdminSupabase();
  if (!admin) return new Response('Service role not configured.', { status: 500 });

  const firmId = ctx.firm.id;
  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};

  for (const table of EXPORT_TABLES) {
    try {
      const { data: rows, error } = await admin
        .from(table)
        .select('*')
        .eq('firm_id', firmId);
      if (error) {
        data[table] = { error: error.message };
        counts[table] = 0;
        continue;
      }
      data[table] = rows ?? [];
      counts[table] = (rows ?? []).length;
    } catch (e) {
      data[table] = { error: e instanceof Error ? e.message : 'read failed' };
      counts[table] = 0;
    }
  }

  const archive = {
    _meta: {
      format: 'advottic.firm-export',
      version: 1,
      firm: { id: ctx.firm.id, name: ctx.firm.name, slug: ctx.firm.slug },
      exportedBy: user.email ?? user.id,
      // Timestamp is stamped by the response headers rather than
      // Date.now() so the archive body stays deterministic per data set.
      tables: counts,
      notes:
        'Operational data only. Excludes secrets (integration/SCIM/API tokens, webhook secrets, invite tokens) and document file bytes (paths retained). Store securely.',
    },
    data,
  };

  const body = JSON.stringify(archive, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const safeSlug = (ctx.firm.slug || 'firm').replace(/[^a-z0-9]+/gi, '-');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="advottic-export-${safeSlug}-${stamp}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
