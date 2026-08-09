'use server';

import { revalidatePath } from 'next/cache';
import { isCurrentUserAdmin } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Closing a security event, which nothing could do.
 *
 * `security_events.acknowledged_at` was written once, at insert, and never
 * again: severity `low` went in pre-acknowledged and everything else went in
 * open. The `integrity.open_events` control turns critical above five open
 * rows, and gradeFromPulse turns a single critical into a D. With no way to
 * acknowledge anything, the count only ever rose, so the Security Center
 * presented a posture grade that could not move. A grade nobody can change is
 * not a measurement, it is a decoration.
 *
 * THE GATE IS HERE, not on the page. Every export of a 'use server' module is
 * a public POST endpoint with a stable id, reachable by any signed-in visitor
 * with a hand-written request; the check in app/admin/layout.tsx protects the
 * PAGE and nothing else. HQ is the only axis this action has - there is no
 * firm here to be a member of - so isCurrentUserAdmin is the whole
 * authorization, and it runs before anything is read or written.
 *
 * THE WRITE HAS TO BE COUNTED. postgrest-js resolves with `{ error: null }`
 * for an update whose filter matched no row, so without `.select()` an
 * acknowledge of an id that is gone, or of an event somebody else already
 * closed, is indistinguishable from one that worked: the page revalidates,
 * the row stays where it was, and the operator concludes the button is
 * broken. Zero rows is reported as a failure the operator can read.
 *
 * WHO acknowledged is not recorded. The live table has no `acknowledged_by`
 * column - an earlier migration declared one and production never had it -
 * and adding it is a schema change, which is the owner's step, not this
 * action's.
 */

export type AcknowledgeEventResult =
  | { ok: true }
  | { ok: false; error: string };

export async function acknowledgeSecurityEventAction(
  eventId: string,
): Promise<AcknowledgeEventResult> {
  if (!(await isCurrentUserAdmin())) {
    return {
      ok: false,
      error: 'Admin access is required to triage security events.',
    };
  }
  const id = String(eventId ?? '').trim();
  if (!id) return { ok: false, error: 'No event was named.' };

  const admin = createAdminSupabase();
  if (!admin) {
    return {
      ok: false,
      error:
        'The service-role key is not set in this environment, so nothing was written.',
    };
  }

  const { data, error } = await admin
    .from('security_events')
    .update({ acknowledged_at: new Date().toISOString() })
    .eq('id', id)
    .is('acknowledged_at', null)
    .select('id');
  if (error) {
    return { ok: false, error: `Could not acknowledge that event: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        'Nothing was acknowledged. That event is already closed, or it is no longer there. Reload the page to see the current feed.',
    };
  }

  revalidatePath('/admin/security-center');
  revalidatePath('/admin/security');
  revalidatePath('/admin');
  return { ok: true };
}
