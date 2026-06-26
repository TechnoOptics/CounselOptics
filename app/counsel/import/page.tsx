import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { Tabs, type TabDef } from '@/components/Tabs';
import {
  CasesImporter,
  ClientsImporter,
  DocumentsImporter,
  JsonDumpImporter,
} from '@/components/counsel/import/ImportPanels';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Import data · Counsel' };

/**
 * /counsel/import - onboarding + data migration surface.
 *
 * Four lanes a firm can use to bring their existing data into
 * Advottic on day one:
 *   1. Clients CSV - upload + column mapper -> firm_clients
 *   2. Cases CSV - same shape, drops case shells
 *   3. Bulk documents - drag a folder of files into the vault
 *   4. JSON dump - structured envelope for advanced migrations
 *
 * All four use the same admin-client path and respect the firm's
 * paralegal-first default-attorney convention (the paralegal owns
 * incoming work until they triage it to the right lawyer).
 */
export default async function CounselImportPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');

  const tabs: TabDef[] = [
    {
      id: 'clients',
      label: 'Clients CSV',
      content: <ClientsImporter />,
    },
    {
      id: 'cases',
      label: 'Cases CSV',
      content: <CasesImporter />,
    },
    {
      id: 'documents',
      label: 'Bulk documents',
      content: <DocumentsImporter />,
    },
    {
      id: 'json',
      label: 'JSON dump',
      content: <JsonDumpImporter />,
    },
  ];

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Onboarding</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          Import data
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Bring your existing roster, matters, and documents into{' '}
          {ctx.firm.name} in one sitting. Pick a lane below; each one
          shows a preview before it commits. New clients and matters
          default to your paralegal so they can triage and pull in
          the right attorney.
        </p>
      </header>
      <Tabs swipe tabs={tabs} storageKey="counsel-import-tab" />
    </div>
  );
}
