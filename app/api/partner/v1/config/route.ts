import { NextResponse } from 'next/server';
import { authenticatePartner } from '@/lib/partner-tickets';
import { readPartnerConfig } from '@/lib/partner-config-core';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getPublishedPayload } from '@/lib/form-queries';
import { projectToPartnerQuestions } from '@/lib/form-to-partner';

export const runtime = 'nodejs';

/**
 * GET /api/partner/v1/config returns the firm's partner-app configuration:
 *
 *   - `questions`: the intake questions the legal team wants asked on the
 *     partner app's "New legal request" form. Render them in order and
 *     send the answers back as `answers: { [question.id]: value }` on
 *     ticket create.
 *   - `acknowledgment`: the confirmation message (set by the legal team,
 *     usually about response time) to show the employee after filing.
 *   - `webhook.configured`: whether outbound event webhooks are set up.
 *
 * Fetch on app start / periodically, since the legal team can change these
 * at any time from Counsel → Settings.
 *
 * `?type=<slug>` is optional and additive. The slug is the same string the
 * app already sends as `category` on ticket create. Where the legal team has
 * built and published a form for that request type, `questions` is that form
 * projected into the three types this API has always used, and
 * `formVersionId` names the version they came from. Without the parameter,
 * or where nothing is published, the response is byte for byte what it has
 * always been apart from `formVersionId: null`.
 *
 * Echo `formVersionId` back on ticket create. It is what tells us the answers
 * were collected on the questions currently published, and it is what binds
 * the filed request to that exact version of the form.
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

  // Scoped to the token's own firm, so a slug can only ever reach a form that
  // firm published. An unknown slug resolves to nothing and falls back.
  const typeKey = (new URL(req.url).searchParams.get('type') ?? '').trim();
  const published = typeKey
    ? await getPublishedPayload(admin, auth.auth.firmId, typeKey)
    : null;
  const questions = published
    ? projectToPartnerQuestions(published.payload)
    : config.questions;

  return NextResponse.json({
    firmName: firm.name,
    acknowledgment: config.ackMessage,
    questions: questions.map((q) => ({
      id: q.id,
      label: q.label,
      type: q.type,
      options: q.options ?? null,
      required: q.required === true,
    })),
    formVersionId: published?.versionId ?? null,
    webhook: { configured: Boolean(config.webhookUrl && config.webhookSecret) },
  });
}
