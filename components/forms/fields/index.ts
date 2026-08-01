/**
 * Question type to component. One entry per type in `QUESTION_TYPES`, so
 * adding a type to lib/form-schema fails the build here until it has a
 * renderer, rather than falling through to a plain text box at runtime.
 */

import type { ComponentType } from 'react';
import type { QuestionType } from '@/lib/form-schema';
import type { FieldProps } from './shared';
import { ShortTextField } from './ShortTextField';
import { LongTextField } from './LongTextField';
import { EmailField } from './EmailField';
import { PhoneField } from './PhoneField';
import { NumberField } from './NumberField';
import { CurrencyField } from './CurrencyField';
import { DateField } from './DateField';
import { TimeField } from './TimeField';
import { DateTimeField } from './DateTimeField';
import { YesNoField } from './YesNoField';
import { SelectField } from './SelectField';
import { MultiSelectField } from './MultiSelectField';

export type { FieldProps };

export const FIELD_COMPONENTS: Record<QuestionType, ComponentType<FieldProps>> = {
  short_text: ShortTextField,
  long_text: LongTextField,
  email: EmailField,
  phone: PhoneField,
  number: NumberField,
  currency: CurrencyField,
  date: DateField,
  time: TimeField,
  datetime: DateTimeField,
  yesno: YesNoField,
  select: SelectField,
  multiselect: MultiSelectField,
};
