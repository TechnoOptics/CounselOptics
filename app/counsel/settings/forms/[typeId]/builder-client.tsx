'use client';

/**
 * The intake form builder.
 *
 * The canvas IS the form. Legal edits something laid out like what an employee
 * fills in, on the same three-column grid `FormRenderer` uses, rather than a
 * properties table beside a preview. That correspondence is the whole design:
 * a field in the second column here is a field in the second column there.
 *
 * Four things this file is careful about.
 *
 * 1. All draft arithmetic lives in lib/form-draft.ts, which is pure and unit
 *    tested. This file holds state, focus and copy. The repo's vitest
 *    environment is `node` with no DOM, so anything left in here is untestable
 *    and anything moved out of it is not.
 *
 * 2. The rule editor offers only questions ABOVE the one being edited, so the
 *    no-forward-reference invariant is taught by the control rather than
 *    reported as an error afterwards. `ruleProblems` catches the two ways a
 *    form gets into that state anyway: moving a field above its controller,
 *    and deleting the controller. Neither is ever silent.
 *
 * 3. The draft is handed to `FormRenderer` exactly as held, with no cast and
 *    no trip through `readFormPayload`. That reader drops a question whose
 *    label has not been typed yet, which is precisely the question the author
 *    is looking at.
 *
 * 4. Publishing reads the draft from the database, so the pending autosave is
 *    flushed before the confirmation opens. Otherwise a publish within the
 *    debounce window would publish the previous keystroke's form.
 *
 * Copy: every static string is wrapped in `<T>`, the counsel dictionary, and
 * no question label, help text or option ever is, because those are the
 * author's own words.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageHeader } from '@/components/counsel/ui';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { FormRenderer } from '@/components/forms/FormRenderer';
import { YESNO_VALUES } from '@/components/forms/fields/YesNoField';
import { SURFACE_SCHEME } from '@/components/forms/fields/shared';
import { relativeTime } from '@/lib/intake-conversation-types';
import { discardDraftAction, publishFormAction, saveDraftAction } from '@/lib/form-actions';
import type { ActionResult } from '@/lib/form-actions';
import type { RequestTypeMode } from '@/lib/form-queries';
import type { FormError, FormPayload, Question, QuestionType, Rule } from '@/lib/form-schema';
import type { Answers } from '@/lib/form-validate';
import {
  addQuestion,
  clearRule,
  deleteQuestion,
  flattenQuestions,
  MAX_FIELDS_PER_ROW,
  moveQuestion,
  partnerDegradations,
  questionsBefore,
  ruleProblems,
  RULE_OP_LABELS,
  startingDraft,
  TYPE_GROUPS,
  TYPE_LABELS,
  updateQuestion,
  type FlatQuestion,
  type MoveDirection,
  type RuleProblem,
} from '@/lib/form-draft';

// ---------------------------------------------------------------------------
// Glyphs. Same system as components/counsel/icons.tsx: 24 viewBox, stroke
// only, one weight of 1.7, round caps and joins, currentColor. Local because
// none of these five shapes exists in the rail's set, and a builder control
// glyph has no business in the navigation's file.
// ---------------------------------------------------------------------------

function Glyph({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

const ARROW: Record<MoveDirection, string> = {
  up: 'M12 19V5M6.5 10.5 12 5l5.5 5.5',
  down: 'M12 5v14M6.5 13.5 12 19l5.5-5.5',
  left: 'M19 12H5M10.5 6.5 5 12l5.5 5.5',
  right: 'M5 12h14M13.5 6.5 19 12l-5.5 5.5',
};
const PLUS = 'M12 5.2v13.6M5.2 12h13.6';
const CLOSE = 'M6.6 6.6l10.8 10.8M17.4 6.6 6.6 17.4';
const CHEVRON_DOWN = 'M6.6 9.4 12 14.8l5.4-5.4';
const CHEVRON_LEFT = 'M14.4 5.6 8 12l6.4 6.4';

function AlertGlyph() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.7v5.1M12 16.2h.01" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared class strings. Written out in full, never assembled at runtime, so
// Tailwind's content scan can see every one of them.
// ---------------------------------------------------------------------------

/** A control set into a running sentence: a ruled blank, not a boxed field. */
const BLANK =
  'mx-1 max-w-full rounded-sm border-0 border-b border-dashed border-gold-600/70 bg-transparent px-1 py-0.5 font-medium text-gold-700 focus:border-solid focus:outline-none focus:ring-2 focus:ring-gold-500/40 dark:border-gold-500/60 dark:text-gold-300';

const ICON_BUTTON =
  'rounded-md p-1.5 text-ink-400 transition-colors hover:bg-cream-100 hover:text-forest-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60 disabled:cursor-not-allowed disabled:opacity-30 dark:text-cream-100/40 dark:hover:bg-forest-800 dark:hover:text-cream-100';

const SETTING_LABEL =
  'block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/50';

const CANVAS_GRID = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3';

// ---------------------------------------------------------------------------

export type BuilderType = {
  id: string;
  key: string;
  label: string;
  mode: RequestTypeMode;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Where the type picker is open. A row index, or the new row at the bottom. */
type PickerAt = { kind: 'row'; rowIndex: number } | { kind: 'newRow' } | null;

export function BuilderClient({
  type,
  initialDraft,
  draftUpdatedAt,
  publishedVersion,
  published,
}: {
  type: BuilderType;
  /** Raw `draft_payload` jsonb. Never cast, never coerced on the way in. */
  initialDraft: unknown;
  draftUpdatedAt: string | null;
  publishedVersion: number | null;
  published: FormPayload | null;
}) {
  const router = useRouter();
  const opened = useState(() => startingDraft(initialDraft, published))[0];
  const [draft, setDraft] = useState<FormPayload>(opened.payload);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(draftUpdatedAt);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pickerAt, setPickerAt] = useState<PickerAt>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [view, setView] = useState<'build' | 'preview'>('build');
  const [answers, setAnswers] = useState<Answers>({});

  const [dialog, setDialog] = useState<'publish' | 'discard' | null>(null);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState<FormError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(publishedVersion);

  // Rendered only after mount: `relativeTime` reads the clock, and a server
  // render of "2 min ago" would not match the client's.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  /**
   * The version that is live right now. State rather than the prop, because
   * publishing inside this sitting changes it and the prop does not follow:
   * `publishFormAction` revalidates the index, not this route. Everything
   * that asks "what is published" reads this.
   */
  const [live, setLive] = useState<FormPayload | null>(published);

  /**
   * Keys the published version already uses. A question holding one keeps it
   * whatever the author renames the label to, because answers already filed
   * are stored against it.
   */
  const frozenKeys = useMemo(
    () => new Set((live?.rows ?? []).flatMap((r) => r.fields.map((f) => f.key))),
    [live],
  );

  const flat = useMemo(() => flattenQuestions(draft), [draft]);
  const problems = useMemo(() => ruleProblems(draft), [draft]);
  const problemsByQuestion = useMemo(() => {
    const map = new Map<string, RuleProblem>();
    for (const p of problems) map.set(p.questionId, p);
    return map;
  }, [problems]);
  const degradations = useMemo(() => partnerDegradations(draft), [draft]);

  const apply = useCallback((next: FormPayload) => {
    setDraft(next);
    setDirty(true);
    setServerErrors([]);
  }, []);

  // --- autosave ------------------------------------------------------------

  /** The last payload the server confirmed it holds. Identity, not deep equality. */
  const savedPayload = useRef<FormPayload | null>(null);

  /**
   * Saves are single file: each one is chained behind the previous, so only
   * one request to this row is ever open.
   *
   * Ordering the UI verdicts is not enough. The debounce is 900 ms and a save
   * slower than that overlaps the next one, and once two requests are in the
   * air the server decides which lands last, not this component. If the older
   * one lands last the row holds the older draft while the strip reads
   * "Draft saved", and the next publish ships that older draft. Chaining puts
   * the ordering back where it can be guaranteed: the second request is not
   * issued until the first has returned.
   *
   * The chain never rejects, so one failure cannot strand every later save.
   */
  const chain = useRef<Promise<ActionResult>>(Promise.resolve({ ok: true }));

  const save = useCallback(
    (payload: FormPayload): Promise<ActionResult> => {
      const next = chain.current.then(async (): Promise<ActionResult> => {
        // A later save in the same chain may already have covered this
        // payload, in which case there is nothing to write.
        if (savedPayload.current === payload) return { ok: true };

        setSaveState('saving');
        let result: ActionResult;
        try {
          result = await saveDraftAction(type.id, payload);
        } catch {
          result = { ok: false, error: 'The connection dropped.' };
        }

        if (result.ok) {
          savedPayload.current = payload;
          setSavedAt(new Date().toISOString());
          setSaveError(null);
          setSaveState('saved');
        } else {
          setSaveError(result.error);
          setSaveState('error');
        }
        return result;
      });
      chain.current = next;
      return next;
    },
    [type.id],
  );

  useEffect(() => {
    if (!dirty) return;
    if (savedPayload.current === draft) return;
    const timer = setTimeout(() => {
      void save(draft);
    }, 900);
    return () => clearTimeout(timer);
  }, [draft, dirty, save]);

  /**
   * The debounce is the whole risk here: leaving the page inside that window
   * cancels the timer and the last edits are gone, while the strip still
   * reads "Draft saved" from the previous cycle. The header's own "All intake
   * forms" link is one click away, so this is not a corner case.
   *
   * A client-side navigation unmounts this component, and the cleanup below
   * issues the save the timer never got to. The request survives the unmount:
   * it is a fetch in the same document, not tied to this React tree. A real
   * page unload cannot be saved through, so that one asks the browser to
   * confirm instead.
   */
  const unsaved = useRef<FormPayload | null>(null);
  unsaved.current = dirty && savedPayload.current !== draft ? draft : null;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsaved.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (unsaved.current) void save(unsaved.current);
    };
  }, [save]);

  // --- focus ---------------------------------------------------------------

  const labelInputId = (questionId: string) => `question-${questionId}-label`;

  /**
   * Runs after the commit that mounted the input, which is why this is an
   * effect and not a callback: a newly added question's label input, and the
   * input a publish error points at, both only exist once the state that
   * expanded them has rendered.
   */
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(labelInputId(focusId));
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'center' });
    }
    setFocusId(null);
  }, [focusId]);

  const goToQuestion = useCallback((questionId: string) => {
    setDialog(null);
    setView('build');
    setExpandedId(questionId);
    setFocusId(questionId);
  }, []);

  // --- actions -------------------------------------------------------------

  const openPublish = useCallback(async () => {
    setServerErrors([]);
    setNotice(null);
    // Publish reads the stored draft, not this state, so the pending
    // keystroke has to reach the database before the dialog offers to.
    //
    // A FAILED flush must not open the dialog. `publishFormAction` would
    // otherwise validate and ship whatever `draft_payload` still held, which
    // after an expired session is the form as it stood before this sitting.
    // The strip is already rose and the line beside the button says why;
    // clicking Publish again retries the save.
    if (dirty && savedPayload.current !== draft) {
      const result = await save(draft);
      if (!result.ok) return;
    }
    setDialog('publish');
  }, [dirty, draft, save]);

  const doPublish = useCallback(async () => {
    setBusy(true);
    const result = await publishFormAction(type.id);
    setBusy(false);
    if (result.ok) {
      setVersion(result.version);
      // The draft just became the live version. Promoting it locally is what
      // keeps two things honest for the rest of this sitting: `frozenKeys`,
      // so renaming a label cannot rewrite a key the new version's answers
      // are already filed against, and Discard, which would otherwise revert
      // the canvas to the version before this one.
      setLive(draft);
      setDirty(false);
      setSavedAt(null);
      setSaveState('idle');
      savedPayload.current = null;
      setServerErrors([]);
      setDialog(null);
      setNotice(`Published as v${result.version}.`);
      // `publishFormAction` revalidates the index but not this route, so the
      // server props here would stay on the previous version.
      router.refresh();
      return;
    }
    if ('errors' in result) {
      setServerErrors(result.errors);
      return;
    }
    setNotice(result.error);
    setDialog(null);
  }, [draft, router, type.id]);

  const doDiscard = useCallback(async () => {
    setBusy(true);
    const result = await discardDraftAction(type.id);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      setDialog(null);
      return;
    }
    // `live`, not the prop: after a publish in this sitting the prop is a
    // version behind, and discarding onto it would leave the author editing
    // the form that was replaced.
    setDraft(live ?? { schemaVersion: 1, rows: [] });
    setDirty(false);
    setSavedAt(null);
    setSaveState('idle');
    savedPayload.current = null;
    setExpandedId(null);
    setServerErrors([]);
    setDialog(null);
  }, [live, type.id]);

  const onPickType = useCallback(
    (target: PickerAt, questionType: QuestionType) => {
      if (!target) return;
      const result = addQuestion(draft, target, questionType);
      apply(result.payload);
      setPickerAt(null);
      setExpandedId(result.question.id);
      setFocusId(result.question.id);
    },
    [apply, draft],
  );

  const hasDraft = dirty || savedAt !== null;
  const blocked = problems.length > 0;

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader
        align="start"
        eyebrow={<T>Firm settings &middot; Intake forms</T>}
        backLink={
          <Link
            href="/counsel/settings/forms"
            className="inline-flex items-center gap-1 text-[13px] text-ink-600 transition-colors hover:text-forest-900 dark:text-cream-100/60 dark:hover:text-gold-300"
          >
            <Glyph d={CHEVRON_LEFT} size={14} />
            <T>All intake forms</T>
          </Link>
        }
        title={type.label}
        meta={
          <>
            {type.key} &middot;{' '}
            {type.mode === 'client' ? <T>Client facing</T> : <T>In house</T>}
          </>
        }
        action={
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <div className="flex flex-wrap items-center gap-2">
              <ViewSwitch view={view} onChange={setView} />
              {hasDraft && (
                <button
                  type="button"
                  className="btn-ghost text-[13px]"
                  onClick={() => setDialog('discard')}
                >
                  <T>Discard changes</T>
                </button>
              )}
              <button type="button" className="btn-primary text-[13px]" onClick={openPublish}>
                <T>Publish</T>
              </button>
            </div>
            {/* Beside the button, not only in the strip: this is the reason
                the confirmation did not open, and it says what clicking
                again will do. */}
            {saveState === 'error' && (
              <p className="max-w-xs text-[12px] leading-snug text-rose-600 sm:text-right dark:text-rose-300">
                <T>
                  This draft is not saved, so it cannot be published yet. Publish tries the
                  save again.
                </T>
              </p>
            )}
          </div>
        }
      />

      <StatusStrip
        saveState={saveState}
        saveError={saveError}
        savedAt={savedAt}
        now={now}
        version={version}
        openedFromPublished={opened.source === 'published' && !dirty && savedAt === null}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
      />

      {view === 'preview' ? (
        <PreviewSheet
          draft={draft}
          answers={answers}
          onChange={(key, value) => setAnswers((prev) => ({ ...prev, [key]: value }))}
          hiddenByBrokenRule={problems.some((p) => p.kind === 'missing' || p.kind === 'forward')}
        />
      ) : (
        <div className="space-y-3">
          {draft.rows.map((row, rowIndex) => (
            <div key={row.id} className={CANVAS_GRID}>
              {row.fields.map((question) => {
                const entry = flat.find((f) => f.question.id === question.id);
                return (
                  <FieldCard
                    key={question.id}
                    question={question}
                    number={entry ? entry.number : 0}
                    expanded={expandedId === question.id}
                    problem={problemsByQuestion.get(question.id)}
                    earlier={questionsBefore(draft, question.id)}
                    all={flat}
                    frozenKeys={frozenKeys}
                    labelInputId={labelInputId(question.id)}
                    onToggle={() =>
                      setExpandedId((prev) => (prev === question.id ? null : question.id))
                    }
                    onPatch={(patch) => apply(updateQuestion(draft, question.id, patch, frozenKeys))}
                    onClearRule={() => apply(clearRule(draft, question.id))}
                    onMove={(direction) => apply(moveQuestion(draft, question.id, direction))}
                    onDelete={() => {
                      apply(deleteQuestion(draft, question.id));
                      setExpandedId(null);
                    }}
                  />
                );
              })}
              {row.fields.length < MAX_FIELDS_PER_ROW && (
                <Slot
                  open={pickerAt?.kind === 'row' && pickerAt.rowIndex === rowIndex}
                  onOpen={() => setPickerAt({ kind: 'row', rowIndex })}
                  onClose={() => setPickerAt(null)}
                  onPick={(t) => onPickType({ kind: 'row', rowIndex }, t)}
                  label={<T>Add a question beside this one</T>}
                />
              )}
            </div>
          ))}

          <Slot
            wide
            open={pickerAt?.kind === 'newRow'}
            onOpen={() => setPickerAt({ kind: 'newRow' })}
            onClose={() => setPickerAt(null)}
            onPick={(t) => onPickType({ kind: 'newRow' }, t)}
            label={
              draft.rows.length === 0 ? (
                <T>Add the first question</T>
              ) : (
                <T>Add a question on a new row</T>
              )
            }
          />
        </div>
      )}

      {dialog === 'publish' && (
        <Dialog title={<T>Publish this form</T>} onClose={() => setDialog(null)}>
          <p className="text-sm leading-relaxed text-ink-600 dark:text-cream-100/70">
            <T>
              This becomes the form your colleagues answer from now on. Publishing does not
              change requests already submitted: each one keeps the version of the form it
              was filed with, and reads back exactly as it was answered.
            </T>
          </p>

          {degradations.types.length > 0 || degradations.conditional > 0 ? (
            <Notice tone="warn" title={<T>Older partner apps will simplify this form</T>}>
              <ul className="mt-1 space-y-1">
                {degradations.types.map((d) => (
                  <li key={d.type}>
                    <T>{TYPE_LABELS[d.type]}</T>
                    {' → '}
                    {d.renderedAs === 'select' ? (
                      <T>a list the employee picks one answer from</T>
                    ) : (
                      <T>a plain text box</T>
                    )}
                  </li>
                ))}
                {degradations.conditional > 0 && (
                  <li>
                    <T>
                      Questions with a rule are shown to everyone and never made required,
                      because those apps cannot evaluate a rule.
                    </T>
                  </li>
                )}
              </ul>
              <p className="mt-2">
                <T>
                  Employees on the current apps see the form exactly as you built it.
                </T>
              </p>
            </Notice>
          ) : null}

          {blocked && (
            <ProblemList
              title={<T>Fix these before publishing</T>}
              items={problems.map((p) => ({
                id: p.questionId,
                text: <ProblemText problem={p} />,
              }))}
              onGo={goToQuestion}
            />
          )}

          {serverErrors.length > 0 && (
            <ProblemList
              title={<T>This form is not ready to publish</T>}
              items={serverErrors.map((e, i) => ({
                id: e.questionId ?? `error-${i}`,
                text: e.message,
                target: e.questionId,
              }))}
              onGo={goToQuestion}
            />
          )}

          <DialogActions>
            <button type="button" className="btn-ghost text-[13px]" onClick={() => setDialog(null)}>
              <T>Cancel</T>
            </button>
            <button
              type="button"
              className="btn-primary text-[13px]"
              onClick={doPublish}
              disabled={busy || blocked}
            >
              {busy ? <T>Publishing</T> : <T>Publish form</T>}
            </button>
          </DialogActions>
        </Dialog>
      )}

      {dialog === 'discard' && (
        <Dialog title={<T>Discard these changes</T>} onClose={() => setDialog(null)}>
          <p className="text-sm leading-relaxed text-ink-600 dark:text-cream-100/70">
            {version !== null ? (
              <>
                <T>The form goes back to the published version, v</T>
                <span className="tabular-nums">{version}</span>
                <T>. Your unpublished edits are removed. Requests already submitted are
                unaffected.</T>
              </>
            ) : (
              <T>
                The draft is removed. Nothing has been published for this request type, so
                it goes back to your firm&rsquo;s standard questions.
              </T>
            )}
          </p>
          <DialogActions>
            <button type="button" className="btn-ghost text-[13px]" onClick={() => setDialog(null)}>
              <T>Keep editing</T>
            </button>
            <button
              type="button"
              className="btn-secondary text-[13px]"
              onClick={doDiscard}
              disabled={busy}
            >
              <T>Discard</T>
            </button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header furniture
// ---------------------------------------------------------------------------

function ViewSwitch({
  view,
  onChange,
}: {
  view: 'build' | 'preview';
  onChange: (next: 'build' | 'preview') => void;
}) {
  const base =
    'rounded-md px-3 py-1.5 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60';
  const on = 'bg-white text-forest-900 shadow-sm dark:bg-forest-700 dark:text-cream-100';
  const off = 'text-ink-600 hover:text-forest-900 dark:text-cream-100/60 dark:hover:text-cream-100';
  return (
    <div className="inline-flex rounded-lg border border-ink-200 bg-cream-50 p-0.5 dark:border-forest-700 dark:bg-forest-900/60">
      <button
        type="button"
        aria-pressed={view === 'build'}
        className={`${base} ${view === 'build' ? on : off}`}
        onClick={() => onChange('build')}
      >
        <T>Build</T>
      </button>
      <button
        type="button"
        aria-pressed={view === 'preview'}
        className={`${base} ${view === 'preview' ? on : off}`}
        onClick={() => onChange('preview')}
      >
        <T>Preview</T>
      </button>
    </div>
  );
}

/** One quiet line: where the draft stands, and what is live right now. */
function StatusStrip({
  saveState,
  saveError,
  savedAt,
  now,
  version,
  openedFromPublished,
  notice,
  onDismissNotice,
}: {
  saveState: SaveState;
  saveError: string | null;
  savedAt: string | null;
  now: number | null;
  version: number | null;
  openedFromPublished: boolean;
  notice: string | null;
  onDismissNotice: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <span aria-live="polite" className="text-ink-600 dark:text-cream-100/60">
          {saveState === 'saving' && <T>Saving</T>}
          {saveState === 'error' && (
            <span className="text-rose-600 dark:text-rose-300">
              <T>Could not save this draft.</T> {saveError}
            </span>
          )}
          {saveState !== 'saving' && saveState !== 'error' && savedAt && now !== null && (
            <>
              <T>Draft saved</T> {relativeTime(savedAt, now)}
            </>
          )}
          {saveState !== 'saving' && saveState !== 'error' && !savedAt && openedFromPublished && (
            <T>Editing the published form. Nothing is saved until you change something.</T>
          )}
          {saveState !== 'saving' && saveState !== 'error' && !savedAt && !openedFromPublished && (
            <T>No unpublished changes.</T>
          )}
        </span>
        <span className="text-ink-400 dark:text-cream-100/25">&middot;</span>
        <span className="text-ink-500 dark:text-cream-100/50">
          {version === null ? (
            <T>Nothing published yet</T>
          ) : (
            <>
              <T>Live version</T> <span className="tabular-nums">v{version}</span>
            </>
          )}
        </span>
      </div>

      {notice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-2 text-[13px] text-forest-900 dark:text-cream-100">
          <span>{notice}</span>
          <button
            type="button"
            className={ICON_BUTTON}
            onClick={onDismissNotice}
            title="Dismiss"
          >
            <Glyph d={CLOSE} size={14} />
            <span className="sr-only">
              <T>Dismiss</T>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The canvas
// ---------------------------------------------------------------------------

/**
 * An empty position in a row, and the type picker that occupies it. The picker
 * opens in place rather than in a menu so the choice is visibly about that
 * position: this question goes here, beside that one.
 */
function Slot({
  open,
  onOpen,
  onClose,
  onPick,
  label,
  wide = false,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick: (type: QuestionType) => void;
  label: ReactNode;
  wide?: boolean;
}) {
  const span = wide ? 'sm:col-span-2 lg:col-span-3' : '';

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-h-[5.5rem] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 px-3 py-4 text-[13px] text-ink-500 transition-colors hover:border-gold-500 hover:text-forest-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60 dark:border-forest-600/70 dark:text-cream-100/45 dark:hover:border-gold-500 dark:hover:text-cream-100 ${span}`}
      >
        <Glyph d={PLUS} size={15} />
        {label}
      </button>
    );
  }

  return (
    <div
      className={`rounded-lg border border-gold-500/60 bg-white p-3 dark:bg-forest-900/80 ${span}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/50">
          <T>What is this question?</T>
        </p>
        <button type="button" className={ICON_BUTTON} onClick={onClose}>
          <Glyph d={CLOSE} size={14} />
          <span className="sr-only">
            <T>Close</T>
          </span>
        </button>
      </div>
      {TYPE_GROUPS.map((group) => (
        <div key={group.group} className="mt-2.5">
          <p className="font-mono text-[11px] text-ink-400 dark:text-cream-100/35">
            {group.group === 'text' ? <T>Text</T> : <T>Structured</T>}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {group.types.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onPick(t)}
                className="rounded-md border border-ink-200 px-2.5 py-1 text-[13px] text-forest-900 transition-colors hover:border-gold-500 hover:bg-cream-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60 dark:border-forest-700 dark:text-cream-100 dark:hover:border-gold-500 dark:hover:bg-forest-800"
              >
                <T>{TYPE_LABELS[t]}</T>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldCard({
  question,
  number,
  expanded,
  problem,
  earlier,
  all,
  frozenKeys,
  labelInputId,
  onToggle,
  onPatch,
  onClearRule,
  onMove,
  onDelete,
}: {
  question: Question;
  number: number;
  expanded: boolean;
  problem: RuleProblem | undefined;
  /** What a rule here may legally point at: the questions above this one. */
  earlier: FlatQuestion[];
  /** Every question, only so a rule already pointing later can be NAMED. */
  all: FlatQuestion[];
  frozenKeys: ReadonlySet<string>;
  labelInputId: string;
  onToggle: () => void;
  onPatch: (patch: Parameters<typeof updateQuestion>[2]) => void;
  onClearRule: () => void;
  onMove: (direction: MoveDirection) => void;
  onDelete: () => void;
}) {
  const shell = expanded
    ? 'rounded-lg border border-gold-500/70 bg-white p-3 dark:bg-forest-900/85'
    : 'rounded-lg border border-ink-200 bg-cream-50/70 p-3 transition-colors hover:border-gold-500/60 dark:border-forest-700/60 dark:bg-forest-950/40';
  const span = expanded ? 'sm:col-span-2 lg:col-span-3' : '';

  return (
    <div className={`${shell} ${span}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-ink-400 dark:text-cream-100/35">
          {String(number).padStart(2, '0')}
        </span>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="min-w-0 flex-1 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60"
        >
          <span className="block break-words font-display text-[15px] text-forest-900 dark:text-cream-100">
            {question.label.trim() ? (
              question.label
            ) : (
              <span className="italic text-ink-400 dark:text-cream-100/40">
                <T>Untitled question</T>
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-[11px] uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/45">
            <T>{TYPE_LABELS[question.type]}</T>
            {question.required && (
              <>
                {' · '}
                <T>Required</T>
              </>
            )}
          </span>
          {question.showWhen && !expanded && (
            <span className="mt-1 block text-[12px] text-ink-500 dark:text-cream-100/50">
              <T>Shown only when</T> <RuleSummaryTarget rule={question.showWhen} all={all} />{' '}
              <T>{RULE_OP_LABELS[question.showWhen.op]}</T>
              {question.showWhen.op !== 'answered' && question.showWhen.value
                ? ` “${question.showWhen.value}”`
                : ''}
            </span>
          )}
        </button>

        <div className="flex shrink-0 items-center">
          {(['up', 'left', 'right', 'down'] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              className={ICON_BUTTON}
              onClick={() => onMove(direction)}
            >
              <Glyph d={ARROW[direction]} size={14} />
              <span className="sr-only">
                {direction === 'up' && <T>Move up</T>}
                {direction === 'down' && <T>Move down</T>}
                {direction === 'left' && <T>Move left</T>}
                {direction === 'right' && <T>Move right</T>}
              </span>
            </button>
          ))}
          <span
            className={`ml-0.5 text-ink-400 transition-transform dark:text-cream-100/35 ${
              expanded ? 'rotate-180' : ''
            }`}
            aria-hidden
          >
            <Glyph d={CHEVRON_DOWN} size={14} />
          </span>
        </div>
      </div>

      {problem && (
        <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-rose-600 dark:text-rose-300">
          <span className="mt-px shrink-0">
            <AlertGlyph />
          </span>
          <span>
            <ProblemText problem={problem} />
            {problem.kind === 'missing' && (
              <>
                {' '}
                <button
                  type="button"
                  className="underline underline-offset-2 hover:no-underline"
                  onClick={onClearRule}
                >
                  <T>Remove the rule</T>
                </button>
              </>
            )}
          </span>
        </p>
      )}

      {expanded && (
        <FieldEditor
          question={question}
          earlier={earlier}
          all={all}
          frozenKeys={frozenKeys}
          labelInputId={labelInputId}
          onPatch={onPatch}
          onClearRule={onClearRule}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

/**
 * The controlling question, by number and name, inside the collapsed summary.
 * Naming it is the point of the summary: "shown only when is Yes" tells the
 * reader nothing about which answer they mean.
 */
function RuleSummaryTarget({ rule, all }: { rule: Rule; all: FlatQuestion[] }) {
  // Looked up in the WHOLE form, not just the questions above this one. A
  // rule pointing at a later question is still pointing at a question that
  // exists, and calling it "no longer in this form" here contradicted the
  // inline problem two lines below, which correctly says it comes later.
  const target = all.find((e) => e.question.id === rule.questionId);
  if (!target) {
    return (
      <span className="italic">
        <T>a question no longer in this form</T>
      </span>
    );
  }
  return (
    <span>
      {String(target.number).padStart(2, '0')}
      {'. '}
      {target.question.label.trim() || <T>Untitled question</T>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The expanded editor
// ---------------------------------------------------------------------------

function FieldEditor({
  question,
  earlier,
  all,
  frozenKeys,
  labelInputId,
  onPatch,
  onClearRule,
  onDelete,
}: {
  question: Question;
  earlier: FlatQuestion[];
  all: FlatQuestion[];
  frozenKeys: ReadonlySet<string>;
  labelInputId: string;
  onPatch: (patch: Parameters<typeof updateQuestion>[2]) => void;
  onClearRule: () => void;
  onDelete: () => void;
}) {
  const helpId = `question-${question.id}-help`;
  const typeId = `question-${question.id}-type`;

  return (
    <div className="mt-3 space-y-4 border-t border-ink-100 pt-3 dark:border-forest-700/50">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={SETTING_LABEL} htmlFor={labelInputId}>
            <T>What the employee is asked</T>
          </label>
          <input
            id={labelInputId}
            className={`input mt-1 ${SURFACE_SCHEME}`}
            value={question.label}
            onChange={(e) => onPatch({ label: e.target.value })}
          />
        </div>
        <div>
          <label className={SETTING_LABEL} htmlFor={typeId}>
            <T>Kind of answer</T>
          </label>
          <select
            id={typeId}
            className={`input mt-1 ${SURFACE_SCHEME}`}
            value={question.type}
            onChange={(e) => onPatch({ type: e.target.value as QuestionType })}
          >
            {TYPE_GROUPS.flatMap((g) => g.types).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={SETTING_LABEL} htmlFor={helpId}>
          <T>Help text, if the question needs it</T>
        </label>
        <input
          id={helpId}
          className={`input mt-1 ${SURFACE_SCHEME}`}
          value={question.help ?? ''}
          onChange={(e) => onPatch({ help: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 text-[13px] text-forest-900 dark:text-cream-100">
        <input
          type="checkbox"
          checked={question.required}
          onChange={(e) => onPatch({ required: e.target.checked })}
          className={`h-4 w-4 accent-forest-700 dark:accent-gold-500 ${SURFACE_SCHEME}`}
        />
        <T>An answer is required</T>
      </label>

      <TypeSettings question={question} onPatch={onPatch} />

      <RuleEditor
        question={question}
        earlier={earlier}
        all={all}
        onPatch={onPatch}
        onClearRule={onClearRule}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3 dark:border-forest-700/50">
        <p className="font-mono text-[11px] text-ink-400 dark:text-cream-100/35">
          {question.key}
          {frozenKeys.has(question.key) ? (
            <>
              {' · '}
              <T>fixed, answers are stored against it</T>
            </>
          ) : (
            <>
              {' · '}
              <T>set from the label until this form is published</T>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={onDelete}
          className="text-[13px] text-rose-600 underline underline-offset-2 hover:no-underline dark:text-rose-300"
        >
          <T>Remove this question</T>
        </button>
      </div>
    </div>
  );
}

/** The settings a question's own type needs, and nothing else. */
function TypeSettings({
  question,
  onPatch,
}: {
  question: Question;
  onPatch: (patch: Parameters<typeof updateQuestion>[2]) => void;
}) {
  const { type, config } = question;

  const setConfig = (patch: Record<string, unknown>) =>
    onPatch({ config: { ...config, ...patch } });

  const numberField = (
    key: 'maxChars' | 'maxWords' | 'min' | 'max' | 'step',
    label: ReactNode,
  ) => (
    <div key={key}>
      <label className={SETTING_LABEL} htmlFor={`question-${question.id}-${key}`}>
        {label}
      </label>
      <input
        id={`question-${question.id}-${key}`}
        type="number"
        className={`input mt-1 ${SURFACE_SCHEME}`}
        value={config[key] === undefined ? '' : String(config[key])}
        onChange={(e) =>
          setConfig({ [key]: e.target.value === '' ? undefined : Number(e.target.value) })
        }
      />
    </div>
  );

  const dateField = (key: 'min' | 'max', label: ReactNode, inputType: string) => (
    <div key={key}>
      <label className={SETTING_LABEL} htmlFor={`question-${question.id}-${key}`}>
        {label}
      </label>
      <input
        id={`question-${question.id}-${key}`}
        type={inputType}
        className={`input mt-1 ${SURFACE_SCHEME}`}
        value={typeof config[key] === 'string' ? (config[key] as string) : ''}
        onChange={(e) => setConfig({ [key]: e.target.value || undefined })}
      />
    </div>
  );

  if (type === 'select' || type === 'multiselect') {
    return (
      <OptionsEditor
        questionId={question.id}
        options={config.options ?? []}
        onChange={(options) => setConfig({ options })}
      />
    );
  }

  const fields: ReactNode[] = [];
  if (type === 'short_text') fields.push(numberField('maxChars', <T>Longest answer, in characters</T>));
  if (type === 'long_text') {
    fields.push(numberField('maxWords', <T>Longest answer, in words</T>));
    fields.push(numberField('maxChars', <T>Longest answer, in characters</T>));
  }
  if (type === 'number') {
    fields.push(numberField('min', <T>Smallest accepted</T>));
    fields.push(numberField('max', <T>Largest accepted</T>));
    fields.push(numberField('step', <T>Step</T>));
  }
  if (type === 'currency') {
    fields.push(
      <div key="currency">
        <label className={SETTING_LABEL} htmlFor={`question-${question.id}-currency`}>
          <T>Currency</T>
        </label>
        <input
          id={`question-${question.id}-currency`}
          className={`input mt-1 ${SURFACE_SCHEME}`}
          value={config.currency ?? ''}
          maxLength={3}
          onChange={(e) => setConfig({ currency: e.target.value.toUpperCase() })}
        />
      </div>,
    );
    fields.push(numberField('min', <T>Smallest accepted</T>));
    fields.push(numberField('max', <T>Largest accepted</T>));
  }
  if (type === 'date' || type === 'time' || type === 'datetime') {
    const inputType = type === 'datetime' ? 'datetime-local' : type;
    fields.push(dateField('min', <T>Earliest accepted</T>, inputType));
    fields.push(dateField('max', <T>Latest accepted</T>, inputType));
  }

  if (fields.length === 0) return null;
  return <div className="grid gap-3 sm:grid-cols-3">{fields}</div>;
}

/**
 * The choices a select offers: add, reorder, remove, and a paste box. A thirty
 * item department list arrives from a spreadsheet, not from thirty clicks.
 */
function OptionsEditor({
  questionId,
  options,
  onChange,
}: {
  questionId: string;
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const [paste, setPaste] = useState('');

  const move = (index: number, delta: number) => {
    const next = [...options];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };

  return (
    <div>
      <p className={SETTING_LABEL}>
        <T>The choices offered</T>
      </p>
      <ul className="mt-1 space-y-1.5">
        {options.map((option, index) => (
          <li key={index} className="flex items-center gap-1">
            <input
              className={`input ${SURFACE_SCHEME}`}
              value={option}
              aria-label={`Choice ${index + 1}`}
              onChange={(e) => {
                const next = [...options];
                next[index] = e.target.value;
                onChange(next);
              }}
            />
            <button type="button" className={ICON_BUTTON} onClick={() => move(index, -1)}>
              <Glyph d={ARROW.up} size={14} />
              <span className="sr-only">
                <T>Move this choice up</T>
              </span>
            </button>
            <button type="button" className={ICON_BUTTON} onClick={() => move(index, 1)}>
              <Glyph d={ARROW.down} size={14} />
              <span className="sr-only">
                <T>Move this choice down</T>
              </span>
            </button>
            <button
              type="button"
              className={ICON_BUTTON}
              onClick={() => onChange(options.filter((_, i) => i !== index))}
            >
              <Glyph d={CLOSE} size={14} />
              <span className="sr-only">
                <T>Remove this choice</T>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-start gap-2">
        <button
          type="button"
          className="btn-secondary text-[13px]"
          onClick={() => onChange([...options, ''])}
        >
          <T>Add a choice</T>
        </button>
      </div>

      <div className="mt-3">
        <label className={SETTING_LABEL} htmlFor={`question-${questionId}-paste`}>
          <T>Or paste a list, one choice per line</T>
        </label>
        <textarea
          id={`question-${questionId}-paste`}
          className={`input mt-1 ${SURFACE_SCHEME}`}
          rows={3}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />
        <button
          type="button"
          className="btn-secondary mt-1.5 text-[13px]"
          disabled={paste.trim() === ''}
          onClick={() => {
            const added = paste
              .split('\n')
              .map((line) => line.trim())
              .filter(Boolean);
            if (added.length > 0) onChange([...options, ...added]);
            setPaste('');
          }}
        >
          <T>Add these choices</T>
        </button>
      </div>
    </div>
  );
}

/**
 * The rule, set as a sentence rather than as three labelled dropdowns.
 *
 * The question list is `questionsBefore`, so a forward reference cannot be
 * created here at all. The value control follows the controlling question's
 * own type, and for a yes/no it reads `YESNO_VALUES` from the field component
 * rather than repeating the two words: a second copy of "Yes" is how a rule
 * quietly stops matching.
 */
function RuleEditor({
  question,
  earlier,
  all,
  onPatch,
  onClearRule,
}: {
  question: Question;
  earlier: FlatQuestion[];
  all: FlatQuestion[];
  onPatch: (patch: Parameters<typeof updateQuestion>[2]) => void;
  onClearRule: () => void;
}) {
  const t = useT();
  const rule = question.showWhen;

  // Order matters: an existing rule is always editable, even with nothing
  // above this question to point at. A field moved to the top of the form
  // keeps whatever rule it had, and hiding the editor there would leave the
  // author reading a problem about a rule they had no way to reach.
  if (!rule && earlier.length === 0) {
    return (
      <p className="text-[12px] text-ink-500 dark:text-cream-100/45">
        <T>
          The first question in a form is always shown. Move this one down to make it
          depend on an earlier answer.
        </T>
      </p>
    );
  }

  if (!rule) {
    return (
      <button
        type="button"
        className="text-[13px] text-gold-700 underline underline-offset-2 hover:no-underline dark:text-gold-300"
        onClick={() =>
          onPatch({
            showWhen: { questionId: earlier[earlier.length - 1].question.id, op: 'answered' },
          })
        }
      >
        <T>Only ask this sometimes</T>
      </button>
    );
  }

  // The dropdown offers `earlier` and nothing else, so a forward reference
  // cannot be created here. But one can already exist, because a move can put
  // a field above its controller, and the option list has to be able to show
  // what the rule currently says. So the CURRENT target is resolved against
  // the whole form: named and marked as coming later if it is still in the
  // form, and only called gone when it genuinely is.
  const controller = all.find((e) => e.question.id === rule.questionId);
  const targetIsEarlier = earlier.some((e) => e.question.id === rule.questionId);
  const optionLabel = (entry: FlatQuestion) =>
    `${String(entry.number).padStart(2, '0')}. ${entry.question.label.trim() || t('Untitled question')}`;

  const patchRule = (patch: Partial<Rule>) =>
    onPatch({ showWhen: { ...rule, ...patch } as Rule });

  return (
    <div>
      <p className="font-display text-[15px] leading-[2.1] text-forest-900 dark:text-cream-100">
        <T>Show this only when</T>
        <select
          className={`${BLANK} ${SURFACE_SCHEME}`}
          aria-label="The earlier question this one depends on"
          value={rule.questionId}
          onChange={(e) => patchRule({ questionId: e.target.value })}
        >
          {!targetIsEarlier && (
            <option value={rule.questionId}>
              {controller
                ? `${optionLabel(controller)} (${t('comes later')})`
                : t('a question no longer in this form')}
            </option>
          )}
          {earlier.map((e) => (
            <option key={e.question.id} value={e.question.id}>
              {optionLabel(e)}
            </option>
          ))}
        </select>
        <select
          className={`${BLANK} ${SURFACE_SCHEME}`}
          aria-label="How that answer is compared"
          value={rule.op}
          onChange={(e) => {
            const op = e.target.value as Rule['op'];
            patchRule({ op, value: op === 'answered' ? undefined : (rule.value ?? '') });
          }}
        >
          {(['eq', 'neq', 'answered'] as const).map((op) => (
            <option key={op} value={op}>
              {RULE_OP_LABELS[op]}
            </option>
          ))}
        </select>
        {rule.op !== 'answered' && (
          <RuleValue
            controller={controller?.question}
            value={rule.value ?? ''}
            onChange={(value) => patchRule({ value })}
          />
        )}
        {'.'}
      </p>
      <button
        type="button"
        className="mt-1 text-[12px] text-ink-500 underline underline-offset-2 hover:no-underline dark:text-cream-100/50"
        onClick={onClearRule}
      >
        <T>Always show this question</T>
      </button>
    </div>
  );
}

function RuleValue({
  controller,
  value,
  onChange,
}: {
  controller: Question | undefined;
  value: string;
  onChange: (value: string) => void;
}) {
  const choices =
    controller?.type === 'yesno'
      ? [...YESNO_VALUES]
      : controller?.type === 'select' || controller?.type === 'multiselect'
        ? (controller.config.options ?? [])
        : null;

  if (choices) {
    return (
      <select
        className={`${BLANK} ${SURFACE_SCHEME}`}
        aria-label="The answer to compare against"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{'…'}</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className={`${BLANK} ${SURFACE_SCHEME}`}
      aria-label="The answer to compare against"
      size={Math.max(6, value.length + 1)}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * The draft through the real employee renderer, not a mock of it. The payload
 * goes in untouched: `FormRenderer` takes `unknown` and narrows it itself.
 */
function PreviewSheet({
  draft,
  answers,
  onChange,
  hiddenByBrokenRule,
}: {
  draft: FormPayload;
  answers: Answers;
  onChange: (key: string, value: string | string[]) => void;
  hiddenByBrokenRule: boolean;
}) {
  return (
    <section className="card p-5 sm:p-7">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-500 dark:text-cream-100/50">
        <T>What an employee sees</T>
      </p>
      <p className="mt-1 text-[13px] text-ink-600 dark:text-cream-100/60">
        <T>
          Answer it here to check that the questions appear and disappear the way you meant.
          Nothing is submitted.
        </T>
      </p>
      {hiddenByBrokenRule && (
        <p className="mt-2 text-[13px] text-rose-600 dark:text-rose-300">
          <T>
            A question whose rule cannot be honoured does not appear below. Go back to Build
            to see which one.
          </T>
        </p>
      )}
      <div className="mt-5">
        <FormRenderer
          payload={draft}
          answers={answers}
          onChange={onChange}
          errors={{}}
          idPrefix="preview"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Notices, problems and dialogs
// ---------------------------------------------------------------------------

function ProblemText({ problem }: { problem: RuleProblem }) {
  const name = problem.questionLabel.trim();
  const target = problem.targetLabel?.trim();

  if (problem.kind === 'missing') {
    return (
      <>
        <T>The rule on</T> {name || <T>this question</T>}{' '}
        <T>points at a question that is no longer in this form, so it never appears.</T>
      </>
    );
  }
  if (problem.kind === 'forward') {
    return (
      <>
        <T>The rule on</T> {name || <T>this question</T>} <T>depends on</T>{' '}
        {target || <T>a later question</T>}
        <T>, which comes after it. Move one of them so the answer exists first.</T>
      </>
    );
  }
  return (
    <>
      <T>The rule on</T> {name || <T>this question</T>}{' '}
      <T>has no answer to compare against, so it never matches.</T>
    </>
  );
}

function ProblemList({
  title,
  items,
  onGo,
}: {
  title: ReactNode;
  items: { id: string; text: ReactNode; target?: string }[];
  onGo: (questionId: string) => void;
}) {
  return (
    <Notice tone="error" title={title}>
      <ul className="mt-1 space-y-1">
        {items.map((item) => {
          const target = 'target' in item ? item.target : item.id;
          return (
            <li key={item.id}>
              {target ? (
                <button
                  type="button"
                  className="text-left underline underline-offset-2 hover:no-underline"
                  onClick={() => onGo(target)}
                >
                  {item.text}
                </button>
              ) : (
                <span>{item.text}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'warn' | 'error';
  title: ReactNode;
  children: ReactNode;
}) {
  const shell =
    tone === 'error'
      ? 'rounded-lg border border-rose-300 bg-rose-50 p-3 text-[13px] text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200'
      : 'rounded-lg border border-gold-500/50 bg-gold-500/10 p-3 text-[13px] text-forest-900 dark:text-cream-100';
  return (
    <div className={shell}>
      <p className="flex items-center gap-1.5 font-medium">
        <AlertGlyph />
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * A plain modal. Escape closes it, the backdrop is not a control, and focus
 * moves onto the panel when it opens so a keyboard reader is not left behind
 * on the button that opened it. It is named by its own heading rather than by
 * an `aria-label`, because the title arrives as a `<T>` element and a label
 * built from one would be empty.
 */
function Dialog({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const headingId = 'builder-dialog-title';

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-forest-950/70 p-4">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="card w-full max-w-lg space-y-4 p-5 focus:outline-none sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id={headingId}
            className="font-display text-xl font-medium text-forest-900 dark:text-cream-100"
          >
            {title}
          </h2>
          <button type="button" className={ICON_BUTTON} onClick={onClose}>
            <Glyph d={CLOSE} size={16} />
            <span className="sr-only">
              <T>Close</T>
            </span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DialogActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-2 pt-1">{children}</div>;
}

export default BuilderClient;
