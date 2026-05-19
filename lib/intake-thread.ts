'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

/**
 * Two-way thread on an intake / request, employee <-> legal.
 *
 * Stored append-only inside the existing `intake_answers.thread`
 * JSON array so it needs NO migration. One action serves both
 * surfaces:
 *   - the employee portal (/portal/[id]) - the person who filed it
 *   - the counsel intake detail (/counsel/intake/[id]) - the firm's
 *     legal team
 *
 * Authorization is explicit (the table is RLS-locked and we use the
 * service-role client, so the action itself is the gate):
 *   - role 'employee' : intake.created_by === me
 *   - role 'legal'    : I am a firm_members row of intake.firm_id
 *   - otherwise       : rejected
 */

export type ThreadMessage = {
  id: string;
  byUserId: string;
  name: string;
  role: 'employee' | 'legal';
  at: string;
  text: string;
};

export async function postIntakeThreadMessageAction(
  intakeId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  const body = text.trim();
  if (!body) return { ok: false, error: 'Write a message first.' };
  if (body.length > 4000) {
    return { ok: false, error: 'Message is too long (4000 char max).' };
  }
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Sign in first.' };
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const { data: intakeRow } = await admin
    .from('firm_matter_intakes')
    .select('id, firm_id, created_by, intake_answers')
    .eq('id', intakeId)
    .maybeSingle();
  if (!intakeRow) return { ok: false, error: 'Request not found.' };
  const intake = intakeRow as {
    id: string;
    firm_id: string;
    created_by: string | null;
    intake_answers: Record<string, unknown> | null;
  };

  // Resolve the caller's role on THIS intake.
  let role: 'employee' | 'legal' | null = null;
  let name = user.email ?? 'You';
  if (intake.created_by && intake.created_by === user.id) {
    role = 'employee';
    const { data: emp } = await admin
      .from('firm_employees')
      .select('display_name, email')
      .eq('firm_id', intake.firm_id)
      .eq('user_id', user.id)
      .maybeSingle();
    const e = emp as { display_name?: string; email?: string } | null;
    name = e?.display_name || e?.email || name;
  } else {
    const { data: mem } = await admin
      .from('firm_members')
      .select('display_name')
      .eq('firm_id', intake.firm_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (mem) {
      role = 'legal';
      name = (mem as { display_name?: string }).display_name || 'Legal';
    }
  }
  if (!role) {
    return { ok: false, error: 'You do not have access to this request.' };
  }

  const answers = (intake.intake_answers ?? {}) as Record<string, unknown>;
  const thread = Array.isArray(answers.thread)
    ? (answers.thread as ThreadMessage[])
    : [];
  const msg: ThreadMessage = {
    id:
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    byUserId: user.id,
    name,
    role,
    at: new Date().toISOString(),
    text: body,
  };
  const nextAnswers = { ...answers, thread: [...thread, msg] };

  const { error } = await admin
    .from('firm_matter_intakes')
    .update({
      intake_answers: nextAnswers,
      updated_at: new Date().toISOString(),
    })
    .eq('id', intakeId);
  if (error) return { ok: false, error: error.message };

  // Close the loop. When legal replies, ping the employee who filed
  // it so they actually come back and see the answer (this is what
  // makes the thread a real two-way channel, not a black hole).
  // Best-effort - a notification miss never fails the post.
  if (role === 'legal' && intake.created_by) {
    try {
      const { createNotification } = await import('./notifications');
      await createNotification({
        userId: intake.created_by,
        type: 'system',
        title: 'Legal replied to your request',
        body: body.length > 140 ? `${body.slice(0, 137)}...` : body,
        link: `/portal/${intakeId}`,
        actorUserId: user.id,
      });
    } catch {
      /* notifications are best-effort */
    }
  }

  revalidatePath(`/portal/${intakeId}`);
  revalidatePath('/portal');
  revalidatePath(`/counsel/intake/${intakeId}`);
  return { ok: true };
}
