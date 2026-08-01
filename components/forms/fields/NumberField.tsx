import { TextLikeInput, type FieldProps } from './shared';

export function NumberField(props: FieldProps) {
  const { min, max, step } = props.question.config;
  return (
    <TextLikeInput
      {...props}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={step}
    />
  );
}
