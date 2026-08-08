import { isUnknownColumnError } from './signer-view';

/**
 * How a template's layout override survives a column that is not applied yet.
 *
 * firm_templates.document_layout arrives with a migration the owner applies, so
 * between merge and apply, and in the window right after it runs while
 * PostgREST still holds a stale schema cache, a write naming the column comes
 * back with it unknown.
 *
 * Kept out of lib/document-layout.ts because that module has no imports on
 * purpose, and out of lib/firm-templates.ts because every export of a
 * `'use server'` file is a public HTTP endpoint and these two are neither
 * endpoints nor async. Same shape as resolveDownloadColumnFallback
 * (lib/signer-view.ts) and resolveDeliveryModeColumnFallback
 * (lib/submission-dispatch.ts).
 */

export type DocumentLayoutColumnFallback =
  /** Save anyway, without the column. Only when there was no override. */
  | 'retry-without-column'
  /** Do not save. The author configured a layout that cannot be recorded. */
  | 'abort-layout-unsaved'
  /** Not a missing column. The caller surfaces the original error. */
  | 'surface-error';

/**
 * The wording for the abort, kept beside the decision so the two cannot drift.
 * It names the fix and who can make it, because the person reading it is a
 * template author and cannot apply a migration.
 */
export const DOCUMENT_LAYOUT_UNSAVED_ERROR =
  'This template was not saved. The page layout you set for it needs a ' +
  'database update that has not been applied yet, so saving now would leave ' +
  'the template using the firm layout instead of the one you configured. Ask ' +
  'your administrator to apply the pending update, or clear the layout for ' +
  'this template and save.';

/**
 * What to do when a template write carrying `document_layout` fails.
 *
 * Retrying without the column is right in exactly one direction, the same way
 * the two fallbacks it is modelled on are.
 *
 * With NO override, dropping the column changes nothing: an absent value reads
 * as "use the firm layout", which is what a template with no override does
 * anyway. The retry lands on the behaviour the author chose.
 *
 * With an override, dropping the column discards it. The action would report
 * success and hand back a template that renders on the firm's layout, and the
 * editor would then show the author their own unsaved settings as though they
 * were stored. So this refuses, and nothing is written.
 */
export function resolveDocumentLayoutColumnFallback(input: {
  /** True when this write was setting a layout rather than clearing one. */
  hasOverride: boolean;
  error: { code?: string | null; message?: string | null } | null | undefined;
}): DocumentLayoutColumnFallback {
  if (!isUnknownColumnError(input.error, 'document_layout')) return 'surface-error';
  return input.hasOverride ? 'abort-layout-unsaved' : 'retry-without-column';
}
