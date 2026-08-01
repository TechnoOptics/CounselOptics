import { TextLikeInput, type FieldProps } from './shared';

export function PhoneField(props: FieldProps) {
  return <TextLikeInput {...props} type="tel" inputMode="tel" autoComplete="tel" />;
}
