import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured, createServerSupabase } from '@/lib/supabase/server';
import { RECEIPT_CATEGORIES } from '@/lib/contract-types';
import { ShowMore } from '@/components/ShowMore';
import { FolderBar } from '@/components/FolderBar';
import { MoveToFolder } from '@/components/MoveToFolder';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Vault',
  description:
    'Keep receipts. Photos, screenshots, voicemails, emails - tagged + searchable, just in case.',
  robots: { index: false, follow: false },
};

const CATEGORY_TONE: Record<string, string> = {
  payment: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200',
  screenshot: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-200',
  photo: 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200',
  voicemail: 'bg-purple-50 dark:bg-purple-950/30 text-purple-800 dark:text-purple-200',
  email: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-200',
  identity: 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200',
  medical: 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200',
  tax: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200',
  work: 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200',
  physical: 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200',
  other: 'bg-ink-100 dark:bg-forest-800/50 text-ink-700 dark:text-cream-100/85',
};

function fmtBytes(n: number | null) {
  if (n === null || n === undefined) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function VaultPage({
  searchParams,
}: {
  searchParams: { folder?: string };
}) {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/vault');

  const supabase = createServerSupabase();
  const [{ data }, { data: folderData }] = await Promise.all([
    supabase
      .from('user_receipts')
      .select(
        'id, label, category, description, occurred_at, source, tags, file_size, mime_type, created_at, folder_id',
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('vault_folders')
      .select('id, name')
      .eq('user_id', user.id)
      .eq('kind', 'vault')
      .order('created_at', { ascending: true }),
  ]);
  const allReceipts = (data ?? []) as Array<{
    id: string;
    label: string;
    category: string;
    description: string | null;
    occurred_at: string | null;
    source: string | null;
    tags: string[];
    file_size: number | null;
    mime_type: string | null;
    created_at: string;
    folder_id: string | null;
  }>;
  const folders = (folderData ?? []) as Array<{ id: string; name: string }>;
  const folderList = folders.map((f) => ({
    ...f,
    count: allReceipts.filter((r) => r.folder_id === f.id).length,
  }));
  const activeFolderId =
    searchParams?.folder && folders.some((f) => f.id === searchParams.folder)
      ? searchParams.folder
      : null;
  const receipts = activeFolderId
    ? allReceipts.filter((r) => r.folder_id === activeFolderId)
    : allReceipts;

  const counts = allReceipts.reduce<Record<string, number>>((acc, r) => {
    acc[r.category] = (acc[r.category] ?? 0) + 1;
    return acc;
  }, {});
  const totalBytes = allReceipts.reduce((s, r) => s + (r.file_size ?? 0), 0);

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Vault</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Keep your receipts
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
            Photos, screenshots, voicemails, emails. Anything you want to
            keep just in case. Nothing here is automatically a case or a
            claim - it&rsquo;s just yours, tagged + searchable.
          </p>
        </div>
        <Link href="/vault/new" className="btn-primary text-sm">
          Add to vault
        </Link>
      </header>

      <FolderBar
        kind="vault"
        folders={folderList}
        activeFolderId={activeFolderId}
        basePath="/vault"
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="In vault" value={String(allReceipts.length)} />
        <Stat label="Used" value={fmtBytes(totalBytes)} />
        <Stat
          label="Categories"
          value={String(Object.keys(counts).length)}
        />
      </section>

      {allReceipts.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            Empty vault.
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            Drop in screenshots from a tense email thread, photos of damage
            after the move, the voicemail your landlord left you. Tag them
            so you can find them again. No legal action required.
          </p>
          <Link href="/vault/new" className="btn-primary mt-5 inline-flex">
            Add your first receipt
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          <ShowMore initial={3} noun="receipts">
          {receipts.map((r) => {
            const cat = RECEIPT_CATEGORIES.find((c) => c.id === r.category);
            const tone = CATEGORY_TONE[r.category] ?? CATEGORY_TONE.other;
            return (
              <li key={r.id} className="card p-4 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                      {r.label}
                    </p>
                    {r.description && (
                      <p className="text-[12.5px] text-ink-600 dark:text-cream-100/75 line-clamp-2 leading-snug mt-0.5">
                        {r.description}
                      </p>
                    )}
                    <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono mt-1">
                      {r.occurred_at
                        ? `Occurred ${new Date(r.occurred_at).toLocaleDateString()} · `
                        : ''}
                      added {new Date(r.created_at).toLocaleDateString()}
                      {r.file_size ? ` · ${fmtBytes(r.file_size)}` : ''}
                      {r.source ? ` · ${r.source}` : ''}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-[0.12em] ring-1 ${tone}`}
                  >
                    {cat?.label.replace(/\b\w+\b/, (w) => w) ?? r.category}
                  </span>
                </div>
                {r.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {r.tags.slice(0, 6).map((t) => (
                      <span
                        key={t}
                        className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/80 text-[10.5px]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {folders.length > 0 && (
                  <div className="pt-1">
                    <MoveToFolder
                      kind="vault"
                      itemId={r.id}
                      folders={folders}
                      currentFolderId={r.folder_id}
                    />
                  </div>
                )}
              </li>
            );
          })}
          </ShowMore>
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="card p-4">
      <p className="eyebrow text-[10.5px] mb-1.5">{label}</p>
      <p className="font-display text-2xl font-medium text-forest-900 dark:text-cream-100 tabular-nums">
        {value}
      </p>
    </div>
  );
}
