import { TextLikeInput, type FieldProps } from './shared';

// No `autoComplete`, for the same reason as EmailField: whose number the
// question wants is the firm's decision, not something to guess at.
export function PhoneField(props: FieldProps) {
  return <TextLikeInput {...props} type="tel" inputMode="tel" />;
}
