import { FieldLabel, SURFACE_SCHEME, asText, type FieldProps } from './shared';

export function CurrencyField({
  question,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
}: FieldProps) {
  const code = (question.config.currency ?? 'USD').toUpperCase();
  const codeId = `${inputId}-currency`;

  // A text input, not `type="number"`: lib/form-validate parses the amount to
  // exact cents from a string and accepts the separators people actually type.
  // The currency code is referenced from the input rather than hidden, so a
  // screen reader hears which currency the amount is in.
  return (
    <>
      <FieldLabel htmlFor={inputId} question={question} />
      <div className="relative">
        <span
          id={codeId}
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[12px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/60"
        >
          {code}
        </span>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={asText(value)}
          onChange={(e) => onChange(e.target.value)}
          aria-required={question.required || undefined}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy ? `${codeId} ${describedBy}` : codeId}
          className={`input pl-14 ${SURFACE_SCHEME}`}
        />
      </div>
    </>
  );
}
