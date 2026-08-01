import { FieldLabel, SURFACE_SCHEME, asText, type FieldProps } from './shared';

export function LongTextField({
  question,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
}: FieldProps) {
  // No `maxLength` on purpose. Silently refusing a keystroke leaves the
  // employee with no idea why, and lib/form-validate already reports the
  // limit in words the person can act on.
  return (
    <>
      <FieldLabel htmlFor={inputId} question={question} />
      <textarea
        id={inputId}
        rows={4}
        value={asText(value)}
        onChange={(e) => onChange(e.target.value)}
        aria-required={question.required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`input resize-y ${SURFACE_SCHEME}`}
      />
    </>
  );
}
