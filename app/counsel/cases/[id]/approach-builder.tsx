'use client';

import { useState, useTransition } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import {
  createFirmApproach,
  regenerateFirmApproach,
  updateFirmApproach,
  deleteFirmApproach,
  type Approach,
} from '@/lib/firm-approach-actions';
import type { ApproachArgument } from '@/lib/approach-ai';

/**
 * Approach builder (firm "prove-the-case" layer). The lawyer writes a theory,
 * "what I'm trying to prove," and Advottic assembles the matter's evidence into
 * a structured argument with cited exhibits and a supporting timeline. Saved as
 * "Approach 1/2/3", editable and re-runnable.
 *
 * AI-gated + graceful: the approach is always saved; when analysis is
 * unavailable the card shows a calm "add credits to run" state and a re-run
 * button, never a raw error.
 */

const AI_UNAVAILABLE = "Advottic's analysis is temporarily unavailable. Please try again shortly.";
function isUnavailable(msg: string | null | undefined): boolean {
  return !!msg && (msg === AI_UNAVAILABLE || /temporarily unavailable|add credits/i.test(msg));
}

export function ApproachBuilder({
  firmId,
  caseId,
  initial,
}: {
  firmId: string;
  caseId: string;
  initial: Approach[];
}) {
  const t = useT();
  const [approaches, setApproaches] = useState<Approach[]>(initial);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    setNotice(null);
    if (!prompt.trim()) {
      setError(t('Write what you are trying to prove.'));
      return;
    }
    startTransition(async () => {
      const res = await createFirmApproach(firmId, caseId, { title, prompt });
      if (res.ok && res.approach) {
        setApproaches((list) => [...list, res.approach!]);
        setTitle('');
        setPrompt('');
        if (res.generateError) {
          setNotice(
            isUnavailable(res.generateError)
              ? t('Approach saved. Advottic analysis is temporarily unavailable, add credits to assemble the argument, then re-run.')
              : res.generateError,
          );
        }
      } else {
        setError(res.error ?? t('Could not save the approach.'));
      }
    });
  }

  const onUpdated = (a: Approach) =>
    setApproaches((list) => list.map((x) => (x.id === a.id ? a : x)));
  const onRemoved = (id: string) =>
    setApproaches((list) => list.filter((x) => x.id !== id));

  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold tracking-tight text-ink-950 dark:text-cream-100">
          <T>Approach builder</T>
        </h2>
        <p className="text-sm text-ink-500 mt-0.5 max-w-2xl leading-relaxed">
          <T>
            Write the theory you are trying to prove. Advottic marshals the
            matter&apos;s evidence into a structured argument with cited exhibits
            and a supporting timeline. Save several approaches and compare them.
          </T>
        </p>
      </header>

      {/* New approach */}
      <div className="card p-4 space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('Approach title (optional, e.g. Constructive eviction)')}
          className="input text-sm w-full"
          data-no-translate
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('What are you trying to prove? For example: The landlord knew about the mold for months and failed to act, making the unit uninhabitable.')}
          rows={3}
          className="input text-sm w-full resize-y"
          data-no-translate
        />
        {error && <p className="text-[12px] text-rose-700 dark:text-rose-300" data-no-translate>{error}</p>}
        {notice && (
          <p className="text-[12px] text-amber-800 dark:text-amber-200 bg-amber-50/70 dark:bg-amber-500/10 rounded-md px-3 py-2">
            {notice}
          </p>
        )}
        <div className="flex justify-end">
          <button onClick={create} disabled={pending} className="btn-primary text-sm">
            {pending ? <T>Assembling…</T> : <T>Assemble the argument</T>}
          </button>
        </div>
      </div>

      {approaches.length === 0 ? (
        <p className="text-[13px] text-ink-500 dark:text-cream-100/55 italic">
          <T>No approaches yet. Write your first theory above.</T>
        </p>
      ) : (
        <div className="space-y-4">
          {approaches.map((a) => (
            <ApproachCard
              key={a.id}
              firmId={firmId}
              caseId={caseId}
              approach={a}
              onUpdated={onUpdated}
              onRemoved={onRemoved}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ApproachCard({
  firmId,
  caseId,
  approach,
  onUpdated,
  onRemoved,
}: {
  firmId: string;
  caseId: string;
  approach: Approach;
  onUpdated: (a: Approach) => void;
  onRemoved: (id: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(approach.title);
  const [prompt, setPrompt] = useState(approach.prompt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const g = approach.generated;

  function rerun(withPrompt?: string) {
    setError(null);
    startTransition(async () => {
      const res = await regenerateFirmApproach(firmId, caseId, approach.id, withPrompt);
      if (res.ok && res.approach) {
        onUpdated(res.approach);
        setEditing(false);
      } else {
        setError(res.error ?? t('Could not re-run.'));
      }
    });
  }

  function saveEdits() {
    setError(null);
    startTransition(async () => {
      const res = await updateFirmApproach(firmId, caseId, approach.id, { title, prompt });
      if (res.ok) {
        onUpdated({ ...approach, title: title.trim(), prompt: prompt.trim() });
        setEditing(false);
      } else {
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteFirmApproach(firmId, caseId, approach.id);
      if (res.ok) onRemoved(approach.id);
      else setError(res.error ?? t('Could not delete.'));
    });
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[15.5px] font-semibold text-forest-900 dark:text-cream-100" data-no-translate>
          {approach.title}
        </h3>
        <div className="flex items-center gap-1.5 text-[12px]">
          <button onClick={() => setEditing((v) => !v)} disabled={pending} className="btn-ghost px-2 py-1">
            {editing ? <T>Cancel</T> : <T>Edit</T>}
          </button>
          <button onClick={() => rerun()} disabled={pending} className="btn-ghost px-2 py-1">
            {pending ? <T>Working…</T> : <T>Re-run</T>}
          </button>
          <button onClick={remove} disabled={pending} className="btn-ghost px-2 py-1 text-rose-700 dark:text-rose-300">
            <T>Delete</T>
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input text-sm w-full" data-no-translate />
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="input text-sm w-full resize-y" data-no-translate />
          <div className="flex justify-end gap-2">
            <button onClick={saveEdits} disabled={pending} className="btn-ghost text-sm"><T>Save</T></button>
            <button onClick={() => rerun(prompt)} disabled={pending} className="btn-primary text-sm"><T>Save and re-run</T></button>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-ink-600 dark:text-cream-100/70 italic leading-relaxed" data-no-translate>
          &ldquo;{approach.prompt}&rdquo;
        </p>
      )}

      {error && (
        isUnavailable(error) ? (
          <p className="text-[12px] text-amber-800 dark:text-amber-200 bg-amber-50/70 dark:bg-amber-500/10 rounded-md px-3 py-2">
            <T>Advottic analysis is temporarily unavailable. Add credits to run, then re-run this approach.</T>
          </p>
        ) : (
          <p className="text-[12px] text-rose-700 dark:text-rose-300" data-no-translate>{error}</p>
        )
      )}

      {g ? (
        <GeneratedArgument g={g} />
      ) : (
        !editing && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
            <T>The argument has not been assembled yet. Add Advottic credits, then Re-run to build it from the evidence on file.</T>
          </div>
        )
      )}
    </div>
  );
}

function GeneratedArgument({ g }: { g: ApproachArgument }) {
  return (
    <div className="space-y-4 border-t border-ink-100 dark:border-forest-700/40 pt-4">
      {g.thesis && (
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Thesis</T></p>
          <p className="text-[14px] font-medium text-forest-900 dark:text-cream-100 leading-relaxed" data-no-translate>
            {g.thesis}
          </p>
        </div>
      )}
      {g.argument && (
        <div>
          <p className="eyebrow text-[10px] mb-1"><T>Argument</T></p>
          <p className="text-[14px] text-ink-800 dark:text-cream-100/85 leading-relaxed whitespace-pre-wrap" data-no-translate>
            {g.argument}
          </p>
        </div>
      )}

      {g.exhibits.length > 0 && (
        <div>
          <p className="eyebrow text-[10px] mb-2"><T>Exhibits</T></p>
          <ul className="space-y-1.5">
            {g.exhibits.map((e, i) => (
              <li key={i} className="flex gap-2 text-[13.5px]">
                {e.exhibit && (
                  <span className="shrink-0 font-mono text-[11px] rounded bg-forest-900 text-white dark:bg-gold-metal dark:text-forest-950 px-1.5 py-0.5 h-fit" data-no-translate>
                    {e.exhibit}
                  </span>
                )}
                <span className="text-ink-800 dark:text-cream-100/85 leading-relaxed" data-no-translate>
                  <span className="font-medium">{e.title}</span>
                  {e.why && <span className="text-ink-600 dark:text-cream-100/65">: {e.why}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {g.timeline.length > 0 && (
        <div>
          <p className="eyebrow text-[10px] mb-2"><T>Timeline</T></p>
          <ol className="space-y-2 border-l-2 border-ink-200 dark:border-forest-700/40 pl-3.5">
            {g.timeline.map((tl, i) => (
              <li key={i} className="relative">
                <span aria-hidden className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-gold-metal ring-2 ring-white dark:ring-forest-950" />
                <p className="text-[12px] font-mono text-ink-500 dark:text-cream-100/55" data-no-translate>{tl.when}</p>
                <p className="text-[13.5px] font-medium text-forest-900 dark:text-cream-100" data-no-translate>{tl.title}</p>
                {tl.significance && (
                  <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed" data-no-translate>{tl.significance}</p>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {g.gaps.length > 0 && (
        <div>
          <p className="eyebrow text-[10px] mb-2"><T>Gaps to close</T></p>
          <ul className="space-y-1.5 text-[13.5px] text-ink-800 dark:text-cream-100/85">
            {g.gaps.map((gap, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-[8px] h-1 w-1 flex-none rounded-full bg-amber-500" />
                <span className="leading-relaxed" data-no-translate>{gap}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
