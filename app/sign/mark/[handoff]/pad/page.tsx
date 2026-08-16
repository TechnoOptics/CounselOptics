import { cookies } from 'next/headers';
import {
  MARK_HANDOFF_COOKIE,
  loadBoundMarkHandoff,
} from '@/lib/mark-handoff-queries';
import { markHandoffRefusal } from '@/lib/mark-handoff';
import { AutoTranslate } from '@/components/i18n/AutoTranslate';
import { getLocaleCookie } from '@/lib/i18n/locale';
import { MobilePad } from '@/app/sign/m/[handoff]/mobile-pad';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign on your phone',
  robots: { index: false, follow: false },
};

/**
 * The employee's phone pad.
 *
 * The SAME component the outside signer's phone uses, given a different place
 * to post to. Two pads that look alike is how two ceremonies drift apart, and
 * the mark this one produces has to be the mark that one produces.
 *
 * Reached only by the redirect from /sign/mark/[handoff], which is where the
 * token was consumed and the cookie issued. This page never consumes anything
 * and never writes: it reads the row, asks lib/mark-handoff.ts whether this
 * device is the bound holder, and either draws a pad or refuses.
 *
 * It shows two words and no more: whose signature this is and what the form is
 * called. It does not show the document, the employee's answers, or anything
 * that would let this device act as the employee elsewhere. The refusal
 * wording is deliberately the same sentence for a used code, an expired code
 * and a different device.
 */
export default async function MarkHandoffPadPage({
  params,
}: {
  params: { handoff: string };
}) {
  const locale = await getLocaleCookie();
  const cookie = cookies().get(MARK_HANDOFF_COOKIE)?.value ?? null;
  const bound = await loadBoundMarkHandoff(params.handoff, cookie);

  if (!bound.ok) {
    return (
      <AutoTranslate initialLocale={locale}>
        <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
          <div className="max-w-sm w-full card p-7 text-center">
            <p className="eyebrow mb-2 justify-center">Sign on your phone</p>
            <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
              {markHandoffRefusal(bound.state)}
            </h1>
            <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-3 leading-relaxed">
              You can close this page. Your computer still has the form open.
            </p>
          </div>
        </div>
      </AutoTranslate>
    );
  }

  return (
    <AutoTranslate initialLocale={locale}>
      <MobilePad
        handoffToken={params.handoff}
        signerLabel={bound.bound.signerLabel}
        documentName={bound.bound.documentName}
        firmName={bound.bound.firmName}
        firmLogoUrl={bound.bound.firmLogoUrl}
        submitPath="/api/firm/mark"
        doneMessage="Your signature is on your computer now. Go back to it to finish the form and send it."
      />
    </AutoTranslate>
  );
}
