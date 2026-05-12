import {
  adminAcknowledgeCrash,
  adminAcknowledgeCrashIds,
  adminListCrashReports,
} from '@/lib/storage';
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

async function ackCrashGroupAction(formData: FormData) {
  'use server';
  const raw = String(formData.get('ids') ?? '');
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return;
  await adminAcknowledgeCrashIds(ids);
  revalidatePath('/admin/crashes');
  revalidatePath('/admin');
}

/**
 * Group crashes by signature (message + first stack frame). The audit
 * 2026-05-12 P2 flagged that 21 release builds emitting the same
 * React #419 stack created 21 separate "Acknowledge" rows, burying
 * the signal. Grouping shows the operator one card per distinct
 * crash family with count + first/last seen + affected paths +
 * affected releases + bulk-acknowledge.
 *
 * Signature deliberately uses only `message` and the first stack
 * frame so minor differences in line numbers between builds collapse
 * into the same family. If the first stack frame is missing we fall
 * back to the message alone.
 */
type CrashRow = Awaited<ReturnType<typeof adminListCrashReports>>[number];

type CrashGroup = {
  signature: string;
  message: string;
  count: number;
  openCount: number;
  firstSeen: string;
  lastSeen: string;
  paths: string[];
  releases: string[];
  users: number;
  sampleStack: string | null;
  openIds: string[];
};

function groupCrashes(rows: CrashRow[]): CrashGroup[] {
  const map = new Map<string, CrashGroup>();
  for (const r of rows) {
    const firstFrame = r.stack
      ? (r.stack.split('\n').find((l) => l.trim().length > 0) ?? '').trim()
      : '';
    const signature = `${r.message}::${firstFrame}`;
    let g = map.get(signature);
    if (!g) {
      g = {
        signature,
        message: r.message,
        count: 0,
        openCount: 0,
        firstSeen: r.reportedAt,
        lastSeen: r.reportedAt,
        paths: [],
        releases: [],
        users: 0,
        sampleStack: r.stack,
        openIds: [],
      };
      map.set(signature, g);
    }
    g.count += 1;
    if (!r.acknowledgedAt) {
      g.openCount += 1;
      g.openIds.push(r.id);
    }
    if (r.reportedAt < g.firstSeen) g.firstSeen = r.reportedAt;
    if (r.reportedAt > g.lastSeen) g.lastSeen = r.reportedAt;
    if (r.url && !g.paths.includes(r.url) && g.paths.length < 8) g.paths.push(r.url);
    if (r.release && !g.releases.includes(r.release) && g.releases.length < 10) {
      g.releases.push(r.release);
    }
  }
  // Distinct user count needs a second pass.
  const userSets = new Map<string, Set<string>>();
  for (const r of rows) {
    const firstFrame = r.stack
      ? (r.stack.split('\n').find((l) => l.trim().length > 0) ?? '').trim()
      : '';
    const sig = `${r.message}::${firstFrame}`;
    if (!r.userId) continue;
    let s = userSets.get(sig);
    if (!s) {
      s = new Set();
      userSets.set(sig, s);
    }
    s.add(r.userId);
  }
  const groups = [...map.values()].map((g) => ({
    ...g,
    users: userSets.get(g.signature)?.size ?? 0,
  }));
  // Sort by openCount desc (loudest open groups first), then by lastSeen desc.
  groups.sort((a, b) => {
    if (b.openCount !== a.openCount) return b.openCount - a.openCount;
    return b.lastSeen.localeCompare(a.lastSeen);
  });
  return groups;
}

export default async function HqCrashesPage({
  searchParams,
}: {
  searchParams?: { include?: string; view?: string };
}) {
  const includeAcknowledged = searchParams?.include === 'all';
  const isGrouped = (searchParams?.view ?? 'grouped') !== 'list';
  // Bump limit when grouping so signatures with many copies don't get
  // truncated. The page only renders a card per group, so it's fine.
  const crashes = await adminListCrashReports({
    includeAcknowledged,
    limit: isGrouped ? 500 : 200,
  });
  const groups = isGrouped ? groupCrashes(crashes) : [];
  const openCount = crashes.filter((c) => !c.acknowledgedAt).length;

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
            CrashReporter component. Grouped view collapses identical
            stacks across builds so 21 copies of the same React #419
            read as one row, not twenty-one.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12px]">
          <nav className="flex items-center gap-1">
            <a
              href={`/admin/crashes?view=grouped${includeAcknowledged ? '&include=all' : ''}`}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                isGrouped
                  ? 'bg-white/10 text-cream-100 font-semibold'
                  : 'text-cream-100/65 hover:bg-white/5'
              }`}
              title="Group identical stacks across release builds"
            >
              Grouped
            </a>
            <a
              href={`/admin/crashes?view=list${includeAcknowledged ? '&include=all' : ''}`}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                !isGrouped
                  ? 'bg-white/10 text-cream-100 font-semibold'
                  : 'text-cream-100/65 hover:bg-white/5'
              }`}
            >
              Flat list
            </a>
          </nav>
          <span className="text-cream-100/30">·</span>
          <nav className="flex items-center gap-1">
            <a
              href={`/admin/crashes${isGrouped ? '?view=grouped' : '?view=list'}`}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                !includeAcknowledged
                  ? 'bg-white/10 text-cream-100 font-semibold'
                  : 'text-cream-100/65 hover:bg-white/5'
              }`}
            >
              Open ({openCount})
            </a>
            <a
              href={`/admin/crashes?include=all${isGrouped ? '&view=grouped' : '&view=list'}`}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                includeAcknowledged
                  ? 'bg-white/10 text-cream-100 font-semibold'
                  : 'text-cream-100/65 hover:bg-white/5'
              }`}
            >
              All
            </a>
          </nav>
        </div>
      </header>

      {crashes.length === 0 ? (
        <div className="card p-10 text-center text-sm text-cream-100/65">
          {includeAcknowledged
            ? 'No crash reports recorded.'
            : 'Nothing waiting. Browser-side errors land here when they happen.'}
        </div>
      ) : isGrouped ? (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.signature} className="card p-4 space-y-2">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <p className="text-[13px] font-medium text-cream-100 break-words">
                  {g.message}
                </p>
                <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums">
                  <span
                    className={`px-2 py-0.5 rounded-md ring-1 ${
                      g.openCount > 0
                        ? 'bg-rose-950/40 text-rose-200 ring-rose-700/40'
                        : 'bg-emerald-950/40 text-emerald-200 ring-emerald-700/40'
                    }`}
                  >
                    {g.openCount > 0 ? `${g.openCount} open` : 'all ack'}
                  </span>
                  <span className="text-cream-100/55">
                    {g.count} event{g.count === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <div className="text-[11.5px] text-cream-100/55 flex flex-wrap gap-x-3 gap-y-1">
                <span>
                  first seen:{' '}
                  <span className="font-mono">
                    {new Date(g.firstSeen).toLocaleString()}
                  </span>
                </span>
                <span>
                  last seen:{' '}
                  <span className="font-mono">
                    {new Date(g.lastSeen).toLocaleString()}
                  </span>
                </span>
                {g.users > 0 && (
                  <span>
                    users affected: <span className="font-mono">{g.users}</span>
                  </span>
                )}
                {g.releases.length > 0 && (
                  <span>
                    releases: <span className="font-mono">{g.releases.length}</span>
                  </span>
                )}
              </div>
              {g.paths.length > 0 && (
                <div className="text-[11.5px] text-cream-100/55 flex flex-wrap gap-1">
                  <span className="text-cream-100/40 mr-1">paths:</span>
                  {g.paths.map((p) => (
                    <code
                      key={p}
                      className="font-mono bg-black/30 px-1.5 py-0.5 rounded"
                    >
                      {p}
                    </code>
                  ))}
                </div>
              )}
              {g.sampleStack && (
                <details className="text-[11.5px] text-cream-100/65">
                  <summary className="cursor-pointer underline">
                    Sample stack
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] bg-black/40 rounded p-3 overflow-x-auto">
                    {g.sampleStack}
                  </pre>
                </details>
              )}
              {g.openCount > 0 && (
                <form action={ackCrashGroupAction} className="pt-1">
                  <input type="hidden" name="ids" value={g.openIds.join(',')} />
                  <button
                    type="submit"
                    className="btn-secondary text-[12px] px-3 py-1.5"
                    title={`Acknowledge all ${g.openCount} open events in this group`}
                  >
                    Acknowledge group ({g.openCount})
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
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
