'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { T } from '@/components/i18n/LocaleProvider';
import { PanelCard } from '@/components/counsel/patterns';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { setCaseFileOpenAction } from '@/lib/case-file-actions';
import type { CaseModeSource } from '@/lib/case-mode';

/**
 * The switch between the two matter modes, and the sentence that says which
 * one this matter is in and why.
 *
 * It lives in the aside on BOTH modes, deliberately. A control that only
 * appears in the mode it can leave is a control nobody finds: the whole point
 * of closing a case file is that it can be reopened, and somebody looking at
 * a simple matter that has turned into a court case needs to see the way in.
 *
 * A PanelCard rather than a shape of its own, because the DETAIL pattern's
 * aside is a column of PanelCards and this is not special enough to be a fifth
 * container language on a page that already had four.
 */
export function CaseFilePanel({
  firmId,
  caseId,
  open,
  source,
  storable,
  canManage,
}: {
  firmId: string;
  caseId: string;
  open: boolean;
  /** Which answer decided it, so the panel can explain rather than assert. */
  source: CaseModeSource;
  /**
   * Whether cases.litigation_mode exists in this database yet.
   *
   * When it does not, NO CONTROL IS OFFERED. An offer that cannot be honoured
   * is worse than no offer: this product has already shipped a phone-signing
   * card that rendered because an absent column parsed as "unrestricted", and
   * then failed at the point of use against a table that was not there. An
   * absent column is a reason to withhold an offer, never to make one.
   */
  storable: boolean;
  /** owner / admin / attorney. Everyone else reads the state and no button. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(next: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setCaseFileOpenAction(firmId, caseId, next);
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      } else {
        setError(res.error ?? null);
        setConfirming(false);
      }
    });
  }

  return (
    <PanelCard title={<T>Case file</T>} bodyClassName="p-3 space-y-3">
      <p className="text-[13px] leading-relaxed text-muted">
        {!open ? (
          <T>
            This matter is being handled as a request. The timeline, evidence
            and case analysis stay closed until the firm opens the case file.
          </T>
        ) : source === 'hearing' ? (
          <T>
            The case file is open because a hearing is recorded on this matter.
          </T>
        ) : (
          <T>
            The case file is open. The timeline, evidence and case analysis are
            in the case menu at the top of this page.
          </T>
        )}
      </p>

      {!storable ? (
        <p className="text-[12px] leading-relaxed text-muted">
          <T>
            Opening and closing case files needs a pending database update. An
            owner can apply it.
          </T>
        </p>
      ) : canManage ? (
        <>
          <button
            type="button"
            onClick={() => (open ? setConfirming(true) : submit(true))}
            disabled={pending}
            className="inline-flex min-h-[40px] items-center rounded-md border border-edge px-3 text-[12px] text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {open ? <T>Handle as a request</T> : <T>Build the case</T>}
          </button>
          {!open && (
            <p className="text-[12px] leading-relaxed text-muted">
              <T>
                Anything already on this matter comes back with it. Nothing was
                deleted.
              </T>
            </p>
          )}
        </>
      ) : (
        <p className="text-[12px] leading-relaxed text-muted">
          <T>An owner, admin or attorney can change this.</T>
        </p>
      )}

      {error && (
        <p className="text-[12px] leading-relaxed text-danger-text" data-no-translate>
          {error}
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          question="Handle this matter as a request?"
          /*
           * Neutral, not danger. ConfirmDialog reserves the red for what
           * destroys work, and this destroys none: the rows and the files stay
           * exactly where they are and the same three roles can reverse it
           * from this card.
           */
          tone="neutral"
          detail="The timeline, evidence and case analysis stop being shown. None of them is deleted, and opening the case file again brings all of it back."
          confirmLabel="Handle as a request"
          busy={pending}
          onConfirm={() => submit(false)}
          onCancel={() => setConfirming(false)}
        />
      )}
    </PanelCard>
  );
}
