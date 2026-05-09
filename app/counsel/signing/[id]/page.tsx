import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  getFirmDocument,
  getFirmDocumentSignedUrl,
  getFirmSigningRequestWithSignatures,
} from '@/lib/firm-storage';
import { FIRM_SIGNING_STATUS_LABEL } from '@/lib/firm-types';

export const dynamic = 'force-dynamic';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

export default async function SigningRequestDetail({
  params,
}: {
  params: { id: string };
}) {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const data = await getFirmSigningRequestWithSignatures(params.id);
  if (!data || data.request.firmId !== ctx.firm.id) notFound();
  const doc = await getFirmDocument(data.request.documentId);
  const signedUrl = doc ? await getFirmDocumentSignedUrl(doc.filePath) : null;

  return (
    <div className="space-y-6 animate-fade-up">
      <p className="text-sm">
        <Link href="/counsel/signing" className="text-ink-500 hover:text-forest-900 dark:hover:text-cream-100">
          &larr; Signing requests
        </Link>
      </p>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">Signing request</p>
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {doc?.name ?? 'Document'}
          </h1>
          <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-1 font-mono">
            Request #{data.request.id.slice(0, 8)} &middot; Sent{' '}
            {data.request.sentAt
              ? new Date(data.request.sentAt).toLocaleString()
              : 'not yet'}
          </p>
        </div>
        <span className="badge bg-ink-100 dark:bg-forest-800/60 text-ink-700 dark:text-cream-100/85 text-[10px] tracking-wider">
          {FIRM_SIGNING_STATUS_LABEL[data.request.status].toUpperCase()}
        </span>
      </header>

      {data.request.message && (
        <p className="card p-4 text-sm text-ink-700 dark:text-cream-100/80 italic leading-relaxed">
          &ldquo;{data.request.message}&rdquo;
        </p>
      )}

      <section className="card p-5 sm:p-6 space-y-3">
        <p className="eyebrow">Signers</p>
        <ul className="space-y-2">
          {data.signatures.map((sig) => (
            <li
              key={sig.id}
              className="flex flex-wrap items-baseline justify-between gap-3 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink-900 dark:text-cream-100 truncate">
                  {sig.signerName || sig.signerEmail}
                </p>
                <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
                  {sig.signerEmail}
                </p>
              </div>
              <div className="text-right">
                {sig.signedAt ? (
                  <span className="text-[12px] font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">
                    Signed {new Date(sig.signedAt).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-[12px] text-amber-700 dark:text-amber-300">
                    Awaiting signature
                  </span>
                )}
                {!sig.signedAt && (
                  <p className="mt-0.5">
                    <a
                      href={`${SITE_URL}/sign/${sig.token}`}
                      className="text-[11px] underline text-forest-900 dark:text-cream-100"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open sign link
                    </a>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {signedUrl && (
        <section className="card overflow-hidden">
          <p className="eyebrow px-5 pt-4 pb-2">Document preview</p>
          <iframe
            src={signedUrl}
            title={doc?.name ?? 'Document'}
            className="w-full h-[60vh] border-0 bg-ink-50 dark:bg-forest-950"
          />
        </section>
      )}
    </div>
  );
}
