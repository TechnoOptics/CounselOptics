'use client';

import { useState, useTransition } from 'react';
import { startPhoneVerificationAction, confirmPhoneVerificationCodeAction } from '@/lib/phone-verify-actions';

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
  const [step, setStep] = useState<'idle' | 'code-sent'>('idle');
  const [phone, setPhone] = useState(verifiedPhone ?? '');
  const [code, setCode] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justVerified, setJustVerified] = useState(false);

  if (!configured) {
    return (
      <div className="card p-5 sm:p-6">
        <p className="eyebrow mb-2">Phone verification</p>
        <p className="text-sm text-ink-500 dark:text-cream-100/55">
          Phone verification isn&rsquo;t available yet on this deployment.
        </p>
      </div>
    );
  }

  if (verifiedPhone && verifiedAt && !justVerified && step === 'idle') {
    return (
      <div className="card p-5 sm:p-6">
        <p className="eyebrow mb-2">Phone verification</p>
        <p className="text-sm text-ink-700 dark:text-cream-100/80">
          {verifiedPhone} — verified {new Date(verifiedAt).toLocaleDateString()}
        </p>
        <button type="button" className="btn-ghost text-sm mt-3" onClick={() => setStep('idle')}>
          Verify a different number
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5 sm:p-6 space-y-4">
      <p className="eyebrow">Phone verification</p>
      {justVerified ? (
        <p className="text-sm text-ink-700 dark:text-cream-100/80">Verified — thank you.</p>
      ) : step === 'idle' ? (
        <>
          <div>
            <label className="label" htmlFor="verify-phone">
              Phone number (international format)
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
                  setError(result.error ?? 'Could not send a code.');
                  return;
                }
                setStep('code-sent');
              })
            }
          >
            {pending ? 'Sending…' : 'Send code'}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-600 dark:text-cream-100/70">
            Enter the code sent to {phone}.
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
                    setError(result.error ?? 'Could not verify that code.');
                    return;
                  }
                  setJustVerified(true);
                })
              }
            >
              {pending ? 'Checking…' : 'Verify'}
            </button>
            <button type="button" className="btn-ghost text-sm" onClick={() => setStep('idle')}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
