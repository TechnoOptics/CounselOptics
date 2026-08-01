import { TextLikeInput, type FieldProps } from './shared';

// No `autoComplete`: the question is written by the firm, and it is as likely
// to be asking for a counterparty's address as the employee's own. Offering
// the employee's saved address for either would be a guess.
export function EmailField(props: FieldProps) {
  return <TextLikeInput {...props} type="email" inputMode="email" />;
}
