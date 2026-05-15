import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getCurrentSubscription } from '@/lib/storage';
import { listConsumerInboxDocuments } from '@/lib/firm-storage';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Documents · Inbox',
  description:
    'Documents that law firms have sent you to review and sign, plus a record of what you have already executed.',
  robots: { index: false, follow: false },
};

/**
 * Consumer-side documents inbox. Lists every signing request a
 * Counsel firm has sent to the signed-in user's email - pending,
 * partial, completed, canceled.
 *
 * Pro feature: only Pro / comp accounts can use the inbox view to
 * batch-receive documents from multiple firms. Free accounts can
 * still receive documents one-off via direct sign-link emails, but
 * they don't get the aggregated inbox.
 */
export default async function ConsumerInboxDocumentsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-3">
        <h1 className="font-display text-2xl">Documents inbox</h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70">
          Supabase is not configured.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/inbox/documents');

  const subscription = await getCurrentSubscription();
  const isPro =
    subscription?.status === 'active' || subscription?.status === 'trialing';

  if (!isPro) {
    return (
      <div className="max-w-2xl mx-auto card p-8 space-y-4">
        <p className="eyebrow mb-1">Pro feature</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em]">
          Receive documents from your law firm in one place
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/75 leading-relaxed">
          With Advottic Pro, every law firm using Advottic Counsel can send
          documents directly into your secure inbox here. Review, sign, and
          send back without printing or scanning. Each document carries a
          tamper-evident audit trail you can hand back to anyone who asks.
        </p>
        <ul className="text-[13px] space-y-2 text-ink-700 dark:text-cream-100/80 leading-relaxed">
          <li>- One inbox for every firm you work with</li>
          <li>- Two-step electronic-records disclosure on every signature</li>
          <li>- Auto-saved record of what you signed, when, and from where</li>
          <li>- Notifications when something needs your action</li>
        </ul>
        <div className="flex gap-3 pt-2">
          <Link href="/billing" className="btn-primary">
            Upgrade to Pro
          </Link>
          <Link href="/cases" className="btn-secondary">
            Back to cases
          </Link>
        </div>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 pt-3 border-t border-ink-100 dark:border-forest-800/40">
          Already received a document via email link? You can still sign it
          using that one-off link without upgrading.
        </p>
      </div>
    );
  }

  const docs = await listConsumerInboxDocuments(user.email ?? '');

  const pending = docs.filter((d) => !d.signedAt);
  const completed = docs.filter((d) => d.signedAt);

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Inbox / documents</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Documents from law firms
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Documents firms have sent you to review and sign. Click any item
            to open the secure signing flow. Already-signed items are kept
            here as your record.
          </p>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
          {pending.length} awaiting · {completed.length} signed
        </p>
      </header>

      <Section title="Awaiting your signature" empty="Nothing awaiting you right now.">
        <ul className="space-y-2">
          {pending.map((d) => (
            <DocCard key={d.signatureId} doc={d} />
          ))}
        </ul>
      </Section>

      <Section title="Signed" empty="No signed documents yet.">
        <ul className="space-y-2">
          {completed.map((d) => (
            <DocCard key={d.signatureId} doc={d} done />
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
        {title}
      </h2>
      {Array.isArray(children) ||
      (children as React.ReactElement<{ children: unknown[] }>)?.props?.children
        ?.length ? (
        children
      ) : (
        <p className="card p-5 text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          {empty}
        </p>
      )}
    </section>
  );
}

function DocCard({
  doc,
  done,
}: {
  doc: Awaited<ReturnType<typeof listConsumerInboxDocuments>>[number];
  done?: boolean;
}) {
  const href = done ? '#' : `/sign/${doc.token}`;
  return (
    <li className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
      <Link href={href} className="flex items-center gap-4">
        <span
          className="h-10 w-10 shrink-0 rounded-md inline-flex items-center justify-center text-white font-semibold shadow-sm"
          style={{ backgroundColor: doc.firmAccentColor }}
          aria-hidden
        >
          {doc.firmName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
            {doc.documentName}
          </p>
          <p className="text-[12px] text-ink-600 dark:text-cream-100/70 truncate">
            From <strong>{doc.firmName}</strong>
            {doc.requestSentAt && (
              <span className="text-ink-400 dark:text-cream-100/45">
                {' · '}
                {new Date(doc.requestSentAt).toLocaleDateString()}
              </span>
            )}
          </p>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-1 rounded text-[10.5px] font-semibold uppercase tracking-[0.12em] ring-1 ${
            done
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-emerald-200 dark:ring-emerald-700/40'
              : 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 ring-amber-200 dark:ring-amber-700/40'
          }`}
        >
          {done
            ? `Signed ${doc.signedAt ? new Date(doc.signedAt).toLocaleDateString() : ''}`
            : 'Sign'}
        </span>
      </Link>
    </li>
  );
}
