import { TextLikeInput, type FieldProps } from './shared';

export function EmailField(props: FieldProps) {
  return <TextLikeInput {...props} type="email" inputMode="email" autoComplete="email" />;
}
