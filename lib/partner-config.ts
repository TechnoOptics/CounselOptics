'use server';

import crypto from 'crypto';
import { revalidatePath } from 'next/cache';
import { createAdminSupabase } from './supabase/admin';
import { requireUser } from './supabase/server';
import {
  readPartnerConfig,
  type PartnerIntegrationConfig,
  type PartnerQuestion,
} from './partner-config-core';

/** Server actions for the Counsel → Settings "Partner app integration"
 *  panel. Shapes and storage live in lib/partner-config-core.ts. */

async function callerIsOwnerOrAdmin(firmId: string): Promise<boolean> {
  const user = await requireUser();
  const admin = createAdminSupabase();
  if (!admin) return false;
  const { data } = await admin
    .from('firm_members')
    .select('role')
    .eq('firm_id', firmId)
    .eq('user_id', user.id)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'admin';
}

export async function getPartnerConfigAction(
  firmId: string,
): Promise<{ ok: boolean; config?: PartnerIntegrationConfig; error?: string }> {
  if (!(await callerIsOwnerOrAdmin(firmId))) {
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
  if (!(await callerIsOwnerOrAdmin(firmId))) {
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

  const { error } = await admin
    .from('firms')
    .update({
      metadata: { ...metadata, partnerIntegration: { ...next } },
      updated_at: new Date().toISOString(),
    })
    .eq('id', firmId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/counsel/settings');
  return { ok: true, config: next };
}
