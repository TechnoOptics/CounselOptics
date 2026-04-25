import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl } from './server';

/**
 * Server-only Supabase client that uses the service-role key, bypassing RLS.
 * Use ONLY for admin views; never expose this client to the browser.
 *
 * Returns null when the service-role key is not configured. Pages that need it
 * should treat that as "admin features unavailable" and degrade gracefully.
 */
export function createAdminSupabase() {
  const url = getSupabaseUrl();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function isServiceRoleConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}
