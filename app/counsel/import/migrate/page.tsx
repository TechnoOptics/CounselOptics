import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { MigrateClient } from '@/components/counsel/import/MigrateClient';
import { T } from '@/components/i18n/LocaleProvider';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Migrate from another platform',
  description:
    'Bring your matters, attachments, notes, and history into Advottic from CSV, a universal JSON bundle, or ServiceNow, with original dates preserved.',
};

export default async function MigratePage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  return (
    <section className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-6">
      <div>
        <Link
          href="/counsel/import"
          className="text-[13px] text-accent-text hover:underline"
        >
          <T>← Back to import</T>
        </Link>
        <h1 className="text-2xl sm:text-3xl text-foreground mt-2">
          <T>Migrate from another platform</T>
        </h1>
        <p className="text-sm text-muted mt-2 leading-relaxed max-w-2xl">
          <T>Move everything that matters (matters, attachments and images,
          notes, and the history behind them) with the original dates kept
          intact. Start with a universal bundle or connect ServiceNow; more
          connectors plug into the same pipeline.</T>
        </p>
      </div>
      <MigrateClient />
    </section>
  );
}
