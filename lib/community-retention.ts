import { createAdminSupabase } from './supabase/admin';
import { appendWitnessEvent } from './witness-audit';

const GRACE_PERIOD_MS = 48 * 60 * 60 * 1000;

/**
 * Enforces the "ID photos are kept until the organizer/attorney manually
 * closes the case" retention decision. Closing a Community Case
 * (closeCommunityCaseAction, lib/community-actions.ts) schedules every
 * Letter of Support's ID/signature images for deletion by setting
 * purge_scheduled_at - it does NOT delete them synchronously, so an
 * accidental or premature close can still be undone via
 * reopenCommunityCaseAction within the 48h window (storage deletion is
 * otherwise irreversible, which is exactly the kind of action worth a
 * cooling-off period for).
 *
 * This function is the actual deletion step, meant to run on a schedule
 * (see app/api/cron/purge-community-ids/route.ts) rather than inline
 * with the close action - a synchronous delete would leave no room for
 * the grace-period undo.
 *
 * What gets deleted: signature_image_path, id_front_path, id_back_path
 * (the highest-sensitivity artifacts - a stranger's driver's license
 * image and their signature). What is deliberately NOT touched: the
 * letter text, name, mailing address, and the sha256 hashes already
 * computed at upload time - those are the content of value to the
 * attorney and the audit trail that proves an ID was checked, and
 * neither should disappear just because the ID photo did.
 */
export async function purgeScheduledIdImages(): Promise<{
  purged: number;
  skipped: number;
  errors: number;
}> {
  const admin = createAdminSupabase();
  if (!admin) return { purged: 0, skipped: 0, errors: 0 };

  const cutoff = new Date(Date.now() - GRACE_PERIOD_MS).toISOString();
  const { data, error } = await admin
    .from('witness_submissions')
    .select('id, signature_image_path, id_front_path, id_back_path')
    .not('purge_scheduled_at', 'is', null)
    .lte('purge_scheduled_at', cutoff)
    .neq('status', 'purged');
  if (error || !data) return { purged: 0, skipped: 0, errors: error ? 1 : 0 };

  let purged = 0;
  let errors = 0;
  for (const row of data as Array<{
    id: string;
    signature_image_path: string | null;
    id_front_path: string | null;
    id_back_path: string | null;
  }>) {
    const paths = [row.signature_image_path, row.id_front_path, row.id_back_path].filter(
      (p): p is string => Boolean(p),
    );
    if (paths.length > 0) {
      const { error: removeErr } = await admin.storage.from('community-submissions').remove(paths);
      if (removeErr) {
        errors++;
        continue;
      }
    }
    const { error: updateErr } = await admin
      .from('witness_submissions')
      .update({
        status: 'purged',
        purged_at: new Date().toISOString(),
        signature_image_path: null,
        id_front_path: null,
        id_back_path: null,
      })
      .eq('id', row.id);
    if (updateErr) {
      errors++;
      continue;
    }
    await appendWitnessEvent(admin, { submissionId: row.id, eventType: 'purged' });
    purged++;
  }

  return { purged, skipped: data.length - purged - errors, errors };
}
