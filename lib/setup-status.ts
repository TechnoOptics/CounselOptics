import { isSupabaseConfigured } from './supabase/server';

/**
 * Returns true when the deployment is on a serverless/read-only host
 * (Vercel sets VERCEL=1 automatically) AND Supabase isn't configured. In
 * that combination, the local-JSON storage fallback can't write to disk
 * and any storage call will crash. Pages should detect this and render a
 * setup screen instead of attempting reads.
 */
export function storageUnavailable(): boolean {
  if (isSupabaseConfigured()) return false;
  return process.env.VERCEL === '1' || process.env.VERCEL === 'true';
}

export const STORAGE_SETUP_MESSAGE =
  'CounselOptics needs Supabase to be configured on this deployment to read and write case data. The local-file fallback only works on a writable filesystem (your laptop, not serverless).';
