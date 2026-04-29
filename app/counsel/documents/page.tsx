import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getActiveFirmContext, listFirmDocuments } from '@/lib/firm-storage';
import { UploadDocumentForm } from './upload-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Documents · Counsel' };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function CounselDocumentsPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const documents = await listFirmDocuments(ctx.firm.id);

  const canUpload = ['owner', 'admin', 'attorney', 'paralegal'].includes(
    ctx.membership.role,
  );

  return (
    <div className="space-y-6 animate-fade-up">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Documents</p>
          <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Document vault
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
            Contracts, motions, exhibits, anything the firm needs to keep. Tag and link to
            a case or client. Send for in-app signature from the Signing tab.
          </p>
        </div>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
          {documents.length} document{documents.length === 1 ? '' : 's'}
        </p>
      </header>

      {canUpload && <UploadDocumentForm firmId={ctx.firm.id} />}

      {documents.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            No documents yet.
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            Upload contracts, court filings, or evidence packets above. Files up to 50 MB
            each.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((d) => (
            <li
              key={d.id}
              className="card p-4 hover:shadow-card-hover hover:-translate-y-0.5 transition-all"
            >
              <Link href={`/counsel/documents/${d.id}`} className="block">
                <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                  {d.name}
                </p>
                <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
                  v{d.version} &middot; {d.mimeType.split('/').pop() ?? 'file'} &middot;{' '}
                  {formatBytes(d.fileSize)}
                </p>
                {d.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.tags.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/80 text-[10px]"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-ink-400 dark:text-cream-100/45 mt-2 font-mono tabular-nums">
                  {new Date(d.uploadedAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
