import { LABEL } from './type';

/** One entry of a review memo on a Sheet: a Courier label over a plain sentence. */
export function Memo({ label, text }: { label: string; text: string }) {
  return (
    <div className="border-t border-rule py-2.5 first:border-t-0">
      <p className={LABEL}>{label}</p>
      <p className="mt-0.5 font-public text-[14px] leading-snug">{text}</p>
    </div>
  );
}
