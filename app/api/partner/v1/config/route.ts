import { NextResponse } from 'next/server';
import { authenticatePartner } from '@/lib/partner-tickets';
import { readPartnerConfig } from '@/lib/partner-config-core';
import { createAdminSupabase } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * GET /api/partner/v1/config — the firm's partner-app configuration:
 *
 *   - `questions`: the intake questions the legal team wants asked on the
 *     partner app's "New legal request" form. Render them in order and
 *     send the answers back as `answers: { [question.id]: value }` on
 *     ticket create.
 *   - `acknowledgment`: the confirmation message (set by the legal team,
 *     usually about response time) to show the employee after filing.
 *   - `webhook.configured`: whether outbound event webhooks are set up.
 *
 * Fetch on app start / periodically — the legal team can change these at
 * any time from Counsel → Settings.
 */
export async function GET(req: Request) {
  const auth = await authenticatePartner(req.headers.get('authorization'));
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const admin = createAdminSupabase();
  if (!admin) return NextResponse.json({ error: 'Server not configured.' }, { status: 500 });
  const { data } = await admin
    .from('firms')
    .select('name, metadata')
    .eq('id', auth.auth.firmId)
    .maybeSingle();
  const firm = data as { name: string; metadata: Record<string, unknown> | null } | null;
  if (!firm) return NextResponse.json({ error: 'Firm not found.' }, { status: 404 });
  const config = readPartnerConfig(firm.metadata);
  return NextResponse.json({
    firmName: firm.name,
    acknowledgment: config.ackMessage,
    questions: config.questions.map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      options: q.options ?? null,
      required: q.required === true,
    })),
    webhook: { configured: Boolean(config.webhookUrl && config.webhookSecret) },
  });
}
