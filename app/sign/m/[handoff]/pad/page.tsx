import { cookies } from 'next/headers';
import {
  HANDOFF_COOKIE,
  loadBoundHandoff,
  loadHandoffPadContext,
} from '@/lib/signing-handoff-queries';
import { handoffRefusalMessage } from '@/lib/signing-handoff';
import { AutoTranslate } from '@/components/i18n/AutoTranslate';
import { getLocaleCookie } from '@/lib/i18n/locale';
import { MobilePad } from '../mobile-pad';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Sign on your phone',
  robots: { index: false, follow: false },
};

/**
 * The phone pad.
 *
 * Reached only by the redirect from /sign/m/[handoff], which is where
 * the token was consumed and the cookie issued. This page never
 * consumes anything and never writes: it reads the row, asks
 * lib/signing-handoff.ts whether this device is the bound holder, and
 * either draws a pad or refuses.
 *
 * It shows the signer's name, the intent sentence and a canvas. It does
 * NOT show the document and does NOT repeat the electronic-records
 * disclosure, because both belong to the laptop, where the signer read
 * the record and consented before a code was ever offered.
 *
 * The refusal wording comes from handoffRefusalMessage and is
 * deliberately the same sentence for a used code, an expired code and a
 * different device. Someone who photographs a screen and scans it later
 * learns nothing from what this page says.
 */
export default async function MobileSignPadPage({
  params,
}: {
  params: { handoff: string };
}) {
  const locale = await getLocaleCookie();
  const cookie = cookies().get(HANDOFF_COOKIE)?.value ?? null;
  const bound = await loadBoundHandoff(params.handoff, cookie);

  if (!bound.ok) {
    return (
      <AutoTranslate initialLocale={locale}>
        <Shell>
          <p className="eyebrow mb-2 justify-center">Mobile signing</p>
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {handoffRefusalMessage(bound.state)}
          </h1>
          <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-3 leading-relaxed">
            You can close this page. Your computer still has the document
            open.
          </p>
        </Shell>
      </AutoTranslate>
    );
  }

  const context = await loadHandoffPadContext(bound.signatureId);
  if (!context) {
    return (
      <AutoTranslate initialLocale={locale}>
        <Shell>
          <p className="eyebrow mb-2 justify-center">Mobile signing</p>
          <h1 className="font-display text-2xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            {handoffRefusalMessage('consumed')}
          </h1>
        </Shell>
      </AutoTranslate>
    );
  }

  return (
    <AutoTranslate initialLocale={locale}>
      <MobilePad
        handoffToken={params.handoff}
        signerLabel={context.signerLabel}
        documentName={context.documentName}
      />
    </AutoTranslate>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-cream-50 dark:bg-forest-950 px-4">
      <div className="max-w-sm w-full card p-7 text-center">{children}</div>
    </div>
  );
}
