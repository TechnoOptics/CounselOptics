import { adminAcknowledgeCrash, adminListCrashReports } from '@/lib/storage';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Crash reports - Advottic HQ' };

async function ackCrashAction(formData: FormData) {
  'use server';
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  await adminAcknowledgeCrash(id);
  revalidatePath('/admin/crashes');
  revalidatePath('/admin');
}

export default async function HqCrashesPage({
  searchParams,
}: {
  searchParams?: { include?: string };
}) {
  const includeAcknowledged = searchParams?.include === 'all';
  const crashes = await adminListCrashReports({ includeAcknowledged, limit: 200 });

  return (
    <div className="space-y-5 animate-fade-up">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Operations</p>
          <h2 className="font-display text-2xl text-cream-100 tracking-[-0.01em]">
            Crash reports
          </h2>
          <p className="text-[13px] text-cream-100/65 mt-1 max-w-2xl">
            Browser-side errors land here automatically through the
            CrashReporter component. Acknowledge once you've fixed or
            triaged so the count drops off the HQ landing.
          </p>
        </div>
        <nav className="flex items-center gap-1 text-[12px]">
          <a
            href="/admin/crashes"
            className={`px-2.5 py-1 rounded-md transition-colors ${
              !includeAcknowledged
                ? 'bg-white/10 text-cream-100 font-semibold'
                : 'text-cream-100/65 hover:bg-white/5'
            }`}
          >
            Open ({crashes.length === 0 ? 0 : crashes.filter((c) => !c.acknowledgedAt).length})
          </a>
          <a
            href="/admin/crashes?include=all"
            className={`px-2.5 py-1 rounded-md transition-colors ${
              includeAcknowledged
                ? 'bg-white/10 text-cream-100 font-semibold'
                : 'text-cream-100/65 hover:bg-white/5'
            }`}
          >
            All
          </a>
        </nav>
      </header>

      {crashes.length === 0 ? (
        <div className="card p-10 text-center text-sm text-cream-100/65">
          {includeAcknowledged
            ? 'No crash reports recorded.'
            : 'Nothing waiting. Browser-side errors land here when they happen.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {crashes.map((c) => (
            <li key={c.id} className="card p-4 space-y-2">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <p className="text-[13px] font-medium text-cream-100 break-words">
                  {c.message}
                </p>
                <p className="text-[11px] text-cream-100/55 font-mono tabular-nums">
                  {new Date(c.reportedAt).toLocaleString()}
                </p>
              </div>
              <div className="text-[11.5px] text-cream-100/55 space-x-3">
                {c.url && (
                  <span>
                    path: <code className="font-mono">{c.url}</code>
                  </span>
                )}
                {c.release && (
                  <span>
                    release: <code className="font-mono">{c.release}</code>
                  </span>
                )}
                {c.userId && (
                  <span>
                    user: <code className="font-mono">{c.userId.slice(0, 8)}</code>
                  </span>
                )}
                {c.acknowledgedAt && (
                  <span className="text-emerald-300">
                    acknowledged {new Date(c.acknowledgedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              {c.stack && (
                <details className="text-[11.5px] text-cream-100/65">
                  <summary className="cursor-pointer underline">Stack</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] bg-black/40 rounded p-3 overflow-x-auto">
                    {c.stack}
                  </pre>
                </details>
              )}
              {!c.acknowledgedAt && (
                <form action={ackCrashAction} className="pt-1">
                  <input type="hidden" name="id" value={c.id} />
                  <button
                    type="submit"
                    className="btn-secondary text-[12px] px-3 py-1.5"
                  >
                    Acknowledge
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
