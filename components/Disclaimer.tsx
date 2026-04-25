export function Disclaimer({ variant = 'inline' }: { variant?: 'inline' | 'banner' }) {
  if (variant === 'banner') {
    return (
      <div className="border-b border-amber-200/70 bg-amber-50/80 text-amber-900 text-[11px] tracking-wide px-4 py-1.5 text-center">
        Advottic provides legal information and case organization - not legal advice. Consult a licensed attorney before taking action.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 text-sm text-amber-900">
      <p className="font-semibold mb-1 tracking-tight">Not legal advice</p>
      <p className="leading-relaxed">
        This analysis is for informational purposes only and does not constitute legal advice.
        Advottic is not a law firm and does not create an attorney-client relationship. You
        should consult a licensed attorney in your jurisdiction before taking legal action.
      </p>
    </div>
  );
}
