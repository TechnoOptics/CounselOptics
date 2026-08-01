import { FieldGroup, OptionControl, asText, type FieldProps } from './shared';

/**
 * The two answers are the literal strings "Yes" and "No", because a
 * conditional rule stores the value it compares against as a string and the
 * builder writes that rule from the same two words.
 */
export const YESNO_VALUES = ['Yes', 'No'] as const;

export function YesNoField({
  question,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
}: FieldProps) {
  const current = asText(value);

  // Radios rather than a two-option select: both answers stay visible, which
  // matters when one of them opens up more of the form.
  return (
    <FieldGroup
      question={question}
      describedBy={describedBy}
      invalid={invalid}
      role="radiogroup"
    >
      {YESNO_VALUES.map((option) => (
        <OptionControl
          key={option}
          id={`${inputId}-${option.toLowerCase()}`}
          name={inputId}
          type="radio"
          label={option}
          checked={current === option}
          onChange={() => onChange(option)}
        />
      ))}
    </FieldGroup>
  );
}
