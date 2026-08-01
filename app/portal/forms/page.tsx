import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getWorkspacePersona } from '@/lib/persona';
import { listPortalTemplatesAction } from '@/lib/firm-templates';
import { PageHeader, EmptyState } from '@/components/counsel/ui';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Forms · Hub' };

/**
 * Employee Forms: the templates the legal team published (NDA, vendor form,
 * …). Pick one, fill the fields, sign, and export. No ticket needed.
 */
export default async function PortalFormsPage() {
  const persona = await getWorkspacePersona();
  if (persona.kind !== 'employee') redirect('/portal');

  const res = await listPortalTemplatesAction(persona.firm.id);
  const templates = res.templates ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forms"
        subtitle={
          <>
            Documents your legal team has prepared for self-service. Fill one in,
            sign it, and download it, no request needed. If your situation
            doesn&apos;t fit a form,{' '}
            <Link href="/portal/new" className="text-gold-700 underline dark:text-gold-300">
              file a request
            </Link>{' '}
            instead.
          </>
        }
      />

      {templates.length === 0 ? (
        <EmptyState
          title="No forms yet"
          sub={
            <>
              Your legal team hasn&apos;t published any form templates. Ask them,
              or file a request for what you need.
            </>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <Link
              key={t.id}
              href={`/portal/forms/${t.id}`}
              className="group flex flex-col rounded-xl border border-ink-200 bg-white p-4 transition-all hover:border-gold-500/60 hover:shadow-md dark:border-forest-700/50 dark:bg-forest-900/40 dark:hover:bg-forest-800/50"
            >
              {t.category && (
                <span className="mb-2 self-start rounded-full bg-gold-500/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-gold-700 ring-1 ring-gold-500/25 dark:text-gold-300">
                  {t.category}
                </span>
              )}
              <span className="text-[15px] font-semibold text-forest-900 dark:text-cream-100">{t.name}</span>
              {t.description && (
                <span className="mt-1 line-clamp-2 text-[12.5px] text-ink-500 dark:text-cream-100/55">
                  {t.description}
                </span>
              )}
              <span className="mt-3 text-[12px] font-medium text-gold-700 group-hover:underline dark:text-gold-300">
                Fill &amp; sign →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
