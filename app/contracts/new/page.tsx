import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { ContractUploadForm } from './upload-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Add a contract - Advottic',
  robots: { index: false, follow: false },
};

export default async function NewContractPage() {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/contracts/new');

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/contracts"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          &larr; Contracts
        </Link>
      </p>
      <header>
        <p className="eyebrow mb-1">New contract</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Add a contract to your library
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
          Upload the file, pick a type, and (optionally) ask Bella for a
          review on the next step. The file stays private to you.
        </p>
      </header>
      <ContractUploadForm />
    </div>
  );
}
