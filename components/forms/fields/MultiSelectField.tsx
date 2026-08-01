import { FieldGroup, OptionControl, asList, type FieldProps } from './shared';

export function MultiSelectField({
  question,
  value,
  onChange,
  inputId,
  describedBy,
  invalid,
}: FieldProps) {
  const options = question.config.options ?? [];
  const selected = asList(value);

  // Checkboxes rather than a multiple <select>: a native multi-select needs a
  // modifier key to add a second choice, which people miss.
  return (
    <FieldGroup question={question} describedBy={describedBy} invalid={invalid}>
      {options.map((option, index) => (
        <OptionControl
          key={option}
          id={`${inputId}-o${index}`}
          name={inputId}
          type="checkbox"
          label={option}
          checked={selected.includes(option)}
          onChange={(checked) =>
            // Rebuild from the author's option order so the stored answer does
            // not depend on the order the boxes were ticked in.
            onChange(
              options.filter((o) =>
                o === option ? checked : selected.includes(o),
              ),
            )
          }
        />
      ))}
    </FieldGroup>
  );
}
