import { TextLikeInput, type FieldProps } from './shared';

export function TimeField(props: FieldProps) {
  const { min, max } = props.question.config;
  return <TextLikeInput {...props} type="time" min={min} max={max} />;
}
