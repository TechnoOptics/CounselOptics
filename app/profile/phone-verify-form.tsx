'use client';

import { useState, useTransition } from 'react';
import { startPhoneVerificationAction, confirmPhoneVerificationCodeAction } from '@/lib/phone-verify-actions';
// Shared with the counsel account page. A pure passthrough outside a
// LocaleProvider, so the consumer profile is unchanged.
import { T, useT } from '@/components/i18n/LocaleProvider';

/**
 * Account-level phone verification (OTP via Twilio Verify). Currently
 * used to gate Community Case organizer eligibility (Personal Plus+ /
 * Growing Firm+ AND verified email AND verified phone), but lives at the
 * account level rather than embedded in that one feature's creation flow
 * so any future feature that wants "confirmed real phone number" can
 * reuse the same verified_at timestamp instead of re-verifying.
 */
export function PhoneVerifyForm({
  verifiedPhone,
  verifiedAt,
  configured,
}: {
  verifiedPhone: string | null;
  verifiedAt: string | null;
  configured: boolean;
}) {
  const t = useT();
  const [step, setStep] = useState<'idle' | 'code-sent'>('idle');
  const [phone, setPhone] = useState(verifiedPhone ?? '');
  const [code, setCode] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justVerified, setJustVerified] = useState(false);

  if (!configured) {
    return (
      <div className="card p-5 sm:p-6">
        <p className="eyebrow mb-2">
          <T>Phone verification</T>
        </p>
        <p className="text-sm text-ink-500 dark:text-cream-100/55">
          <T>Phone verification isn&rsquo;t available yet on this deployment.</T>
        </p>
      </div>
    );
  }

  if (verifiedPhone && verifiedAt && !justVerified && step === 'idle') {
    return (
      <div className="card p-5 sm:p-6">
        <p className="eyebrow mb-2">
          <T>Phone verification</T>
        </p>
        {/* Left unwrapped on purpose: the number and the date are data, and
            the one English word between them cannot be split out without
            translating a sentence fragment. */}
        <p className="text-sm text-ink-700 dark:text-cream-100/80" data-no-translate>
          {verifiedPhone}, verified {new Date(verifiedAt).toLocaleDateString()}
        </p>
        <button type="button" className="btn-ghost text-sm mt-3" onClick={() => setStep('idle')}>
          <T>Verify a different number</T>
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5 sm:p-6 space-y-4">
      <p className="eyebrow">
        <T>Phone verification</T>
      </p>
      {justVerified ? (
        <p className="text-sm text-ink-700 dark:text-cream-100/80">
          <T>Verified. Thank you.</T>
        </p>
      ) : step === 'idle' ? (
        <>
          <div>
            <label className="label" htmlFor="verify-phone">
              <T>Phone number (international format)</T>
            </label>
            <input
              id="verify-phone"
              value={phone}
              onChange={(e) => setPhone(e.currentTarget.value)}
              placeholder="+14155551234"
              className="input"
            />
          </div>
          {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
          <button
            type="button"
            className="btn-primary"
            disabled={pending || !phone.trim()}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await startPhoneVerificationAction(phone);
                if (!result.ok) {
                  setError(result.error ?? t('Could not send a code.'));
                  return;
                }
                setStep('code-sent');
              })
            }
          >
            {pending ? <T>Sending&hellip;</T> : <T>Send code</T>}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-600 dark:text-cream-100/70">
            <T>Enter the code sent to</T>{' '}
            <span data-no-translate>{phone}</span>.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            placeholder="123456"
            maxLength={10}
            className="input"
          />
          {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={pending || !code.trim()}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await confirmPhoneVerificationCodeAction(phone, code);
                  if (!result.ok) {
                    setError(result.error ?? t('Could not verify that code.'));
                    return;
                  }
                  setJustVerified(true);
                })
              }
            >
              {pending ? <T>Checking&hellip;</T> : <T>Verify</T>}
            </button>
            <button type="button" className="btn-ghost text-sm" onClick={() => setStep('idle')}>
              <T>Back</T>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
