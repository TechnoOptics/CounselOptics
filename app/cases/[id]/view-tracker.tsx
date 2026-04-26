'use client';

import { useEffect } from 'react';
import { trackCaseViewAction } from '@/lib/actions';

/**
 * Pings trackCaseViewAction once per mount to register a "case_viewed"
 * audit event. The action and the email-throttle inside lib/activity
 * handle deduplication, so this hook is intentionally simple.
 *
 * Lives in its own client component so the case detail server page
 * can stay a server component without flipping to "use client".
 */
export function ViewTracker({ caseId }: { caseId: string }) {
  useEffect(() => {
    void trackCaseViewAction(caseId);
  }, [caseId]);
  return null;
}
