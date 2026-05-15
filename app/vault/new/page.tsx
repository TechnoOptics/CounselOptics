import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { ReceiptUploadForm } from './upload-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Add to vault',
  robots: { index: false, follow: false },
};

export default async function NewReceiptPage() {
  if (!isSupabaseConfigured()) redirect('/sign-in');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/vault/new');

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link
          href="/vault"
          className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100"
        >
          &larr; Vault
        </Link>
      </p>
      <header>
        <p className="eyebrow mb-1">New receipt</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Add to your vault
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-xl leading-relaxed">
          Anything you want to keep just in case - we&rsquo;ll tag and
          file it for you. No case is created. No notification is sent.
        </p>
      </header>
      <ReceiptUploadForm />
    </div>
  );
}
