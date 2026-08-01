import { TextLikeInput, type FieldProps } from './shared';

export function ShortTextField(props: FieldProps) {
  return <TextLikeInput {...props} type="text" inputMode="text" />;
}
