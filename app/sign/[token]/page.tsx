import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSignatureByToken } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { appendSignatureEvent } from '@/lib/esign-audit';
import { SignatureCapture } from './signature-capture';
import { SignerResponse } from './signer-response';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign document',
  description:
    'Review and sign a document inside Advottic. The link stays in the app, the document never leaves.',
  robots: { index: false, follow: false },
};

/**
 * Public sign page. No auth required - the token in the URL grants
 * access to exactly one signature row. The document is rendered via
 * the admin-issued signed URL and the signature is captured client-
 * side, posted back to /api/firm/sign which records ip, user agent,
 * timestamp, and audit hash.
 *
 * If the token is invalid, expired, or already signed, we render an
 * appropriate message. The `noindex` meta robots directive keeps
 * search engines from listing these per-token URLs.
 */
export default async function SignPage({ params }: { params: { token: string } }) {
  const data = await getSignatureByToken(params.token);
  if (!data) notFound();

  const { signature, request, document, firm } = data;

  // Audit trail: record that the signer opened the link. Best-effort
  // and skipped once the signature is already executed (so a
  // post-completion bookmark click doesn't pollute the chain). Hits
  // the service role client because this page is unauthenticated.
  if (!signature.signedAt && request.status !== 'canceled') {
    try {
      const admin = createAdminSupabase();
      if (admin) {
        const h = headers();
        const ip =
          h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          h.get('x-real-ip') ||
          null;
        const userAgent = h.get('user-agent') ?? null;
        await appendSignatureEvent(admin, {
          signingRequestId: request.id,
          signatureId: signature.id,
          eventType: 'link_viewed',
          signerEmail: signature.signerEmail,
          ipAddress: ip,
          userAgent,
          documentSha256:
            (request as { documentSha256?: string | null }).documentSha256 ?? null,
        });
      }
    } catch {
      /* never block the sign page on audit logging */
    }
  }

  if (signature.signedAt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
        <div className="max-w-lg w-full card p-8 text-center">
          <p className="eyebrow mb-2 justify-center">Already signed</p>
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            This document was signed{' '}
            {new Date(signature.signedAt).toLocaleString()}.
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            If you need a copy, ask the firm for the executed version.
          </p>
          <Link href="/" className="btn-secondary mt-5 inline-flex">
            Go to Advottic
          </Link>
        </div>
      </div>
    );
  }
  if (request.status === 'canceled') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
        <div className="max-w-lg w-full card p-8 text-center">
          <p className="eyebrow mb-2 justify-center">Request recalled</p>
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            This signing request was recalled.
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            The document is no longer available to sign. Reach out to {firm.name} if
            you think this is a mistake.
          </p>
        </div>
      </div>
    );
  }
  // The signer already declined or asked for changes on this link, or
  // someone did on the shared request - put the page on hold until the
  // firm sends a fresh version.
  if (
    signature.response ||
    request.status === 'rejected' ||
    request.status === 'changes_requested'
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
        <div className="max-w-lg w-full card p-8 text-center">
          <p className="eyebrow mb-2 justify-center">On hold</p>
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {signature.response === 'rejected'
              ? 'You declined to sign this document.'
              : 'This document is on hold pending changes.'}
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            {firm.name} has been notified. If a revised version is sent, you&rsquo;ll
            get a new link.
          </p>
        </div>
      </div>
    );
  }

  // Render in a custom shell so signers do NOT see the consumer-side
  // header / footer chrome. The page should feel like a focused
  // signing portal.
  return (
    <div
      className="min-h-screen bg-gradient-to-b from-cream-50 to-white dark:from-forest-950 dark:to-forest-900"
      style={{ ['--firm-accent' as string]: firm.accentColor }}
    >
      <header className="border-b border-ink-200 dark:border-forest-700/40 bg-white/95 dark:bg-forest-950/95 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="h-9 w-9 rounded-md inline-flex items-center justify-center text-white font-semibold shadow-sm"
              style={{ backgroundColor: firm.accentColor }}
              aria-hidden
            >
              {firm.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55 leading-none">
                Sent by
              </p>
              <p className="text-sm font-semibold text-forest-900 dark:text-cream-100 truncate">
                {firm.name}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider">
            via Advottic
          </p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <header>
          <p className="eyebrow mb-2">Signature requested</p>
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {document.name}
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            Signing as <strong>{signature.signerName || signature.signerEmail}</strong>.
            Your sign link is single-use.
          </p>
        </header>

        {request.message && (
          <p className="card p-4 italic text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
            &ldquo;{request.message}&rdquo;
          </p>
        )}

        <SignatureCapture
          token={signature.token}
          signerEmail={signature.signerEmail}
          signerName={signature.signerName}
          documentName={document.name}
          firmName={firm.name}
        />

        <SignerResponse token={signature.token} firmName={firm.name} />
      </main>

      <footer className="border-t border-ink-200 dark:border-forest-700/40 bg-white dark:bg-forest-950 mt-12">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 text-[11px] text-ink-500 dark:text-cream-100/55 text-center">
          Powered by{' '}
          <Link
            href="/about"
            className="underline hover:text-forest-900 dark:hover:text-cream-100"
          >
            Advottic
          </Link>
          . The document and your signature stay in this app and are not shared with
          third parties.
        </div>
      </footer>
    </div>
  );
}
