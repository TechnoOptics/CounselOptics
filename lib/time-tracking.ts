'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase, getCurrentUser } from './supabase/server';

export type TimeEntry = {
  id: string;
  firmId: string;
  userId: string;
  caseId: string | null;
  documentId: string | null;
  description: string | null;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  billable: boolean;
  rateCents: number | null;
  source: 'manual' | 'bella' | 'document' | 'chat' | 'calendar';
};

type TimeEntryRow = {
  id: string;
  firm_id: string;
  user_id: string;
  case_id: string | null;
  document_id: string | null;
  description: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  billable: boolean;
  rate_cents: number | null;
  source: string;
};

function fromRow(r: TimeEntryRow): TimeEntry {
  return {
    id: r.id,
    firmId: r.firm_id,
    userId: r.user_id,
    caseId: r.case_id,
    documentId: r.document_id,
    description: r.description,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds,
    billable: r.billable,
    rateCents: r.rate_cents,
    source: r.source as TimeEntry['source'],
  };
}

/**
 * Start a timer for the current user. The timer stays open
 * (ended_at = null) until stopTimer or any subsequent startTimer
 * implicitly closes it - we enforce one open timer per user per
 * firm to keep billing honest.
 */
export async function startTimerAction(
  firmId: string,
  opts: {
    caseId?: string | null;
    documentId?: string | null;
    description?: string | null;
    source?: TimeEntry['source'];
  } = {},
): Promise<{ ok: boolean; error?: string; entryId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const { data: member } = await supabase
    .from('firm_members')
    .select('default_rate_cents')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member) return { ok: false, error: 'You are not a member of that firm.' };
  const defaultRate = (member as { default_rate_cents: number | null })
    .default_rate_cents;

  // Implicitly stop any other open timer this user has on this firm.
  await supabase
    .from('firm_time_entries')
    .update({
      ended_at: new Date().toISOString(),
      duration_seconds: null,
    })
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .is('ended_at', null);
  // Recompute their durations now that we have ended_at set.
  await syncOpenDurations(firmId, user.id);

  const { data, error } = await supabase
    .from('firm_time_entries')
    .insert({
      firm_id: firmId,
      user_id: user.id,
      case_id: opts.caseId ?? null,
      document_id: opts.documentId ?? null,
      description: opts.description ?? null,
      started_at: new Date().toISOString(),
      billable: true,
      rate_cents: defaultRate,
      source: opts.source ?? 'manual',
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Insert failed.' };
  }
  revalidatePath('/counsel');
  if (opts.caseId) revalidatePath(`/counsel/cases/${opts.caseId}`);
  return { ok: true, entryId: (data as { id: string }).id };
}

export async function stopTimerAction(
  firmId: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const now = new Date().toISOString();

  const { data: open, error: openErr } = await supabase
    .from('firm_time_entries')
    .select('id, started_at, case_id')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .is('ended_at', null)
    .limit(1);
  if (openErr) return { ok: false, error: openErr.message };
  if (!open || open.length === 0) {
    return { ok: false, error: 'No open timer to stop.' };
  }
  const row = open[0] as { id: string; started_at: string; case_id: string | null };
  const seconds = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(row.started_at)) / 1000),
  );

  const { error } = await supabase
    .from('firm_time_entries')
    .update({ ended_at: now, duration_seconds: seconds })
    .eq('id', row.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel');
  if (row.case_id) revalidatePath(`/counsel/cases/${row.case_id}`);
  return { ok: true };
}

/**
 * Insert a manual time entry (already-completed). Used when the
 * operator forgets to start a timer and is back-filling.
 */
export async function logManualEntryAction(
  firmId: string,
  input: {
    caseId?: string | null;
    description: string;
    durationSeconds: number;
    billable?: boolean;
    rateCents?: number | null;
  },
): Promise<{ ok: boolean; error?: string; entryId?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const supabase = createServerSupabase();
  const now = new Date();
  const startedAt = new Date(now.getTime() - input.durationSeconds * 1000);
  const { data, error } = await supabase
    .from('firm_time_entries')
    .insert({
      firm_id: firmId,
      user_id: user.id,
      case_id: input.caseId ?? null,
      description: input.description,
      started_at: startedAt.toISOString(),
      ended_at: now.toISOString(),
      duration_seconds: input.durationSeconds,
      billable: input.billable ?? true,
      rate_cents: input.rateCents ?? null,
      source: 'manual',
    })
    .select('id')
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Insert failed.' };
  }
  revalidatePath('/counsel');
  return { ok: true, entryId: (data as { id: string }).id };
}

async function syncOpenDurations(firmId: string, userId: string) {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_time_entries')
    .select('id, started_at, ended_at, duration_seconds')
    .eq('firm_id', firmId)
    .eq('user_id', userId)
    .is('duration_seconds', null)
    .not('ended_at', 'is', null);
  for (const r of (data ?? []) as Array<{
    id: string;
    started_at: string;
    ended_at: string;
  }>) {
    const seconds = Math.max(
      0,
      Math.floor(
        (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000,
      ),
    );
    await supabase
      .from('firm_time_entries')
      .update({ duration_seconds: seconds })
      .eq('id', r.id);
  }
}

export async function listTimeEntriesForCase(
  firmId: string,
  caseId: string,
): Promise<TimeEntry[]> {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_time_entries')
    .select('*')
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .order('started_at', { ascending: false });
  return ((data ?? []) as TimeEntryRow[]).map(fromRow);
}

export async function listOpenTimer(firmId: string): Promise<TimeEntry | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('firm_time_entries')
    .select('*')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1);
  if (!data || data.length === 0) return null;
  return fromRow(data[0] as TimeEntryRow);
}
