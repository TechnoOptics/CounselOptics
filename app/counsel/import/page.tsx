import { redirect } from 'next/navigation';
import { getActiveFirmContext } from '@/lib/firm-storage';
import { Tabs, type TabDef } from '@/components/Tabs';
import {
  CasesImporter,
  ClientsImporter,
  DocumentsImporter,
  EmployeesImporter,
  JsonDumpImporter,
} from '@/components/counsel/import/ImportPanels';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';

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
      id: 'employees',
      label: 'Employees CSV',
      content: <EmployeesImporter />,
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
      <PageHeader
        eyebrow={<T>Onboarding</T>}
        title={<T>Import data</T>}
        subtitle={
          <>
            <T>Bring your existing roster, matters, and documents into</T>{' '}
            {ctx.firm.name} <T>in one sitting. Pick a lane below; each one
            shows a preview before it commits. New clients and matters
            default to your paralegal so they can triage and pull in
            the right attorney.</T>
          </>
        }
      />
      <a
        href="/counsel/import/migrate"
        className="inline-flex items-center gap-1.5 rounded-lg bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 px-3.5 py-2 text-sm font-medium hover:brightness-110"
      >
        <T>Migrate everything from another platform →</T>
      </a>
      <Tabs swipe tabs={tabs} storageKey="counsel-import-tab" />
    </div>
  );
}
