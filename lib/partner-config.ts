'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { createAdminSupabase } from './supabase/admin';
import { callerIsFirmAdmin } from './firm-authz';
import {
  readPartnerConfig,
  type PartnerIntegrationConfig,
  type PartnerQuestion,
} from './partner-config-core';

/** Server actions for the Counsel → Settings "Partner app integration"
 *  panel. Shapes and storage live in lib/partner-config-core.ts. */

/**
 * Both exports below hand out, or rotate, `webhookSecret`. That string is a
 * credential: it is the HMAC-SHA256 key the firm's partner backend uses to
 * prove an inbound event really came from Advottic, so whoever holds it can
 * forge status changes and legal replies into that firm's partner app, and
 * rotating it silently breaks the live integration for everyone at the firm.
 *
 * So the role set is FIRM_ADMIN_ROLES, owner and admin, and no wider. That is
 * this repo's "change firm-wide configuration" set, and a webhook key is
 * firm-wide configuration rather than case work: an attorney or paralegal
 * needs no part of it to run a matter, and `staff` is sold to firm owners as
 * read-only. It also matches what app/counsel/settings/page.tsx already
 * redirects on, so the gate and the surface agree.
 *
 * The check goes through lib/firm-authz.ts, which reads firm_members with the
 * USER-scoped client. It used to be a hand-rolled lookup through
 * createAdminSupabase(), which bypasses RLS: a membership question answered
 * by the service role is a second authorization axis with no policy behind it,
 * and this codebase deliberately has exactly two, firm-authz for firms and
 * isCurrentUserAdmin for HQ.
 */

export async function getPartnerConfigAction(
  firmId: string,
): Promise<{ ok: boolean; config?: PartnerIntegrationConfig; error?: string }> {
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only firm owners and admins can view this.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };
  const { data } = await admin.from('firms').select('metadata').eq('id', firmId).maybeSingle();
  return {
    ok: true,
    config: readPartnerConfig(
      (data as { metadata: Record<string, unknown> | null } | null)?.metadata,
    ),
  };
}

/**
 * Save the partner-integration settings. The webhook secret is minted
 * server-side (never client-supplied): pass rotateSecret to mint a new
 * one; an existing secret is otherwise preserved.
 */
export async function savePartnerConfigAction(
  firmId: string,
  input: {
    ackMessage: string;
    questions: PartnerQuestion[];
    webhookUrl: string;
    remindAfterHours: number;
    rotateSecret?: boolean;
  },
): Promise<{ ok: boolean; config?: PartnerIntegrationConfig; error?: string }> {
  if (!(await callerIsFirmAdmin(firmId))) {
    return { ok: false, error: 'Only firm owners and admins can change this.' };
  }
  const admin = createAdminSupabase();
  if (!admin) return { ok: false, error: 'Server not configured.' };

  const url = input.webhookUrl.trim();
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) {
    return { ok: false, error: 'The webhook URL must be an https:// address.' };
  }

  const { data: firm } = await admin.from('firms').select('metadata').eq('id', firmId).maybeSingle();
  const metadata =
    ((firm as { metadata: Record<string, unknown> | null } | null)?.metadata ?? {}) as Record<
      string,
      unknown
    >;
  const current = readPartnerConfig(metadata);

  const secret =
    input.rotateSecret || (url && !current.webhookSecret)
      ? `whsec_${crypto.randomBytes(24).toString('hex')}`
      : current.webhookSecret;

  const next = readPartnerConfig({
    partnerIntegration: {
      ackMessage: input.ackMessage.trim().slice(0, 500),
      questions: input.questions,
      webhookUrl: url,
      webhookSecret: secret,
      remindAfterHours: input.remindAfterHours,
    },
  });

  const { data: saved, error } = await admin
    .from('firms')
    .update({
      metadata: { ...metadata, partnerIntegration: { ...next } },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId)
    .select('id');
  if (error) return { ok: false, error: error.message };
  // PostgREST reports a write that matched nothing as a success with a null
  // error. Returning `next` on one of those would show the operator a freshly
  // minted webhook secret that is not stored anywhere, which they would then
  // paste into the partner backend and watch every event fail to verify.
  if (!saved || (saved as unknown[]).length === 0) {
    return { ok: false, error: 'Those settings could not be saved. Please try again.' };
  }
  revalidatePath('/counsel/settings');
  return { ok: true, config: next };
}
