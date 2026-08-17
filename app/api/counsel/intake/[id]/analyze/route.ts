import { NextResponse, type NextRequest } from 'next/server';
import { streamBella } from '@/lib/bella';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { getActiveFirmContext, firmAiGate } from '@/lib/firm-storage';
import { BUCKET } from '@/lib/intake-notify';
import {
  firmAiRefusalMessage,
  firmAiRefusalStatus,
} from '@/lib/firm-entitlement';
import { checkRateLimit } from '@/lib/rate-limit';
import { extractFileText } from '@/lib/doc-review';
import {
  selectTicketAnalysisDocuments,
  NO_DOCUMENT,
  type TicketDocumentRow,
} from '@/lib/intake-analysis';

/**
 * Analyse the documents submitted with one ticket.
 *
 * WHY THIS EXISTS RATHER THAN /api/counsel/analyze. That route takes a `text`
 * field and nothing else. It has no intake id and no document id, so there is
 * nothing for it to authorize, and the ticket surface embedded the studio that
 * fed it whatever counsel typed. The owner asked for the opposite: run it on
 * the documents submitted, and do not let counsel supply their own input.
 *
 * So the ticket is named by the PATH, the documents are read from the ticket
 * row, and the request body is not read at all. There is deliberately no
 * parameter a caller could use to name a document, which is stronger than
 * validating one: a route handler is a public HTTP endpoint, and a UI that
 * only offers the ticket's own files gates nothing.
 *
 * The older route is left alone. It still serves /counsel/analyze, which is
 * the standalone studio where supplying your own document is the point.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Per document, and in total, so one long contract cannot crowd out the rest. */
const MAX_PER_DOC = 12_000;
const MAX_TOTAL = 24_000;
/** Bytes. Larger attachments are named in the analysis but not read. */
const MAX_BYTES = 10_000_000;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  const { id: intakeId } = await params;
  if (!intakeId) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const allowed = await checkRateLimit(`counsel-ticket-analyze:${user.id}`, {
    limit: 8,
    windowSeconds: 60,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'One analysis at a time, try again shortly.' },
      { status: 429 },
    );
  }

  /**
   * A hard requirement, unlike /api/counsel/analyze's `if (ctx)`. That route
   * lets a signed-in caller with no active firm skip the entitlement check and
   * bills the model call to the app's own key. This path spends a firm's
   * tokens on a firm's documents, so there is no version of it that makes
   * sense without a firm.
   */
  const ctx = await getActiveFirmContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }
  const gate = await firmAiGate(ctx.firm);
  if (!gate.ok) {
    return NextResponse.json(
      { error: firmAiRefusalMessage(gate.reason) },
      { status: firmAiRefusalStatus(gate.reason) },
    );
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  }

  /**
   * The ticket must belong to the caller's firm. Answering 404 rather than 403
   * so a ticket id from another firm cannot be confirmed to exist.
   */
  const { data: intakeRow } = await admin
    .from('firm_matter_intakes')
    .select('id, firm_id, matter_type')
    .eq('id', intakeId)
    .maybeSingle();
  const intake = intakeRow as
    | { id: string; firm_id: string; matter_type: string | null }
    | null;
  if (!intake || intake.firm_id !== ctx.firm.id) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  const { data: docRows } = await admin
    .from('firm_documents')
    .select('id, firm_id, intake_id, name, file_path, mime_type, archived_at')
    .eq('intake_id', intakeId)
    .eq('firm_id', ctx.firm.id)
    .order('uploaded_at', { ascending: true })
    .limit(20);

  /**
   * The query is already scoped, and the selector compares both ids again.
   * The duplication is the point: it is the one place the rule lives, it is
   * unit tested, and it does not depend on a future edit keeping both
   * predicates on the query.
   */
  const targets = selectTicketAnalysisDocuments(
    (docRows ?? []) as TicketDocumentRow[],
    { intakeId, firmId: ctx.firm.id },
  );

  if (targets.length === 0) {
    return NextResponse.json(
      {
        error:
          'This request has no attached document to analyse. Ask the requester to attach one, or open the request link to collect it.',
        code: NO_DOCUMENT,
      },
      { status: 400 },
    );
  }

  const parts: string[] = [];
  const skipped: string[] = [];
  let budget = MAX_TOTAL;
  for (const target of targets) {
    if (budget <= 0) break;
    const dl = await admin.storage.from(BUCKET).download(target.file_path);
    if (dl.error || !dl.data) {
      skipped.push(target.name);
      continue;
    }
    const blob = dl.data as Blob;
    if (blob.size > MAX_BYTES) {
      skipped.push(target.name);
      continue;
    }
    const file = new File([blob], target.name, {
      type: target.mime_type ?? '',
    });
    const extracted = await extractFileText(file);
    const text = (extracted.text || '').trim();
    if (!text) {
      skipped.push(target.name);
      continue;
    }
    const slice = text.slice(0, Math.min(MAX_PER_DOC, budget));
    budget -= slice.length;
    parts.push(
      [
        `--- DOCUMENT: ${target.name} ---`,
        slice,
        `--- END OF ${target.name} ---`,
      ].join('\n'),
    );
  }

  if (parts.length === 0) {
    return NextResponse.json(
      {
        error:
          'The attached files could not be read as text. A scanned image or a .doc file needs converting to PDF or DOCX first.',
        code: NO_DOCUMENT,
      },
      { status: 400 },
    );
  }

  const states =
    ctx.firm.jurisdictions.join(', ') || 'the stated governing jurisdiction';

  const prompt = [
    'You are senior in-house counsel reviewing a document submitted with an',
    'internal legal request. Analyze it for the team. Be concrete and cite the',
    'clause or section you are referring to.',
    '',
    `Apply the law of the document's governing jurisdiction; if none`,
    `is stated, analyze under ${states} and say which you assumed and`,
    'note the country. Explain how it applies to THIS company.',
    '',
    'Use these exact section headings in this order, plain text only:',
    '',
    'WHAT THIS DOCUMENT IS',
    '  One short paragraph in plain English.',
    '',
    'WHAT IT MEANS, CLAUSE BY CLAUSE',
    '  The material obligations, rights, money, term, termination,',
    '  liability, IP, confidentiality, dispute resolution: what each',
    '  actually does in practice.',
    '',
    'GOVERNING LAW AND HOW IT APPLIES',
    '  The governing law/state/country and how that law affects the',
    '  key clauses for this company specifically.',
    '',
    'BIAS RATING',
    '  State which party the document favors and a lean score from 0',
    '  to 100 where 0 means it heavily favors our side and 100 means it',
    '  heavily favors the counterparty (50 is balanced). Give the score',
    '  as "Lean: NN/100 - favors <party>" then 2 to 4 sentences of why.',
    '',
    'HIDDEN CONSEQUENCES AND RED FLAGS',
    '  Clauses with non-obvious downside: auto-renewal, unilateral',
    '  changes, uncapped liability, indemnity, assignment, IP grabs,',
    '  exclusivity, fee-shifting, venue/arbitration traps. Explain the',
    '  real-world consequence of each.',
    '',
    'RECOMMENDED CHANGES',
    '  Specific redline-style edits, most important first, with the',
    '  reason and suggested replacement language where useful.',
    '',
    'Rules: never use an em-dash or en-dash; use commas or colons.',
    'No markdown, no emoji, no AI preamble or sign-off. This is',
    'analysis for licensed counsel, not advice to a consumer.',
    '',
    skipped.length > 0
      ? `Note: these attachments could not be read and are not covered: ${skipped.join(', ')}.`
      : '',
    '',
    parts.join('\n\n'),
  ]
    .filter((line) => line !== '')
    .join('\n');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        /**
         * `portal` and `firmId` are passed, which /api/counsel/analyze does
         * not do. Without them streamBella resolves portal 'consumer' and
         * firmId null, so its pre-call firm-pool floor never runs while
         * meterBellaTurn still debits the firm pool afterwards by
         * re-deriving the firm itself. The gate and the charge disagreed
         * about which wallet was in play. Passing both makes the refusal
         * happen before the money is spent, and the debit is unchanged.
         */
        for await (const chunk of streamBella({
          mode: 'authed',
          portal: 'firm',
          firmId: ctx.firm.id,
          messages: [{ role: 'user', content: prompt }],
          firmContext: {
            firmName: ctx.firm.name,
            jurisdictions: ctx.firm.jurisdictions,
            practiceAreas: ctx.firm.practiceAreas,
            role: ctx.membership.role,
          },
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `\n\n${err instanceof Error ? err.message : 'Analysis failed.'}`,
          ),
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
