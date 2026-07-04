import { NextResponse, type NextRequest } from 'next/server';
import { streamBella, type BellaMessage, type BellaPortal } from '@/lib/bella';
import { getCase, listExhibits, getLatestReview } from '@/lib/storage';
import {
  getCurrentUser,
  isCurrentUserAdmin,
  isSupabaseConfigured,
} from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function ipFrom(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Resolve which portal this Bella turn belongs to, server-side. The
 * client sends a hint; we VERIFY it against the actual session (firm
 * membership / admin role) and refuse hard rather than silently
 * downgrade so a misconfigured client can never spill data across
 * surfaces.
 *
 * Returns either { portal, firmId } on success, or { error } when the
 * requested portal is not legitimate for this user. Public (logged-
 * out) visitors are always 'consumer'.
 */
async function resolvePortal(
  hint: BellaPortal | undefined,
  legacyFirmModeFlag: boolean,
  referer: string,
): Promise<
  | { portal: BellaPortal; firmId: string | null }
  | { error: string; status: number }
> {
  // The client can opt-in via:
  //   portal: 'firm'  - new explicit field
  //   firmMode: true  - legacy field, kept for back-compat with the
  //                     Counsel surfaces shipped before the portal
  //                     field existed
  //   referer matches /counsel - last-resort detection so a missing
  //                              flag still ends up on the right
  //                              portal (was the only mechanism
  //                              before; kept as a safety net).
  const refererIsCounsel = referer.includes('/counsel');
  const wantsFirm =
    hint === 'firm' || legacyFirmModeFlag || refererIsCounsel;
  const wantsHq = hint === 'hq';

  if (wantsHq) {
    const isAdmin = await isCurrentUserAdmin();
    if (!isAdmin) {
      return {
        error: 'HQ admin chat is not available for this account.',
        status: 403,
      };
    }
    return { portal: 'hq', firmId: null };
  }

  if (wantsFirm) {
    const { getActiveFirmContext } = await import('@/lib/firm-storage');
    const ctx = await getActiveFirmContext().catch(() => null);
    if (!ctx) {
      // Firm portal was requested but the user has no firm. Refuse
      // explicitly rather than silently downgrading to consumer
      // mode - downgrading would expose the user's personal cases
      // in a place where they asked for firm data.
      return {
        error:
          "You're not signed in to a firm workspace. Open the enterprise login to chat about firm matters.",
        status: 400,
      };
    }
    return { portal: 'firm', firmId: ctx.firm.id };
  }

  return { portal: 'consumer', firmId: null };
}

export async function POST(req: NextRequest) {
  const ip = ipFrom(req);
  if (!(await checkRateLimit(`bella:${ip}`, { limit: 30, windowSeconds: 60 }))) {
    return NextResponse.json({ error: 'Slow down - too many messages.' }, { status: 429 });
  }

  // Bella is available to logged-out visitors as a brand ambassador, but in
  // a strictly capped "public" mode: she can answer questions about what
  // the app does, pricing, and general legal information, but never reads
  // case content (no caseId), never runs any subscription-only feature on
  // the user's behalf, and is rate-limited the same way an authed user is.
  let isPublic = false;
  if (isSupabaseConfigured()) {
    const user = await getCurrentUser();
    if (!user) {
      isPublic = true;
    }
  }

  let payload: {
    messages?: BellaMessage[];
    caseId?: string;
    firmMode?: boolean;
    portal?: BellaPortal;
    attachment?: unknown;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const messages = Array.isArray(payload.messages) ? payload.messages.slice(-20) : [];
  if (messages.length === 0 || !messages.some((m) => m.role === 'user')) {
    return NextResponse.json({ error: 'No user message provided.' }, { status: 400 });
  }

  // Sanitize messages
  const sanitized: BellaMessage[] = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 4000) : '',
    }))
    .filter((m) => m.content.length > 0);

  // Optional file the user attached this turn, already normalized by
  // /api/bella/attach (text extracted server-side, or a base64 image).
  type BellaAttachment =
    | { kind: 'text'; name: string; text: string }
    | { kind: 'image'; name: string; mediaType: string; data: string };
  let attachment: BellaAttachment | null = null;
  const rawAtt = payload.attachment;
  if (rawAtt && typeof rawAtt === 'object') {
    const a = rawAtt as Record<string, unknown>;
    const name =
      typeof a.name === 'string' && a.name.trim()
        ? a.name.slice(0, 200)
        : 'attachment';
    if (a.kind === 'text' && typeof a.text === 'string') {
      const text = a.text.slice(0, 20000);
      if (text.trim()) attachment = { kind: 'text', name, text };
    } else if (
      a.kind === 'image' &&
      typeof a.data === 'string' &&
      typeof a.mediaType === 'string' &&
      ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(
        a.mediaType,
      ) &&
      a.data.length <= 10_000_000 // ~7 MB decoded
    ) {
      attachment = {
        kind: 'image',
        name,
        mediaType: a.mediaType,
        data: a.data,
      };
    }
  }

  // Resolve portal scope before doing anything else. Public visitors
  // are always consumer; logged-in users have to pass the validation
  // for firm / hq before tools will serve them firm or hq data.
  const referer = req.headers.get('referer') ?? '';
  let portal: BellaPortal = 'consumer';
  let firmId: string | null = null;
  if (!isPublic) {
    const resolved = await resolvePortal(
      payload.portal,
      Boolean(payload.firmMode),
      referer,
    );
    if ('error' in resolved) {
      return NextResponse.json(
        { error: resolved.error },
        { status: resolved.status },
      );
    }
    portal = resolved.portal;
    firmId = resolved.firmId;
  }

  let caseContext: string | null = null;
  // Public-mode visitors don't get case context lookups - they can't have
  // any case attached to them. Likewise, HQ admin mode never reads case
  // bodies regardless of caseId.
  if (payload.caseId && !isPublic && portal !== 'hq') {
    try {
      const c = await getCase(payload.caseId);
      // Cross-portal spillage guard: a firm-portal session must NOT
      // attach a consumer-side case, and a consumer-portal session
      // must NOT attach a firm-side case. We check the case's
      // firm_id field on the way in - lib/storage.getCase returns
      // the case row but doesn't enforce scope itself.
      const cAny = c as unknown as { firm_id?: string | null } | null;
      const caseFirmId =
        cAny && typeof cAny.firm_id === 'string' ? cAny.firm_id : null;
      const inScope =
        (portal === 'firm' && caseFirmId === firmId) ||
        (portal === 'consumer' && caseFirmId === null);
      if (c && inScope) {
        const [exhibits, review] = await Promise.all([
          listExhibits(c.id),
          getLatestReview(c.id),
        ]);
        const lines: string[] = [];
        lines.push(`Case title: ${c.title}`);
        lines.push(`Subject (${c.subjectType}): ${c.subjectName}`);
        lines.push(`Case type: ${c.caseType}`);
        lines.push(
          `Jurisdiction: ${[c.jurisdiction.city, c.jurisdiction.state, c.jurisdiction.country].filter(Boolean).join(', ') || 'not specified'}`,
        );
        lines.push(`Posture: ${c.posture}`);
        if (c.description) lines.push(`Description: ${c.description.slice(0, 500)}`);
        if (exhibits.length) {
          lines.push(`Exhibits (${exhibits.length}):`);
          for (const e of exhibits.slice(0, 10)) {
            lines.push(`- ${e.label}: ${e.fileName}${e.description ? ' - ' + e.description : ''}`);
          }
        }
        if (review) {
          lines.push(`Latest review summary: ${review.summary.slice(0, 400)}`);
          lines.push(`Classification: ${review.classification.slice(0, 200)}`);
        }
        caseContext = lines.join('\n');
      }
    } catch {
      caseContext = null;
    }
  }

  // Firm-mode addendum: when the request is initiated from inside the
  // firm portal (validated above), give Bella jurisdiction + practice-
  // area context so issue-spotting is firm-relevant.
  let firmContext: {
    firmName: string;
    jurisdictions: string[];
    practiceAreas: string[];
    role: string;
  } | null = null;
  if (portal === 'firm') {
    try {
      const { getActiveFirmContext } = await import('@/lib/firm-storage');
      const ctx = await getActiveFirmContext();
      if (ctx) {
        firmContext = {
          firmName: ctx.firm.name,
          jurisdictions: ctx.firm.jurisdictions,
          practiceAreas: ctx.firm.practiceAreas,
          role: ctx.membership.role,
        };
      }
    } catch {
      firmContext = null;
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of streamBella({
          messages: sanitized,
          caseContext,
          isPublic,
          firmContext,
          portal,
          firmId,
          attachment,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        // Never surface the raw SDK/provider error to the user: it names
        // the underlying provider (violating Bella's hard rule) and shows
        // an un-actionable machine string (e.g. "rate_limit_error") in a
        // legal-distress context. Log the real error server-side; stream a
        // fixed, brand-safe line.
        console.error('[bella] stream error', err);
        controller.enqueue(
          encoder.encode(
            '\n\nBella is having trouble right now - please try again in a moment.',
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
