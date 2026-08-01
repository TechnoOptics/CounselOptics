import { TextLikeInput, type FieldProps } from './shared';

export function NumberField(props: FieldProps) {
  const { min, max, step } = props.question.config;
  // No `inputMode`: `type="number"` already picks the keypad, and forcing
  // `numeric` would take the decimal point away on iOS for a question whose
  // validator accepts decimals.
  return <TextLikeInput {...props} type="number" min={min} max={max} step={step} />;
}
