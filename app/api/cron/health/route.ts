import { NextResponse, type NextRequest } from 'next/server';
import { createAdminSupabase, isServiceRoleConfigured } from '@/lib/supabase/admin';
import {
  recordHealthCheck,
  lastHealthEmailSentAt,
  markHealthEmailSent,
  type ProbeName,
  type ProbeStatus,
} from '@/lib/storage';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Hourly health check.
 *
 * Vercel Cron (configured in vercel.json) hits this endpoint with
 * `Authorization: Bearer <CRON_SECRET>`. We exercise the critical paths
 * (auth, database, email, stripe, bella) and record one row to
 * system_health. If any probe fails, we email contact@advottic.com
 * with the failures so the team can investigate.
 *
 * Important: this endpoint reports state, it does NOT auto-fix anything.
 * Auto-patching production from a cron is too risky for a legal app.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const auth = request.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) {
      return new NextResponse('Forbidden', { status: 403 });
    }
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
      // check. We do NOT send a real email every hour.
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

  // Email digest only when:
  //   1) at least one probe failed, AND
  //   2) we haven't sent a digest in the last 24 hours.
  // The cron records every hourly probe (so /admin/health stays
  // fresh), but the inbox only fires once per day max.
  if (failures.length > 0) {
    const lastEmailedAt = await lastHealthEmailSentAt();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (lastEmailedAt === null || Date.parse(lastEmailedAt) < oneDayAgo) {
      const to = process.env.HEALTH_DIGEST_TO?.trim() || 'contact@advottic.com';
      const lines = failures
        .map((f) => `- ${f.probe.toUpperCase()}: ${f.error}`)
        .join('<br />');
      const subject = `[Advottic] Health check: ${failures.length} probe${failures.length === 1 ? '' : 's'} failing`;
      const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;padding:16px;color:#0f2d24;">
<h2 style="margin:0 0 8px;font-size:16px;">Health check report</h2>
<p style="margin:0 0 12px;font-size:13px;color:#3f3f46;">Ran at ${new Date().toISOString()} - ${durationMs} ms.</p>
<p style="margin:0 0 12px;font-size:13px;"><strong>Failures:</strong><br />${lines}</p>
<p style="margin:0 0 12px;font-size:12px;color:#52525b;">Probes summary: ${JSON.stringify(probes)}</p>
<p style="margin:0;font-size:11px;color:#a1a1aa;">Auto-generated. Throttled to once per 24h - probes still run hourly. Open /admin/health for the full history.</p>
</body></html>`;
      const r = await sendEmail({ to, subject, html }).catch(() => null);
      if (r && r.ok && recordedRowId) {
        // Mark this row so the next 24-hour throttle window is anchored here.
        await markHealthEmailSent(recordedRowId).catch(() => {});
      }
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    probes,
    failures,
    durationMs,
    ranAt: new Date().toISOString(),
  });
}
