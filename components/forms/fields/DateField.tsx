import { TextLikeInput, type FieldProps } from './shared';

export function DateField(props: FieldProps) {
  const { min, max } = props.question.config;
  return <TextLikeInput {...props} type="date" min={min} max={max} />;
}
