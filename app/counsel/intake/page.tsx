import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { readRequestFolders } from '@/lib/request-folders';
import { CreateIntakeForm } from './create-intake-form';
import { RequestFoldersManager } from './request-folders-manager';
import { PageHeader } from '@/components/counsel/ui';
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
      <PageHeader
        eyebrow={<T>Counsel · intake</T>}
        title={<T>New intake</T>}
        subtitle={
          <T>
            Open a new request for everything legal handles - outside-
            client matters, contracts, internal reviews, document
            safekeeping, trademark/IP, NDAs, compliance, and more. Pick
            a request type, capture the parties, and the conflict check
            runs across your prior matters and client list.
          </T>
        }
      >
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-2">
          <T>Looking for incoming requests?</T>{' '}
          <Link
            href="/counsel/inbox"
            className="underline text-forest-900 dark:text-cream-100 font-semibold"
          >
            <T>Open the Request inbox &rarr;</T>
          </Link>
        </p>
      </PageHeader>

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
