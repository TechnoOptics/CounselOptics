import type { ReactNode } from 'react';
import { LABEL } from './type';

/** Two to four terms with definitions. This replaces every check-bullet list. */
export function Definitions({
  items,
  columns = 3,
}: {
  items: { term: string; def: ReactNode }[];
  columns?: 2 | 3 | 4;
}) {
  const cols = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[columns];
  return (
    <dl className={`mt-6 grid gap-6 ${cols}`}>
      {items.map((it) => (
        <div key={it.term}>
          <dt className={`${LABEL} border-t border-rule pt-2`}>{it.term}</dt>
          <dd className="mt-1 font-public text-[15px] leading-[1.45]">{it.def}</dd>
        </div>
      ))}
    </dl>
  );
}
