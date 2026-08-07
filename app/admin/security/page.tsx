import { runAllPulseChecks } from '@/lib/security-pulse';
import { SecurityPulseShell } from './security-shell';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'Security pulse · Advottic HQ' } };

export default async function HqSecurityPage() {
  // Run once on the server so the first paint already shows live
  // data; the client shell takes over for the polling loop.
  const initial = await runAllPulseChecks();
  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Operations</p>
        <h2 className="font-display text-2xl text-gold-flow tracking-[-0.01em]">
          Security pulse
        </h2>
        <p className="text-[13px] text-cream-100/70 mt-1 max-w-3xl">
          Live readout of every security implementation. Every 30 seconds the
          dashboard re-runs the full battery: encryption envelope, OAuth
          credentials, RLS posture, e-signature chain integrity, document
          hash spot checks, failed-login volume, and subdomain reachability.
          Failed-login volume reports as unknown rather than healthy, because
          nothing writes the event it counts. No check currently offers a
          one-click remedy, so no &ldquo;Apply fix&rdquo; button will appear.
        </p>
      </header>
      <SecurityPulseShell initial={initial} />
    </div>
  );
}
