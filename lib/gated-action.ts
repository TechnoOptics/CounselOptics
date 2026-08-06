'use client';

import { isAccessEndedError } from './firm-access';

/**
 * The client half of the access-ended refusal, and the reason it needs one.
 *
 * Every gated action in the counsel app is dispatched the same way:
 *
 *   startTransition(async () => {
 *     const res = await someGatedAction(...);
 *     if (res.ok) { ... } else setError(res.error);
 *   });
 *
 * This is React 18.3.1, whose `startTransition` calls `scope()` and DISCARDS
 * the promise it returns. Async rejections becoming boundary errors is a
 * React 19 Actions feature and it is not here. So when the server refuses, the
 * rejection is unhandled: `res` is never assigned, no error state is set, and
 * the dialog silently does nothing. A person in a locked-out organization
 * clicks Save and the button just does not work. app/counsel/error.tsx is
 * correct and is never reached from this path.
 *
 * The fix belongs at the call site rather than at the gate, and one helper
 * rather than fourteen hand-written catches, for exactly the reason fourteen
 * hand-written catches were refused: a `try { await requireActiveFirm(id) }
 * catch { ... }` next to the gate is byte-identical to the fail-open this
 * feature exists to avoid, and a reviewer cannot tell intent from accident.
 *
 * This is safe for the same structural reason the boundary is. It runs in the
 * BROWSER, after the server action has already returned. The write was refused
 * on the server, the request is over, and there is no door here for it to
 * open: the only thing this can do is decide what the person is told.
 *
 * The match is on IDENTITY, never on the message. See ACCESS_ENDED_CODE.
 *
 * Everything that is not the refusal is RETHROWN, unchanged. This helper must
 * not become a general-purpose swallow: it converts one recognised refusal and
 * leaves every other failure exactly as it was.
 */

/**
 * What a person is told when the organization's access ended mid-session.
 *
 * Same three facts as app/counsel/error.tsx: it has ended, so this was not
 * saved, and nothing is being deleted. The last is a correctness requirement,
 * not a reassurance: under this design nothing is deleted.
 */
export const ACCESS_ENDED_NOTICE =
  'Your organization’s access has ended, so this was not saved. Your data is not being deleted, and it is all still here.';

type Refusable = { ok: boolean; error?: string };

/**
 * Await a gated server action and turn an access-ended refusal into the
 * action's own failure shape, so the surface that called it renders calm copy
 * in the error slot it already has.
 *
 * Usage is one line at the call site, and nothing else about the call site
 * changes:
 *   const res = await runGatedAction(() => someGatedAction(firmId, formData));
 *
 * THE CAST, stated rather than hidden. The return type is T, not
 * `T | { ok: false; error: string }`, because a union would force every one of
 * the call sites to re-narrow a result it already handles and would turn a
 * two-token change into a rewrite of twenty-one dialogs. The cast is sound for
 * the actions this wraps: each returns `{ ok: false, error }` on failure and
 * every other field on the result is optional, so `{ ok: false, error }` IS
 * that failure shape. An action whose failure branch carries required fields
 * does not belong here without widening this first.
 */
export async function runGatedAction<T extends Refusable>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isAccessEndedError(err)) {
      return { ok: false, error: ACCESS_ENDED_NOTICE } as unknown as T;
    }
    throw err;
  }
}
