import { type NextRequest } from 'next/server';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { callerFirmRole } from '@/lib/firm-authz';
import { canReadSubmissionDocument } from '@/lib/template-approval';
import { loadPublishedTemplate } from '@/lib/template-fill';
import { resolveDispatchMode } from '@/lib/submission-dispatch';
import { renderSubmissionPreview, type SubmissionPreviewRow } from '@/lib/submission-preview';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * The branded PDF a reviewer is about to release, for the approvals screen.
 *
 * This is a fourth caller of buildBrandedDocumentPdf, and that module's header
 * says a new caller needs a gate of its own, because nothing inside it asks
 * who is rendering. This is that gate, and it has two halves.
 *
 * WHO. canReadSubmissionDocument, the same predicate the detail page uses to
 * decide whether to print the wording at all. A preview is a READ of a
 * document the firm has not agreed to send, and a prettier read is still a
 * read: without this, a paralegal who is shown "the wording is open to the
 * people who decide on it" could fetch the finished, letterheaded file
 * instead. The rule is not restated here, it is called.
 *
 * WHICH VERSION. The caller states the revision and the wording their page
 * rendered, and anything else is refused. The decision itself is pinned to
 * that revision (decideTemplateSubmissionAction), so a preview that could
 * render a different one would be worse than the plain text it replaces: a
 * reviewer would believe they had checked a document they had not. The bytes
 * are always rendered from the STORED document_text, never from the posted
 * copy, so the comparison decides whether to answer and never what to draw.
 *
 * ORDER IS LOAD-BEARING, FOR THE REASON THE DECISION ACTION GIVES. The read
 * gate runs BEFORE the wording comparison. Reversed, the staleness reply would
 * tell a member who may not read the wording whether a string they guessed
 * matches the stored one, which turns the narrowed read into an oracle they
 * could query a guess at a time. Do not reorder these two blocks.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) return new Response('Not available.', { status: 400 });
  const user = await getCurrentUser();
  if (!user) return new Response('Sign in first.', { status: 401 });
  const admin = createAdminSupabase();
  if (!admin) return new Response('Not available.', { status: 400 });

  let body: { submissionId?: string; revision?: number; documentText?: string };
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid body.', { status: 400 });
  }

  const submissionId = String(body.submissionId ?? '').trim();
  if (!submissionId) return new Response('Invalid body.', { status: 400 });

  const { data } = await admin
    .from('firm_template_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();
  const row = (data as SubmissionPreviewRow | null) ?? null;
  if (!row) return new Response('That submission could not be found.', { status: 404 });

  const role = await callerFirmRole(row.firm_id);
  const isSubmitter = row.submitted_by === user.id;
  if (!canReadSubmissionDocument({ role, isSubmitter, status: row.status })) {
    return new Response(
      'The wording of a document that has not been released is open to the colleague who filled it in and to the owners, admins, and attorneys who decide on it.',
      { status: 403 },
    );
  }

  const revision =
    typeof body.revision === 'number' && Number.isInteger(body.revision) ? body.revision : -1;
  if (revision !== row.revision || String(body.documentText ?? '') !== row.document_text) {
    return new Response(
      'The wording changed while this was open. Reload it, read the current version, and decide again.',
      { status: 409 },
    );
  }

  // Which of the two deliveries approving would perform, from the rule the
  // dispatcher itself uses over the same two inputs, so the preview cannot
  // draw a page that belongs to the other one.
  const template = row.delivery_mode
    ? null
    : row.template_id
      ? await loadPublishedTemplate(admin, row.firm_id, row.template_id)
      : null;
  const mode = resolveDispatchMode({
    submissionMode: row.delivery_mode,
    templateMode: template?.deliveryMode,
  });

  const bytes = await renderSubmissionPreview(admin, row, mode);
  // A refusal, not a throw: the renderer returns null for a document with
  // nothing worth rendering in it. Saying so in words matters more here than
  // anywhere else in the product, because a blank frame on an approvals screen
  // reads as "the document is empty", which is the one wrong conclusion a
  // reviewer must not draw before releasing something.
  if (!bytes) {
    return new Response('This document could not be prepared for preview.', { status: 400 });
  }

  return new Response(bytes as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
    },
  });
}
