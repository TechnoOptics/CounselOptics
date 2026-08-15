import { NextResponse, type NextRequest } from 'next/server';
import { bellaGenerate } from '@/lib/bella';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import {
  getActiveFirmContext,
  firmAiGate,
} from '@/lib/firm-storage';
import {
  firmAiRefusalMessage,
  firmAiRefusalStatus,
} from '@/lib/firm-entitlement';
import { cleanLegalText } from '@/lib/legal-templates';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServerSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Free-prompt letter generation (#13). Unlike /draft-template (which
 * fills a fixed template), this drafts a letter on the firm's
 * letterhead from a plain-language prompt, optionally grounded in a
 * case. The output is ONLY the letter body (salutation through the
 * pre-closing paragraph); the signature/date/witness block is added
 * by the client from the include-toggles, so the model can't
 * duplicate or fight it.
 */
export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Not available.' }, { status: 400 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }
  const allowed = await checkRateLimit(`counsel-draft-letter:${user.id}`, {
    limit: 6,
    windowSeconds: 60,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: 'One letter at a time - try again in a moment.' },
      { status: 429 },
    );
  }
  const ctx = await getActiveFirmContext();
  if (!ctx) {
    return NextResponse.json({ error: 'No active firm.' }, { status: 403 });
  }
  const gate = await firmAiGate(ctx.firm);
  if (!gate.ok) {
    return NextResponse.json(
      { error: firmAiRefusalMessage(gate.reason) },
      { status: firmAiRefusalStatus(gate.reason) },
    );
  }

  let body: {
    prompt?: string;
    recipient?: string;
    caseId?: string;
    tone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }
  const promptText = String(body.prompt ?? '').trim().slice(0, 4000);
  if (promptText.length < 8) {
    return NextResponse.json(
      { error: 'Tell me what the letter should say (a sentence or two is enough).' },
      { status: 400 },
    );
  }
  const recipient = String(body.recipient ?? '').trim().slice(0, 300);
  const tone = String(body.tone ?? '').trim().slice(0, 60);

  // Optional case grounding. Firm-scoped read so a caller can only
  // pull a case their firm owns; a mismatch just drops the context.
  let caseContext = '';
  const caseId = String(body.caseId ?? '').trim();
  if (caseId) {
    try {
      const supabase = createServerSupabase();
      const { data: kase } = await supabase
        .from('cases')
        .select('title, description')
        .eq('id', caseId)
        .eq('firm_id', ctx.firm.id)
        .maybeSingle();
      const k = kase as { title?: string; description?: string } | null;
      if (k?.title) {
        caseContext = `This letter relates to the matter "${k.title}"${
          k.description ? `: ${String(k.description).slice(0, 800)}` : ''
        }.`;
      }
    } catch {
      /* case grounding is best-effort */
    }
  }

  const brandName =
    String(
      (ctx.firm.metadata as Record<string, unknown> | null)?.brandName ?? '',
    ).trim() || ctx.firm.name;

  const system = [
    `You are senior counsel at "${ctx.firm.name}", writing a formal`,
    'business letter on the firm letterhead as the firm\'s own work',
    'product. Output ONLY the letter itself: the date line is NOT',
    'needed (the letterhead carries branding), start at the recipient',
    'address block or salutation and end at the final paragraph BEFORE',
    'the closing. Do NOT write "Sincerely", a signature block, names,',
    'titles, or witness lines - those are added separately. Never use',
    'an em-dash or en-dash (use commas, colons, or separate sentences).',
    'No markdown, no asterisks, no emoji, no "as an AI" phrasing.',
    'Formal, precise, professional English.',
  ].join('\n');

  const prompt = [
    `Draft a letter for ${ctx.firm.name}.`,
    recipient ? `Recipient: ${recipient}.` : '',
    tone ? `Desired tone: ${tone}.` : '',
    caseContext,
    ctx.firm.jurisdictions.length
      ? `The firm operates in: ${ctx.firm.jurisdictions.join(', ')}.`
      : '',
    '',
    'What the letter needs to say:',
    promptText,
    '',
    'Remember: output only the letter body (recipient block/salutation',
    'through the closing paragraph). No "Sincerely", no signature block.',
  ]
    .filter(Boolean)
    .join('\n');

  let raw = '';
  try {
    raw = await bellaGenerate({ system, prompt, maxTokens: 3000 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not draft the letter.' },
      { status: 502 },
    );
  }

  const letter = cleanLegalText(raw);
  if (letter.length < 80) {
    return NextResponse.json(
      { error: 'The draft came back too short - try again with more detail.' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    body: letter,
    firmName: ctx.firm.name,
    brandName,
    logoUrl: ctx.firm.logoUrl ?? null,
    letterheadUrl: ctx.firm.letterheadUrl ?? null,
    accent: ctx.firm.accentColor,
    generatedAt: new Date().toISOString(),
  });
}
