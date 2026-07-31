'use server';

import { postIntakeMessageAction } from './intake-conversation';

/**
 * Legacy entry point for posting into a request's thread.
 *
 * Messages used to be appended to the `intake_answers.thread` jsonb array.
 * They now live in the `firm_intake_messages` table (see
 * supabase/migrations/20260727_intake_conversation.sql) so the conversation
 * can stream live, carry attachments, and separate internal legal notes from
 * what the requester sees.
 *
 * This wrapper stays so existing callers (notably Bella's `post_intake_message`
 * tool) keep working unchanged. All authorization, rate limiting, and
 * notification fan-out happen inside `postIntakeMessageAction`.
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
  mentions: string[] = [],
): Promise<{ ok: boolean; error?: string }> {
  const res = await postIntakeMessageAction(intakeId, {
    body: text,
    visibility: 'shared',
    mentions,
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
