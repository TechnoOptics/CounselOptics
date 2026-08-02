import 'server-only';

import { createAdminSupabase } from './supabase/admin';
import { listPublishedPayloads, listRequestTypes, type PublishedForms } from './form-queries';
import type { RequestTypeLike } from './intake-form-fallback';

/**
 * What the two intake surfaces need before they can render: this firm's
 * request types, and whichever of them have a published form.
 *
 * Deliberately NOT a `'use server'` module. Every export of one of those is a
 * callable HTTP endpoint, and this reads through the service-role client. It
 * is for server components that have already resolved the caller's own firm.
 * Same split as lib/form-queries.ts, which it wraps.
 *
 * It never throws and never rejects. Filing a request to legal is the point of
 * both surfaces, and a firm must be able to do it whether or not this feature
 * is reachable, so an unconfigured service role or a failed read degrades to
 * "no types, nothing published", which the picker reads as the built-in twelve
 * and today's fixed fields. That is the same thing every firm sees now.
 */
export async function readIntakeFormConfig(
  firmId: string,
): Promise<{ requestTypes: RequestTypeLike[]; publishedForms: PublishedForms }> {
  const empty = { requestTypes: [] as RequestTypeLike[], publishedForms: {} as PublishedForms };
  const admin = createAdminSupabase();
  if (!admin || !firmId) return empty;

  try {
    const [requestTypes, publishedForms] = await Promise.all([
      listRequestTypes(admin, firmId),
      listPublishedPayloads(admin, firmId),
    ]);
    return { requestTypes, publishedForms };
  } catch {
    return empty;
  }
}
