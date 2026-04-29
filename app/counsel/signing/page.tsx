import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getActiveFirmContext,
  listFirmSigningRequests,
} from '@/lib/firm-storage';
import { FIRM_SIGNING_STATUS_LABEL } from '@/lib/firm-types';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Signing · Counsel' };

export default async function CounselSigningPage() {
  const ctx = await getActiveFirmContext();
  if (!ctx) redirect('/counsel');
  const requests = await listFirmSigningRequests(ctx.firm.id);

  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-1">Signing</p>
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
          E-signature requests
        </h1>
        <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-1 max-w-2xl leading-relaxed">
          Review status of every signing request you&rsquo;ve sent. Open a document from{' '}
          <Link href="/counsel/documents" className="underline">
            Documents
          </Link>{' '}
          to send a new request.
        </p>
      </header>
      <section className="card p-5 sm:p-6 ring-1 ring-amber-300/40 dark:ring-amber-500/30 bg-amber-50/40 dark:bg-amber-950/15">
        <p className="text-sm text-amber-900 dark:text-amber-100 leading-relaxed">
          <strong>Preview mode.</strong> v1 signing produces a draft signed document with a
          visible &ldquo;DRAFT - NOT LEGALLY BINDING&rdquo; watermark. Use it for internal
          review and client approvals while we ship the full UETA / E-SIGN-Act-compliant
          audit trail.
        </p>
      </section>

      {requests.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-display text-2xl text-forest-900 dark:text-cream-100">
            No signing requests yet.
          </p>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 max-w-md mx-auto leading-relaxed">
            Open a document and use &ldquo;Send for signature&rdquo;.
          </p>
        </div>
      ) : (
        <ul className="card divide-y divide-ink-100 dark:divide-forest-700/40">
          {requests.map((req) => (
            <li key={req.id} className="p-4">
              <Link
                href={`/counsel/signing/${req.id}`}
                className="flex flex-wrap items-baseline justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-forest-900 dark:text-cream-100 truncate">
                    Request #{req.id.slice(0, 8)}
                  </p>
                  <p className="text-[12px] text-ink-500 dark:text-cream-100/55 mt-0.5">
                    Created {new Date(req.createdAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`badge text-[10px] tracking-wider ${
                    req.status === 'completed'
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100'
                      : req.status === 'sent' || req.status === 'partial'
                        ? 'bg-amber-50 text-amber-900 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-100'
                        : 'bg-ink-100 text-ink-600 dark:bg-forest-800/60 dark:text-cream-100/55'
                  }`}
                >
                  {FIRM_SIGNING_STATUS_LABEL[req.status].toUpperCase()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
