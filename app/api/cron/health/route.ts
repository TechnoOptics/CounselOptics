import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase, isServiceRoleConfigured } from '@/lib/supabase/admin';
import {
  recordHealthCheck,
  lastHealthEmailSentAt,
  markHealthEmailSent,
  adminListCrashReports,
  type ProbeName,
  type ProbeStatus,
} from '@/lib/storage';
import { sendEmail } from '@/lib/email';
import { healthDigestDecision, type HealthDigestDecision } from '@/lib/hq-metrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Daily health check.
 *
 * Vercel Cron (configured in vercel.json - currently 07:00 UTC daily)
 * hits this endpoint with `Authorization: Bearer <CRON_SECRET>`. We
 * exercise the critical paths (auth, database, email, stripe, bella)
 * and record one row to system_health. We also pull every
 * unacknowledged crash report so the daily email digest is the single
 * place to see "what went wrong yesterday" - failed probes plus client
 * crashes since the last digest.
 *
 * The /admin/health page also runs a LIVE probe at request time, so
 * fresh state is always available even between cron runs. The cron's
 * job is the historical record + the email digest.
 *
 * Important: this endpoint reports state, it does NOT auto-fix anything.
 * Auto-patching production from a cron is too risky for a legal app.
 * The agent-as-PR-author flow lives in a separate workflow with human
 * review before merge.
 */
export async function GET(request: NextRequest) {
  // Fail closed: if no secret is configured, refuse rather than run the
  // probes (which call Stripe/Resend/Bella) for anyone. An unset secret
  // must never leave this endpoint open.
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) {
    return new NextResponse('Server misconfigured: CRON_SECRET is not set', {
      status: 503,
    });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${cronSecret}`) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const startedAt = Date.now();
  const probes: Record<ProbeName, ProbeStatus> = {
    auth: 'skipped',
    database: 'skipped',
    email: 'skipped',
    stripe: 'skipped',
    bella: 'skipped',
  };
  const failures: { probe: ProbeName; error: string }[] = [];

  async function probe(name: ProbeName, fn: () => Promise<void>) {
    try {
      await fn();
      probes[name] = 'pass';
    } catch (err) {
      probes[name] = 'fail';
      failures.push({
        probe: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------- auth + database (single supabase client) ----------
  if (isServiceRoleConfigured()) {
    const admin = createAdminSupabase();
    if (admin) {
      await probe('auth', async () => {
        const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
        if (error) throw new Error(error.message);
      });
      await probe('database', async () => {
        const { error } = await admin
          .from('cases')
          .select('id', { count: 'exact', head: true });
        if (error) throw new Error(error.message);
      });
    }
  }

  // ---------- email (Resend) ----------
  if (process.env.RESEND_API_KEY?.trim()) {
    await probe('email', async () => {
      // Resend exposes /domains as a cheap "is the API key valid + service up"
      // check. We do NOT send a real email on every run.
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!.trim()}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Resend HTTP ${res.status}`);
    });
  }

  // ---------- stripe ----------
  if (process.env.STRIPE_SECRET_KEY?.trim()) {
    await probe('stripe', async () => {
      const res = await fetch('https://api.stripe.com/v1/products?limit=1', {
        headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY!.trim()}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Stripe HTTP ${res.status}`);
    });
  }

  // ---------- bella (Anthropic API ping) ----------
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    await probe('bella', async () => {
      // Smallest possible call: 1-token prompt with claude-haiku.
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!.trim(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
    });
  }

  const durationMs = Date.now() - startedAt;
  const recordedRowId = await recordHealthCheck({
    source: 'cron',
    probes,
    failures,
    durationMs,
  });

  // Pull unacknowledged crash reports for the digest. Capped at 25 so
  // a runaway crash storm cannot bloat the email past Resend's size
  // limit. The full list is always available at /admin/crashes.
  const unackedCrashes = await adminListCrashReports({
    includeAcknowledged: false,
    limit: 25,
  }).catch(() => []);

  // Email digest fires when EITHER probes failed OR there are
  // unacknowledged crashes, and the throttle is not already tripped. The
  // throttle window lives in lib/hq-metrics.ts and is deliberately shorter
  // than the daily cron period: a 24-hour window against a 24-hour cadence
  // silently dropped every other digest for months.
  const decision = healthDigestDecision({
    hasFailures: failures.length > 0,
    unacknowledgedCrashes: unackedCrashes.length,
    lastEmailSentAt: await lastHealthEmailSentAt(),
    now: Date.now(),
  });
  // Reported in the response so a silent run says which silence it was.
  let digest: HealthDigestDecision | 'sent' | 'send-failed' = decision;
  if (decision === 'send') {
    const to = process.env.HEALTH_DIGEST_TO?.trim() || 'contact@advottic.com';

    const subjectParts: string[] = [];
    if (failures.length > 0) {
      subjectParts.push(
        `${failures.length} probe${failures.length === 1 ? '' : 's'} failing`,
      );
    }
    if (unackedCrashes.length > 0) {
      subjectParts.push(
        `${unackedCrashes.length} crash${unackedCrashes.length === 1 ? '' : 'es'}`,
      );
    }
    const subject = `[Advottic] Daily health: ${subjectParts.join(' / ')}`;

    const failureBlock =
      failures.length > 0
        ? `<h3 style="margin:18px 0 6px;font-size:14px;color:#9f1239;">Failed probes (${failures.length})</h3>
<ul style="margin:0 0 8px;padding-left:18px;font-size:13px;color:#3f3f46;">
${failures
  .map(
    (f) =>
    `<li><strong style="font-family:ui-monospace,Menlo,Consolas,monospace;color:#9f1239;">${escapeHtml(f.probe)}</strong>: ${escapeHtml(f.error)}</li>`,
  )
  .join('\n')}
</ul>`
        : '';

    const crashBlock =
      unackedCrashes.length > 0
        ? `<h3 style="margin:18px 0 6px;font-size:14px;color:#9f1239;">Unacknowledged client crashes (${unackedCrashes.length})</h3>
<ul style="margin:0 0 8px;padding-left:18px;font-size:13px;color:#3f3f46;">
${unackedCrashes
  .map((c) => {
    const when = new Date(c.reportedAt).toLocaleString('en-US', {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short',
    });
    const path = c.url ? c.url.replace(/^https?:\/\/[^/]+/, '') : '';
    return `<li style="margin-bottom:6px;">
  <span style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#52525b;">${escapeHtml(when)} UTC${path ? ` &middot; ${escapeHtml(path)}` : ''}</span><br/>
  <span style="font-weight:600;color:#0f2d24;">${escapeHtml(c.message)}</span>
</li>`;
  })
  .join('\n')}
</ul>
<p style="margin:0 0 8px;font-size:12px;color:#52525b;">Open <a href="https://advottic.com/admin/crashes" style="color:#0f2d24;">/admin/crashes</a> to acknowledge or investigate.</p>`
        : '';

    const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;padding:16px;color:#0f2d24;">
<h2 style="margin:0 0 8px;font-size:16px;">Advottic - daily health digest</h2>
<p style="margin:0 0 12px;font-size:13px;color:#3f3f46;">Probe run at ${escapeHtml(new Date().toISOString())} - ${durationMs} ms.</p>
${failureBlock}
${crashBlock}
<p style="margin:18px 0 0;font-size:12px;color:#52525b;">Probes summary: <span style="font-family:ui-monospace,Menlo,Consolas,monospace;">${escapeHtml(JSON.stringify(probes))}</span></p>
<p style="margin:6px 0 0;font-size:11px;color:#a1a1aa;">Auto-generated daily. Open <a href="https://advottic.com/admin/health" style="color:#52525b;">/admin/health</a> for live status.</p>
</body></html>`;

    // sendEmail reports a failure as ok:false rather than throwing, and
    // the catch is only for a transport-level surprise. Neither may be
    // discarded: a digest that is never sent and never mentioned is the
    // same as no alerting at all.
    const r = await sendEmail({ to, subject, html }).catch((e) => ({
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    }));
    if (r.ok) {
      digest = 'sent';
      if (recordedRowId) await markHealthEmailSent(recordedRowId);
    } else {
      digest = 'send-failed';
      console.error(`[cron/health] digest email failed to send: ${r.error}`);
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    probes,
    failures,
    crashCount: unackedCrashes.length,
    digest,
    durationMs,
    ranAt: new Date().toISOString(),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
