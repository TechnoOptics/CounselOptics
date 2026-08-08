import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { ContractUploadForm } from '@/app/contracts/new/upload-form';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New contract · Counsel' };

/**
 * Adding a contract, which is one form and not one of the four page
 * shapes in docs/PARITY-PAGE-RULES.md.
 *
 * It takes the detail page's breadcrumb, because that is how every
 * counsel page one level down says where it is, and nothing else: there
 * is no mono reference because the record does not exist yet, no meta
 * chip row because it has no state to report, no action bar because the
 * form carries its own submit, and no aside because there is no related
 * record until the upload lands.
 */
export default async function NewFirmContractPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  return (
    <div className="max-w-2xl space-y-6 animate-fade-up">
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-[12.5px]"
      >
        <Link
          href="/counsel/contracts"
          className="text-muted transition-colors hover:text-foreground"
        >
          <T>Contracts</T>
        </Link>
        <span aria-hidden className="text-muted">
          /
        </span>
        <span className="text-foreground">
          <T>New contract</T>
        </span>
      </nav>
      <PageHeader
        eyebrow={<T>Counsel · contracts</T>}
        title={<T>Add to the firm contract repository</T>}
        subtitle={
          <T>
            Stored in the firm vault, visible to firm members per your role
            permissions. Run Advottic Review on the next page for a structured
            read.
          </T>
        }
      />
      <ContractUploadForm firmId={ctx.firm.id} redirectAfter="/counsel/contracts" />
    </div>
  );
}
