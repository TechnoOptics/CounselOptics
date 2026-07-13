import { NextResponse } from 'next/server';
import { resolveCaseActor, logCaseActivity, type CaseActivityAction } from '@/lib/case-activity-log';

export const dynamic = 'force-dynamic';

/**
 * Client-reported case activity (e.g. a co-counsel opening a collapsed section).
 * Authenticated + participant-gated: the caller must resolve to an actor on the
 * matter (firm member or collaborator). Server-side actions log their own events
 * directly via logCaseActivity; this route only accepts the small set of events
 * that can only be observed in the browser.
 */

const CLIENT_ACTIONS = new Set<CaseActivityAction>(['open_section']);

export async function POST(req: Request) {
  let body: { caseId?: unknown; action?: unknown; detail?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const caseId = typeof body.caseId === 'string' ? body.caseId : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!caseId || !CLIENT_ACTIONS.has(action as CaseActivityAction)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Must be a real participant on this matter.
  const actor = await resolveCaseActor(caseId);
  if (!actor || actor.kind === 'other') {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  // Only trust a short, sanitized section label from the client.
  const rawSection =
    body.detail && typeof (body.detail as { section?: unknown }).section === 'string'
      ? (body.detail as { section: string }).section
      : '';
  const section = rawSection.trim().slice(0, 80);

  await logCaseActivity({
    caseId,
    action: action as CaseActivityAction,
    actor,
    detail: section ? { section } : {},
    // A section can be opened/closed repeatedly; collapse the churn.
    throttleMinutes: 3,
  });

  return NextResponse.json({ ok: true });
}
