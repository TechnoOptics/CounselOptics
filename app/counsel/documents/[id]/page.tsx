import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  getFirmDocument,
  getFirmDocumentSignedUrl,
} from '@/lib/firm-storage';
import { CreateSigningRequestForm } from './signing-form';

export const dynamic = 'force-dynamic';

export default async function FirmDocumentDetail({ params }: { params: { id: string } }) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const doc = await getFirmDocument(params.id);
  if (!doc || doc.firmId !== ctx.firm.id) notFound();
  const signedUrl = await getFirmDocumentSignedUrl(doc.filePath, 60 * 60);

  const canRequestSig = ['owner', 'admin', 'attorney'].includes(ctx.membership.role);

  return (
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link href="/counsel/documents" className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100">
          &larr; Documents
        </Link>
      </p>
      <header>
        <p className="eyebrow mb-1">Document</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          {doc.name}
        </h1>
        <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
          v{doc.version} &middot; {doc.mimeType} &middot; uploaded{' '}
          {new Date(doc.uploadedAt).toLocaleString()}
        </p>
        {doc.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {doc.tags.map((t) => (
              <span
                key={t}
                className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/80 text-[10px]"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      {signedUrl && (
        <section className="card overflow-hidden">
          <iframe
            src={signedUrl}
            title={doc.name}
            className="w-full h-[70vh] border-0 bg-ink-50 dark:bg-forest-950"
          />
          <div className="p-3 flex items-center justify-end">
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary text-sm"
              download={doc.name}
            >
              Download
            </a>
          </div>
        </section>
      )}

      {canRequestSig && <CreateSigningRequestForm firmId={ctx.firm.id} documentId={doc.id} />}
    </div>
  );
}
