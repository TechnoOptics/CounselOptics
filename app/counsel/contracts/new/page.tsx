import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { ContractUploadForm } from '@/app/contracts/new/upload-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New contract · Counsel · Advottic' };

export default async function NewFirmContractPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  return (
    <div className="max-w-2xl space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/counsel/contracts"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          &larr; Contracts
        </Link>
      </p>
      <header>
        <p className="eyebrow mb-1">New contract</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Add to firm contract repository
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
          Stored in the firm vault, visible to firm members per your role
          permissions. Use Bella review on the next page for a structured
          read.
        </p>
      </header>
      <ContractUploadForm firmId={ctx.firm.id} redirectAfter="/counsel/contracts" />
    </div>
  );
}
