'use client';

import type { DetectedBlank } from '@/lib/template-blank-detection';
import type { DeliveryMode } from '@/lib/submission-dispatch';
import { T } from '@/components/i18n/LocaleProvider';
import { INPUT_CLS, blankIdentity } from './template-editor-model';

/**
 * HOW THIS LEAVES THE COMPANY: whether it is sent to be signed or only
 * read, where the document already asks somebody to sign, and whether the
 * legal team sees it before it goes.
 *
 * The three sit together because they are one decision made in three
 * places. A body full of signature rules that is set to go out as a
 * read-only link is the mistake this section exists to make visible, and it
 * cannot be seen at all when the delivery control and the signature rules
 * are on separate screens.
 */
export function SignatureTab({
  busy,
  deliveryMode,
  setDeliveryMode,
  modeFlipped,
  signaturePlaces,
  signatureEvidence,
  onRemoveRule,
  onDismiss,
  requiresApproval,
  setRequiresApproval,
}: {
  busy: boolean;
  deliveryMode: DeliveryMode;
  setDeliveryMode: (m: DeliveryMode) => void;
  /** True when this edit changes the mode a saved template was filed under. */
  modeFlipped: boolean;
  signaturePlaces: DetectedBlank[];
  signatureEvidence: string | null;
  onRemoveRule: (b: DetectedBlank) => void;
  onDismiss: (b: DetectedBlank) => void;
  requiresApproval: boolean;
  setRequiresApproval: (v: boolean) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="block sm:max-w-sm">
        <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
          <T>How this goes out</T>
        </span>
        <select
          className={INPUT_CLS}
          value={deliveryMode}
          onChange={(e) => setDeliveryMode(e.target.value === 'signature' ? 'signature' : 'share')}
        >
          <option value="share">Secure link, read only</option>
          <option value="signature">For signature</option>
        </select>
        <span className="mt-1 block text-[12px] text-ink-500 dark:text-cream-100/55">
          <T>
            For signature sends the recipient a link and a code, and asks them to sign.
            A secure link only lets them read it.
          </T>
        </span>
        {/* Stated at the flip, because the change does not reach work
            already in flight and nothing else on this page would say so.
            Deliberately not a count: reading one would put a query on the
            editor's render path, and the sentence is true whether the
            queue holds one document or none. */}
        {modeFlipped && (
          <span className="mt-1 block text-[12px] text-amber-700 dark:text-amber-300">
            <T>
              Documents already waiting for approval under this template keep the way
              they were set up when they were filed. This change applies to the ones
              your colleagues fill in from now on.
            </T>
          </span>
        )}
      </label>

      {(signaturePlaces.length > 0 || signatureEvidence) && (
        <div className="rounded-lg border border-edge p-3.5">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted">
            <T>Places somebody signs</T>
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            <T>
              These do not become fields. The signature and date lines are
              added for you when the document goes out, so a rule left here
              would be a second place to sign that nothing stamps and
              nothing records.
            </T>
          </p>
          {signaturePlaces.length > 0 && (
            <ul className="mt-1.5 space-y-1.5">
              {signaturePlaces.map((b) => (
                <li key={blankIdentity(b)} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <code
                    className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground dark:bg-forest-800"
                    data-no-translate
                  >
                    {b.context}
                  </code>
                  <span className="ml-auto flex items-center gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRemoveRule(b)}
                      className="text-[12.5px] font-medium text-accent-text hover:underline disabled:opacity-50"
                    >
                      <T>Remove this rule</T>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDismiss(b)}
                      className="text-[12.5px] text-muted hover:text-danger-text"
                    >
                      <T>Leave it</T>
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* ONLY when there is nothing on the page to point at. "IN WITNESS
              WHEREOF" and "[Signature Page Follows]" are both signed
              documents carrying no rule at all, and this is the sentence for
              them. Shown alongside a list of rules it just quotes one of the
              rules back, which the list above has already said better. */}
          {signatureEvidence && signaturePlaces.length === 0 && (
            <p className="mt-1.5 text-[12px] text-muted">
              <T>This body carries</T>{' '}
              <span data-no-translate>{signatureEvidence}</span>.
            </p>
          )}
          {deliveryMode !== 'signature' && (
            <p className="mt-1.5 text-[12.5px]">
              <span className="text-amber-700 dark:text-amber-300">
                <T>
                  This template is set to go out as a secure read-only link,
                  so nobody will be asked to sign it.
                </T>
              </span>{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeliveryMode('signature')}
                className="font-medium text-accent-text hover:underline disabled:opacity-50"
              >
                <T>Set it to go out for signature</T>
              </button>
            </p>
          )}
        </div>
      )}

      <label className="flex items-start gap-2 rounded-lg border border-ink-200 bg-cream-50/60 p-3 dark:border-forest-700/50 dark:bg-forest-900/60">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={requiresApproval}
          onChange={(e) => setRequiresApproval(e.target.checked)}
        />
        <span className="text-[13px] text-ink-700 dark:text-cream-100/80">
          <span className="block font-medium text-forest-900 dark:text-cream-100">
            <T>Review this before it leaves the company</T>
          </span>
          <T>
            The employee fills it in and names the recipient, and it comes to the legal
            team first. It is sent only after an owner, admin, or attorney approves it.
            Turn this off only for documents employees may send on their own.
          </T>
        </span>
      </label>
    </div>
  );
}
