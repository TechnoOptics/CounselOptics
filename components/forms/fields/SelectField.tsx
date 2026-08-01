import { FieldLabel, SURFACE_SCHEME, asText, type FieldProps } from './shared';

export function SelectField({
  question,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
}: FieldProps) {
  const options = question.config.options ?? [];
  const current = asText(value);

  return (
    <>
      <FieldLabel htmlFor={inputId} question={question} />
      <select
        id={inputId}
        value={current}
        onChange={(e) => onChange(e.target.value)}
        aria-required={question.required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`input ${SURFACE_SCHEME}`}
      >
        <option value="">Choose one</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </>
  );
}
