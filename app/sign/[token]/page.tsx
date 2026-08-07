import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSignatureByToken } from '@/lib/firm-storage';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { appendSignatureEvent } from '@/lib/esign-audit';
import {
  INTERNAL_SIGNER_GATE_COPY,
  SIGNER_COPY_REFUSAL_COPY,
  maskSignerEmail,
  resolveInternalSignerGate,
  resolveSignerCopyAccess,
  signerWatermarkStamp,
} from '@/lib/signer-view';
import { SIGNER_NOT_YET_YOUR_TURN, resolveSignerTurn } from '@/lib/signer-order';
import { loadSignerOrder } from '@/lib/signature-write';
import { getRealCurrentUser } from '@/lib/supabase/server';
import {
  SIGNER_ALREADY_SIGNED_SENTENCE,
  SIGNER_COPY_RETENTION_DAYS,
  resolveSignerCopyRetention,
  signerRetentionSentence,
} from '@/lib/signer-retention';
import {
  loadCounterpartyIntake,
  loadStoredCounterpartyValues,
} from '@/lib/counterparty-intake';
import { TraceWatermark } from '@/components/TraceWatermark';
import { SignerSurface } from './signer-surface';
import { SignerResponse } from './signer-response';
import { AccessCodeGate } from './access-code-gate';
import { AutoTranslate } from '@/components/i18n/AutoTranslate';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { getLocaleCookie } from '@/lib/i18n/locale';
import { accentOn } from '@/lib/accent-text';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign document',
  description:
    'Review and sign a document inside Advottic. The link stays in the app, the document never leaves.',
  robots: { index: false, follow: false },
};

/**
 * Public sign page. No auth required - the token in the URL grants
 * access to exactly one signature row.
 *
 * The document itself is rendered at the top, above the ceremony. The
 * browser rasterises it from bytes served by
 * /api/firm/sign/document/[token] on this origin, which is what lets
 * the signer's mark be drawn onto the real signature line on the real
 * page as they make it. Until recently this page passed only the
 * document NAME to the capture component and the doc comment here
 * claimed otherwise, which meant the signer signed a record they had
 * never seen. E-SIGN at 15 USC 7001 and UETA both rest on the signer
 * having access to the record they are assenting to, so that gap
 * undercut a ceremony that is otherwise careful.
 *
 * No storage signature reaches the browser. The path is resolved here
 * from the token and the bytes are streamed by the route above, which
 * runs the same access decision this page does
 * (resolveSignerDocumentAccess), so the document and the page cannot
 * disagree about who may see it.
 *
 * The signature is captured client-side and posted back to
 * /api/firm/sign, which records ip, user agent, timestamp, and audit
 * hash.
 *
 * If the token is invalid, expired, or already signed, we render an
 * appropriate message. The `noindex` meta robots directive keeps
 * search engines from listing these per-token URLs.
 */
export default async function SignPage({ params }: { params: { token: string } }) {
  const data = await getSignatureByToken(params.token);
  if (!data) notFound();

  const { signature, request, document, firm } = data;
  const locale = await getLocaleCookie();

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
    // The terminal screen, and the one place in this product that has to
    // say out loud what happens to the link.
    //
    // The firm asked for it to be killed the moment it is used. It is
    // not, and this page must not pretend otherwise. E-SIGN at 15 USC
    // 7001(a)(1) and (d) condition the validity and the retention of an
    // electronic record on the person bound by it being able to keep it,
    // and this URL is that person's only route to the document. So the
    // true statement is about the ACT and not the address: the document
    // cannot be signed again, which is enforced on all three write paths
    // in lib/signature-write.ts, and the copy stays reachable for a
    // stated window, which is lib/signer-retention.ts.
    //
    // Nothing here says the link is dead, deleted, destroyed, revoked or
    // expired at the moment of signing, because it is none of those.
    //
    // Coming back to the link after signing is how a signer retrieves
    // their copy. The same two decisions the copy route enforces run
    // here, in the same order, so the page and the route can never
    // disagree about whether a download is offered: offering a button
    // the route would refuse is how a signer ends up on an error page
    // with no idea what to do next.
    const copy = resolveSignerCopyAccess({
      downloadPermitted: request.signerCanDownload,
      signedAt: signature.signedAt,
      requestStatus: request.status,
      accessCodeRequired: signature.accessCodeRequired,
      accessVerifiedAt: signature.accessVerifiedAt,
      signedFilePath: request.signedFilePath,
      sourceFilePath: document.signableFilePath || document.filePath || null,
    });
    const retention = resolveSignerCopyRetention({
      completedAt: request.completedAt,
      now: new Date(),
    });
    const offerCopy = copy.allowed && retention === 'available';
    // One paragraph, whichever branch. When a copy is on offer the
    // retention sentence states the window, and says the access code is
    // needed only when one was actually issued. When it is not, the
    // refusal that already exists follows the same opening sentence, so
    // the signer is never told about a window on a copy they cannot
    // reach anyway.
    const statement = copy.allowed
      ? signerRetentionSentence({
          completedAt: request.completedAt,
          accessCodeRequired: signature.accessCodeRequired,
          now: new Date(),
        })
      : `${SIGNER_ALREADY_SIGNED_SENTENCE} ${SIGNER_COPY_REFUSAL_COPY[copy.reason]}`;
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
        <div className="max-w-lg w-full card p-8 text-center">
          <p className="eyebrow mb-2 justify-center">Already signed</p>
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            This document was signed{' '}
            {new Date(signature.signedAt).toLocaleString()}.
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            {statement}
          </p>
          {offerCopy && (
            <>
              <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
                {copy.kind === 'executed'
                  ? 'The fully executed copy, with every signature on it, is ready for you.'
                  : 'Here is the document as you signed it. Once everyone has signed, this link gives you the fully executed copy instead.'}
              </p>
              <a
                href={`/api/firm/sign/copy/${signature.token}`}
                className="btn-primary mt-5 inline-flex"
              >
                Download your copy
              </a>
            </>
          )}
          <p className="mt-5">
            <Link href="/" className="btn-secondary inline-flex">
              Go to Advottic
            </Link>
          </p>
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

  // One-time access-code gate (#5). External signers receive a code in
  // a separate email; until it's entered, the document is not shown.
  // Internal signers have no code (accessCodeRequired is false), so
  // they fall straight through.
  if (signature.accessCodeRequired && !signature.accessVerifiedAt) {
    return (
      <AccessCodeGate
        token={signature.token}
        firmName={firm.name}
        documentName={document.name}
      />
    );
  }

  // The other half of "is this really them", for the signer who has no
  // access code to enter.
  //
  // An internal signer (a firm member or an employee) is issued no code
  // on purpose, so until this the durable link alone was enough to sign
  // as them. It is not any more: they have to be signed in, as
  // themselves. lib/signature-write.ts enforces the same decision on the
  // write, which is where it actually holds, because this page is not
  // what a leaked link posts to. This is here so the person who needs to
  // sign in reads a sentence instead of drawing their name and being
  // refused afterwards.
  //
  // The real session and not the "act as" overlay: an operator viewing
  // as an employee must not be able to sign as them.
  const sessionEmail = (await getRealCurrentUser())?.email ?? null;
  const internalGate = resolveInternalSignerGate({
    accessCodeRequired: signature.accessCodeRequired,
    signerEmail: signature.signerEmail,
    sessionEmail,
  });
  if (internalGate !== 'allow') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
        <div className="max-w-lg w-full card p-8 text-center">
          <p className="eyebrow mb-2 justify-center">Sign in to continue</p>
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {document.name}
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            {internalGate === 'sign-in-required'
              ? INTERNAL_SIGNER_GATE_COPY['sign-in-required']
              : INTERNAL_SIGNER_GATE_COPY['wrong-account'](
                  maskSignerEmail(signature.signerEmail),
                )}
          </p>
          <p className="mt-5">
            <Link href="/sign-in" className="btn-primary inline-flex">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // Whose turn it is.
  //
  // Read through the same loader the write uses, over the same rows, so
  // the page and the write cannot disagree about whether this signer may
  // act. An unreadable answer does NOT stop the page: the write is the
  // gate and it fails closed on its own, and refusing to render a
  // document because one query hiccuped would be the worse failure here.
  const admin = createAdminSupabase();
  if (admin) {
    const order = await loadSignerOrder(admin, request.id);
    if (order.kind !== 'unreadable') {
      const index = order.rows.findIndex((r) => r.id === signature.id);
      if (index >= 0 && resolveSignerTurn(order.rows, index) === 'waiting') {
        return (
          <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
            <div className="max-w-lg w-full card p-8 text-center">
              <p className="eyebrow mb-2 justify-center">Not yet</p>
              <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
                {document.name}
              </h1>
              <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
                {SIGNER_NOT_YET_YOUR_TURN}
              </p>
              <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
                Keep this link. It is the one you will use when your turn comes.
              </p>
            </div>
          </div>
        );
      }
    }
  }

  // The document the signer is about to sign is fetched by the client
  // from /api/firm/sign/document/[token], not linked from here. That
  // route resolves the same path this page would (signableFilePath
  // first, because that is the derived copy with the signature boxes
  // drawn on it and the version the final render stamps) and runs the
  // same access decision, so there is one answer to "may this token
  // see this document" and one place it is written down.
  //
  // Where the signature lands is decided in the browser too, because
  // it depends on the real page size, which is only known once the PDF
  // has been parsed. What this page hands over is the raw recorded
  // anchor: the same position_page / position_x / position_y that
  // lib/signature-render.ts stamps into.

  // Attribution for the one page in this app that had none.
  //
  // The trace watermark in the root layout is gated on a signed-in
  // user, and the counterparty signing a document is by definition not
  // signed in. So the surface most likely to be screenshotted, and the
  // only one showing a document belonging to someone else, carried no
  // identity at all. It does now, and it can: this row names the signer,
  // and on an external request the access code they entered above is
  // what let them reach this branch.
  //
  // Marking a confidential document with who holds it is ordinary
  // practice rather than an accusation, and the wording says so. It
  // also does not claim to stop anything: nothing on a web page can
  // prevent a screenshot, and the point of the mark is that an image
  // which does leave carries a name and a time.
  const watermark = signerWatermarkStamp({
    signerName: signature.signerName,
    signerEmail: signature.signerEmail,
    at: new Date(),
  });

  // The parts of this document that are the signer's to supply, and what they
  // have typed so far.
  //
  // Null for a signing request that came from a plainly uploaded file, for a
  // template whose fields are all the employee's, and for a firm whose
  // database has not had 20260807_flow_join.sql applied. All three render
  // this page exactly as it renders today, which is the point: the loader
  // answers a missing column with null rather than an error, so a firm that
  // has not migrated never has a signature blocked by it.
  const intakeAdmin = createAdminSupabase();
  const intake = intakeAdmin
    ? await loadCounterpartyIntake(intakeAdmin, request.id)
    : null;
  // Re-sanitized on the way out of jsonb rather than trusted, through the
  // same rules the write path applies, so a value that would no longer be
  // accepted is not shown back as though it had been.
  const storedFieldValues =
    intake && intakeAdmin
      ? await loadStoredCounterpartyValues(intakeAdmin, signature.id, intake.fields)
      : {};

  // Render in a custom shell so signers do NOT see the consumer-side
  // header / footer chrome. The page should feel like a focused
  // signing portal.
  return (
   <AutoTranslate initialLocale={locale}>
    <div
      className="min-h-screen bg-gradient-to-b from-cream-50 to-white dark:from-forest-950 dark:to-forest-900"
      style={{
        ['--firm-accent' as string]: firm.accentColor,
        ['--accent-on' as string]: accentOn(firm.accentColor),
      }}
    >
      <header className="border-b border-ink-200 dark:border-forest-700/40 bg-white/95 dark:bg-forest-950/95 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="h-9 w-9 rounded-md inline-flex items-center justify-center font-semibold shadow-sm"
              style={{
                backgroundColor: firm.accentColor,
                color: accentOn(firm.accentColor),
              }}
              aria-hidden
              data-no-translate
            >
              {firm.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55 leading-none">
                Sent by
              </p>
              <p
                className="text-sm font-semibold text-forest-900 dark:text-cream-100 truncate"
                data-no-translate
              >
                {firm.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher initialLocale={locale} />
            <p className="hidden sm:block text-[11px] text-ink-500 dark:text-cream-100/55 font-mono uppercase tracking-wider" data-no-translate>
              via Advottic
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <header>
          <p className="eyebrow mb-2">Signature requested</p>
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {document.name}
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
            Signing as{' '}
            <strong data-no-translate>
              {signature.signerName || signature.signerEmail}
            </strong>
            {/* "Single-use" was the wrong word and it was load-bearing:
                it described the URL, and the URL is not consumed. It
                keeps resolving after signing on purpose, because it is
                how the signer reaches the record they are bound by
                (15 USC 7001(a)(1)). What is single-use is the ACT. So
                the sentence now describes the act and states what
                happens to the link afterwards, which is the thing a
                signer actually needs to know before they decide whether
                to keep this email. */}
            . This link can be used to sign once. Afterwards it stays
            available to you for {SIGNER_COPY_RETENTION_DAYS} days so you can
            download your copy.
            {/* Only claimed when it is true. signerWatermarkStamp returns
                null when there is nobody to name, and a sentence saying
                the page is marked above a page that is not is the kind
                of comfortable untruth this surface cannot afford. */}
            {watermark
              ? ' This page is marked with your name and the time you opened it, as confidential documents usually are.'
              : ''}
          </p>
        </header>

        {request.message && (
          <p className="card p-4 italic text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
            &ldquo;{request.message}&rdquo;
          </p>
        )}

        {/* The document comes FIRST. The ceremony below it is unchanged:
            disclosure, then consent, then the pad. */}
        <SignerSurface
          token={signature.token}
          documentName={document.name}
          firmName={firm.name}
          signerEmail={signature.signerEmail}
          signerName={signature.signerName}
          positionPage={signature.positionPage}
          positionX={signature.positionX}
          positionY={signature.positionY}
          copyPermitted={request.signerCanDownload}
          copyHref={`/api/firm/sign/copy/${signature.token}`}
          counterpartyFields={intake?.fields ?? []}
          fieldBoxes={intake?.boxes ?? []}
          initialFieldValues={storedFieldValues}
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
            Techno Optics
          </Link>
          . The document and your signature stay in this app and are not shared with
          third parties.
        </div>
      </footer>

      {/* Last, and fixed to the viewport rather than to any section, so
          a screenshot of the document alone carries the mark as surely
          as one of the whole page. The 'document' tone exists because
          the shell tone blends away to nothing against the white page
          the rasteriser paints, which is exactly where it is needed. */}
      <TraceWatermark stamp={watermark} tone="document" />
    </div>
   </AutoTranslate>
  );
}
