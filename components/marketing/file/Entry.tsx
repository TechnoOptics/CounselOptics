import type { ReactNode } from 'react';
import { Definitions } from './Definitions';
import { Section } from './Section';
import { BODY, H2 } from './type';

/**
 * A lettered or named entry in the file: a Section carrying an h2, one
 * paragraph, optional Definitions, and an optional Sheet beside the copy.
 * The home, features and enterprise pages compose their entries from this.
 */
export function Entry({
  tab,
  label,
  title,
  body,
  sheet,
  defs,
  id,
}: {
  tab?: string;
  label: string;
  title: string;
  body: string;
  sheet?: ReactNode;
  defs?: { term: string; def: ReactNode }[];
  id?: string;
}) {
  return (
    <Section tab={tab} label={label} id={id}>
      <div className={sheet ? 'grid gap-8 lg:grid-cols-2 lg:items-start' : ''}>
        <div className="min-w-0">
          <h2 className={H2}>{title}</h2>
          <p className={`${BODY} mt-4`}>{body}</p>
          {defs && <Definitions items={defs} />}
        </div>
        {sheet && <div className="min-w-0">{sheet}</div>}
      </div>
    </Section>
  );
}
