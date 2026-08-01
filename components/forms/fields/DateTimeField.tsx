import { TextLikeInput, type FieldProps } from './shared';

export function DateTimeField(props: FieldProps) {
  const { min, max } = props.question.config;
  // `datetime-local` so the employee picks a wall-clock time in their own
  // timezone; the stored value is compared as a string by lib/form-validate.
  return <TextLikeInput {...props} type="datetime-local" min={min} max={max} />;
}
