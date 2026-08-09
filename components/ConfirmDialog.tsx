'use client';

import { Dialog } from '@/components/Dialog';

/**
 * The one confirmation surface for a destructive action.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Eleven controls in app/ used the native `window.confirm()`. That dialog is
 * suppressed inside the Capacitor WebView, and a suppressed `confirm()`
 * returns false in some engines and true in others. Either way the person on a
 * phone never saw a question: the action ran unguarded, or the button did
 * nothing at all. The repo already recorded this in prose (see the webhook
 * manager and the token revoke button) without the remaining call sites being
 * converted. This component finishes that job.
 *
 * WHY DIALOG AND NOT THE INLINE TWO-STEP
 * --------------------------------------
 * Both patterns already exist here and neither is being replaced. The inline
 * two-step (webhook manager, DisconnectButton, RevokeTokenButton) turns one
 * control into two in place, which suits a row that owns its own width. The
 * eleven converted sites do not: several are icon buttons a few pixels wide
 * inside a table cell or a photo tile, where there is no room to grow a second
 * control without reflowing the row. Dialog portals to <body>, so it fits every
 * one of them unchanged, and it already carries the scroll lock, the ESC key,
 * the focus move and the visual-viewport tracking that a hand-rolled overlay
 * would have to re-earn.
 *
 * COPY
 * ----
 * `question` is the plain question. `detail` is what the person loses, stated
 * without alarm; this product is used under real legal pressure, so the copy
 * names the consequence and stops. Callers pass strings already translated
 * (t('...')), so nothing here reaches for the dictionary and no new
 * `<T>{expr}</T>` wrap is introduced.
 *
 * COLOUR
 * ------
 * Measured with lib/accent-text.ts contrastRatio against the three panel
 * colours Dialog can paint: `bg-white`, and its dark `bg-forest-900`, which is
 * #0F2D24 on the consumer surface and #101012 inside a counsel shell.
 *
 *   destructive fill  white on rose-700, fixed in both themes   6.29
 *   title             --foreground        17.88 / 13.44 / 17.29
 *   body              --muted              6.50 /  5.43 /  6.99
 *
 * The cancel button carries `dark:border-cream-50/40` (3.50 on the consumer
 * panel, 3.74 on the counsel one) because the shared `--border` hairline is
 * #232327, which measures 1.06 against the dark green panel: on the consumer
 * dark theme the button had no visible edge at all. The light hairline is left
 * at `border-edge`, the value every other dialog in this product uses.
 */
export function ConfirmDialog({
  question,
  detail,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  /** The question itself, e.g. "Delete 4 selected items?". */
  question: string;
  /** What is lost, in one calm sentence. Optional. */
  detail?: string;
  /** The destructive verb, e.g. "Delete". Never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /**
   * 'danger' for anything that destroys work. 'neutral' for the handful of
   * confirms that guard cost or duration rather than loss, so the red is not
   * spent on something that takes nothing away.
   */
  tone?: 'danger' | 'neutral';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmClass =
    tone === 'danger'
      ? 'bg-rose-700 text-white hover:bg-rose-800'
      : 'bg-forest-900 text-cream-50 hover:brightness-110 dark:bg-gold-metal dark:text-forest-950';
  return (
    <Dialog onClose={onCancel} ariaLabel={question} size="sm" elevated>
      <div className="p-5">
        <h2 className="text-[15px] font-semibold text-foreground">{question}</h2>
        {detail && (
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{detail}</p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg border border-edge dark:border-cream-50/40 px-4 py-2.5 text-[13px] font-semibold text-foreground hover:bg-surface-2 disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={`flex-1 rounded-lg px-4 py-2.5 text-[13px] font-semibold disabled:opacity-50 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
