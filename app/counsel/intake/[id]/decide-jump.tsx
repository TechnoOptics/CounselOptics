'use client';

import { OPEN_SECTION_EVENT } from '@/components/intake/SectionJump';
import { T } from '@/components/i18n/LocaleProvider';

/**
 * The action bar's secondary: the other end of the same fork, which is
 * declining the request or closing it out.
 *
 * It opens the decision control rather than being one. Techottic's secondary
 * here is a one-click Escalate, and this deliberately is not: declining a
 * request writes a reason the person who filed it will read, and the reason
 * is required. A one-click decline in the bar would either send an empty
 * explanation or fail on the server after the click, so the bar carries the
 * way IN to the decision and the decision keeps its reason box.
 */
export function DecideJump({ decided }: { decided: boolean }) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent(OPEN_SECTION_EVENT, { detail: { id: 'decide' } }),
        )
      }
      className="btn-secondary !py-1.5 whitespace-nowrap text-[13px]"
    >
      {decided ? <T>See the decision</T> : <T>Decline or close</T>}
    </button>
  );
}
