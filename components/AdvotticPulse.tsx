import Image from 'next/image';

/**
 * Inline Advottic mark with the gold pulse + halo, for acknowledging a click
 * the instant an action goes pending - drop it into a button (replacing or
 * beside its label) or any "working…" affordance so the user never wonders
 * whether their tap registered. Shares the loading-overlay's pulse language,
 * sized down via the `.pulse-mark` compact variant.
 *
 * Example:
 *   <button disabled={pending}>
 *     {pending ? <><AdvotticPulse size={16} /> Saving…</> : 'Save'}
 *   </button>
 */
export function AdvotticPulse({
  size = 18,
  label,
  className = '',
}: {
  size?: number;
  /** Optional text shown beside the mark (already-translated). */
  label?: string;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <span className="pulse-mark">
        <Image
          src="/advottic-mark.png"
          alt=""
          width={size}
          height={size}
          priority
          className="select-none"
        />
      </span>
      {label && (
        <span className="text-[13px] font-medium text-current">{label}</span>
      )}
      <span className="sr-only">Working…</span>
    </span>
  );
}
