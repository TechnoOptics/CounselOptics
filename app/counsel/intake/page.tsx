import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { readRequestFolders } from '@/lib/request-folders';
import { CreateIntakeForm } from './create-intake-form';
import { RequestFoldersManager } from './request-folders-manager';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';
import { firmCopy, firmVocabulary } from '@/lib/firm-vocabulary';

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
  // An in-house team opens requests, not intakes, and its conflict check runs
  // over an employee roster rather than a client list.
  const vocab = firmVocabulary(ctx.firm.firmType);
  const copy = firmCopy(ctx.firm.firmType);
  const canManage =
    ctx.membership.role === 'owner' || ctx.membership.role === 'admin';

  return (
    <div className="space-y-8 animate-fade-up">
      <PageHeader
        eyebrow={<T>{copy.intakeEyebrow}</T>}
        title={<T>{vocab.intake}</T>}
        subtitle={<T>{copy.intakeBlurb}</T>}
      >
        <p className="text-[12px] text-muted mt-2">
          <T>Looking for incoming requests?</T>{' '}
          <Link
            href="/counsel/inbox"
            className="underline text-foreground font-semibold"
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
