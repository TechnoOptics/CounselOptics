'use client';

import type { ElementType, HTMLAttributes } from 'react';
import { useT } from '@/components/i18n/LocaleProvider';

/**
 * Localize a string ATTRIBUTE (title / aria-label) on an element.
 *
 * <T> only translates rendered children; a tooltip lives in a string
 * attribute, which needs the t() function - and t() comes from the
 * useT() hook, usable only in a client component. This thin client
 * wrapper lets a server-component page localize a tooltip without
 * itself becoming a client component: it renders the element, runs the
 * title/ariaLabel through t(), and passes everything else through.
 *
 *   <Tt title="Invited but has not signed in yet">…</Tt>   // <span>
 *   <Tt as="td" title="Advottic Review grade">{grade}</Tt>
 *
 * `ariaLabel` is the camelCase prop for the aria-label attribute (so it
 * doesn't collide with a caller spreading a raw `aria-label`). English
 * and no-provider both fall through as identity, so this is safe to use
 * anywhere.
 */
type TtProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
  title?: string;
  ariaLabel?: string;
};

export function Tt({ as, title, ariaLabel, children, ...rest }: TtProps) {
  const t = useT();
  const Tag: ElementType = as ?? 'span';
  return (
    <Tag
      {...rest}
      title={title != null ? t(title) : undefined}
      aria-label={ariaLabel != null ? t(ariaLabel) : undefined}
    >
      {children}
    </Tag>
  );
}
