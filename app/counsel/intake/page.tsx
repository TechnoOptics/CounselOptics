import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { readRequestFolders } from '@/lib/request-folders';
import { CreateIntakeForm } from './create-intake-form';
import { RequestFoldersManager } from './request-folders-manager';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New intake · Counsel' };

/**
 * Counsel intake: the page for *creating* a new request. The triage
 * inbox where incoming requests land lives separately at
 * /counsel/inbox so creation and triage don't crowd each other.
 */
export default async function CounselIntakePage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const folders = readRequestFolders(ctx.firm.metadata);
  const canManage =
    ctx.membership.role === 'owner' || ctx.membership.role === 'admin';

  return (
    <div className="space-y-8 animate-fade-up">
      <header>
        <p className="eyebrow mb-1"><T>Counsel · intake</T></p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          <T>New intake</T>
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          <T>
            Open a new request for everything legal handles - outside-
            client matters, contracts, internal reviews, document
            safekeeping, trademark/IP, NDAs, compliance, and more. Pick
            a request type, capture the parties, and the conflict check
            runs across your prior matters and client list.
          </T>
        </p>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-2">
          <T>Looking for incoming requests?</T>{' '}
          <Link
            href="/counsel/inbox"
            className="underline text-forest-900 dark:text-cream-100 font-semibold"
          >
            <T>Open the Request inbox &rarr;</T>
          </Link>
        </p>
      </header>

      <CreateIntakeForm
        firmId={ctx.firm.id}
        defaultSubmittedBy={
          ctx.membership.displayName ?? ctx.membership.email ?? ''
        }
      />

      {canManage && (
        <RequestFoldersManager firmId={ctx.firm.id} initial={folders} />
      )}
    </div>
  );
}
