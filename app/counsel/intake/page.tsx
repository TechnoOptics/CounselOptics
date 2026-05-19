import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  readRequestFolders,
  readIntakeFolder,
} from '@/lib/request-folders';
import { CreateIntakeForm } from './create-intake-form';
import { RequestFoldersManager } from './request-folders-manager';

export const dynamic = 'force-dynamic';
// Title intentionally omits the · Advottic suffix - the root layout's
// metadata.title.template ('%s · Advottic') adds it automatically.
// Audit W20 V3 CR-27: this page (along with /trust and /time) was
// double-suffixing, producing "Advottic · Advottic" in the browser tab.
export const metadata = { title: 'Intake · Counsel' };

const STATUS_TONE: Record<string, string> = {
  in_progress:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
  conflict_check_passed:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  conflict_check_flagged:
    'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-rose-200 dark:ring-rose-700/40',
  engaged:
    'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40',
  rejected:
    'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85 ring-ink-200 dark:ring-forest-700/40',
};

export default async function CounselIntakePage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const supabase = createServerSupabase();
  const { data: intakesRaw } = await supabase
    .from('firm_matter_intakes')
    .select(
      'id, client_name, matter_type, jurisdiction_state, status, created_at, intake_answers',
    )
    .eq('firm_id', ctx.firm.id)
    .order('created_at', { ascending: false })
    .limit(100);
  const intakes = (intakesRaw ?? []) as Array<{
    id: string;
    client_name: string;
    matter_type: string | null;
    jurisdiction_state: string | null;
    status: string;
    created_at: string;
    intake_answers: Record<string, unknown> | null;
  }>;

  const folders = readRequestFolders(ctx.firm.metadata);
  const canManage =
    ctx.membership.role === 'owner' || ctx.membership.role === 'admin';

  // Group by folder; folders in their defined order, then anything
  // unfiled or pointing at a deleted folder under "Unfiled".
  const folderKeys = new Set(folders.map((f) => f.key));
  const groups: Array<{
    key: string;
    name: string;
    items: typeof intakes;
  }> = [];
  for (const f of folders) {
    const items = intakes.filter(
      (i) => readIntakeFolder(i.intake_answers) === f.key,
    );
    if (items.length > 0) groups.push({ key: f.key, name: f.name, items });
  }
  const unfiled = intakes.filter((i) => {
    const k = readIntakeFolder(i.intake_answers);
    return !k || !folderKeys.has(k);
  });
  if (unfiled.length > 0) {
    groups.push({
      key: '',
      name: folders.length > 0 ? 'Unfiled' : 'All requests',
      items: unfiled,
    });
  }

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Counsel · intake</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Intake
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          One entry point for everything legal handles: outside-client
          matters, contracts, internal reviews, document safekeeping,
          trademark/IP, NDAs, compliance, and more. Pick a request type,
          capture the parties, and the conflict check runs across your
          prior matters and client list.
        </p>
      </header>

      <CreateIntakeForm
        firmId={ctx.firm.id}
        defaultSubmittedBy={ctx.membership.displayName ?? ctx.membership.email ?? ''}
      />

      {canManage && (
        <RequestFoldersManager firmId={ctx.firm.id} initial={folders} />
      )}

      <section className="space-y-5">
        <h2 className="font-display text-lg font-medium text-forest-900 dark:text-cream-100">
          Requests
        </h2>
        {intakes.length === 0 ? (
          <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
            No requests yet.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.key || 'unfiled'} className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-ink-400 dark:text-cream-100/45">
                {g.name}{' '}
                <span className="text-ink-300 dark:text-cream-100/30">
                  ({g.items.length})
                </span>
              </p>
              <ul className="space-y-2">
                {g.items.map((i) => {
                  const tone =
                    STATUS_TONE[i.status] ?? STATUS_TONE.in_progress;
                  const ans = (i.intake_answers ?? {}) as Record<
                    string,
                    unknown
                  >;
                  const isEmployeeReq =
                    String(ans.submitted_by ?? '').trim().length > 0;
                  const threadCount = Array.isArray(ans.thread)
                    ? (ans.thread as unknown[]).length
                    : 0;
                  return (
                    <li
                      key={i.id}
                      className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
                    >
                      <Link
                        href={`/counsel/intake/${i.id}`}
                        className="block"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold text-forest-900 dark:text-cream-100 truncate flex items-center gap-2">
                            <span className="truncate">
                              {i.client_name}
                            </span>
                            {isEmployeeReq && (
                              <span className="shrink-0 inline-flex items-center rounded-full bg-gold-500/15 ring-1 ring-gold-500/30 px-2 py-[1px] text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-700 dark:text-gold-200">
                                In-house
                              </span>
                            )}
                          </p>
                          <span
                            className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
                          >
                            {i.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <p className="text-[12px] text-ink-600 dark:text-cream-100/70 mt-1">
                          {i.matter_type ?? 'Matter type not set'}
                          {i.jurisdiction_state &&
                            ` · ${i.jurisdiction_state}`}
                          {' · '}
                          {new Date(i.created_at).toLocaleDateString()}
                          {threadCount > 0 &&
                            ` · ${threadCount} message${threadCount === 1 ? '' : 's'}`}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
