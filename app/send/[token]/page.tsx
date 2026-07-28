import Image from 'next/image';
import { getUploadRequestAction } from '@/lib/intake-upload-public';
import { SendForm } from './send-form';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Send a document',
  // Never index a tokenized page.
  robots: { index: false, follow: false },
};

const REASONS: Record<string, { title: string; body: string }> = {
  invalid: {
    title: 'This link is not valid',
    body: 'Double-check the link you were sent, or ask the legal team for a new one.',
  },
  expired: {
    title: 'This link has expired',
    body: 'Links stay live for a limited time. Ask the legal team to send a fresh one and you can upload straight away.',
  },
  revoked: {
    title: 'This link has been turned off',
    body: 'The legal team closed this request. If you still need to send something, get in touch with them directly.',
  },
  complete: {
    title: 'Everything has been received',
    body: 'This request already has all the files it needed. Nothing more to do.',
  },
};

export default async function SendPage({ params }: { params: { token: string } }) {
  const res = await getUploadRequestAction(params.token);

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-lg flex-col justify-center px-4 py-12">
      {res.ok ? (
        <>
          <header className="mb-6 text-center">
            {res.logoUrl ? (
              <Image
                src={res.logoUrl}
                alt={res.firmName}
                width={160}
                height={44}
                className="mx-auto mb-4 h-11 w-auto object-contain"
                unoptimized
              />
            ) : (
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-700 dark:text-gold-300">
                {res.firmName}
              </p>
            )}
            <h1 className="font-display text-2xl font-medium text-forest-900 dark:text-cream-100">
              {res.label}
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-600 dark:text-cream-100/70">
              {res.note
                ? res.note
                : `The legal team at ${res.firmName} asked for this. Send it here and it goes straight onto their file.`}
            </p>
          </header>
          <SendForm token={params.token} remaining={res.remaining} />
        </>
      ) : (
        <div className="rounded-2xl border border-ink-200 bg-white p-8 text-center dark:border-forest-700/50 dark:bg-forest-900/40">
          <h1 className="font-display text-xl font-medium text-forest-900 dark:text-cream-100">
            {REASONS[res.reason].title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-600 dark:text-cream-100/70">
            {REASONS[res.reason].body}
          </p>
        </div>
      )}
    </main>
  );
}
