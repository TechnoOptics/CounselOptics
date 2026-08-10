'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { T, useT } from '@/components/i18n/LocaleProvider';
import { isNativeApp } from '@/lib/platform';
import {
  createFirmApproach,
  regenerateFirmApproach,
  updateFirmApproach,
  deleteFirmApproach,
  getApproachEvidence,
  getApproachGenState,
  type Approach,
} from '@/lib/firm-approach-actions';
import type { ApproachArgument } from '@/lib/approach-ai';
import { exhibitLabel, fuzzyTitleMatch, type TimelineEvent } from '@/lib/timeline-types';
import { EvidencePreview } from '@/components/EvidencePreview';
import { EvidenceViewer } from './evidence/evidence-viewer';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatMonthYear } from '@/lib/format';

/**
 * Case Theory Console: the firm "prove-the-case" approach board, styled as a
 * premium investigative terminal. The lawyer opens an APPROACH VECTOR: the
 * theory they mean to prove, who is connected, and anything relevant. Advottic
 * marshals the matter's own evidence into a structured argument with cited
 * exhibits and a supporting timeline, saved as "Approach 01/02/03", editable
 * and re-runnable.
 *
 * AI-gated + graceful: the approach is always saved; when analysis is
 * unavailable the dossier shows a calm "awaiting analysis" state and a re-run
 * control, never a raw error. Pure presentation change over the existing
 * actions, with no behavioural wiring changed.
 */

const AI_UNAVAILABLE = "Advottic's analysis is temporarily unavailable. Please try again shortly.";
function isUnavailable(msg: string | null | undefined): boolean {
  return !!msg && (msg === AI_UNAVAILABLE || /temporarily unavailable|add credits/i.test(msg));
}

/** Zero-padded dossier index: 1 -> "01". */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
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
  const [open, setOpen] = useState(initial.length === 0);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [connections, setConnections] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    setNotice(null);
    if (!prompt.trim()) {
      setError(t('Lay out the theory you are setting out to prove.'));
      return;
    }
    startTransition(async () => {
      try {
        const res = await createFirmApproach(firmId, caseId, { title, prompt, connections });
        if (res?.ok && res.approach) {
          setApproaches((list) => [...list, res.approach!]);
          setTitle('');
          setPrompt('');
          setConnections('');
          setOpen(false);
          if (res.generateError) {
            setNotice(
              isUnavailable(res.generateError)
                ? t("Approach saved. Advottic's analysis is temporarily unavailable right now; try assembling the argument again shortly.")
                : res.generateError,
            );
          }
        } else {
          setError(res?.error ?? t('Could not save the approach.'));
        }
      } catch {
        setError(t("Advottic's analysis is temporarily unavailable right now; try assembling the argument again shortly."));
      }
    });
  }

  const onUpdated = useCallback(
    (a: Approach) => setApproaches((list) => list.map((x) => (x.id === a.id ? a : x))),
    [],
  );
  const onRemoved = useCallback(
    (id: string) => setApproaches((list) => list.filter((x) => x.id !== id)),
    [],
  );

  return (
    <section
      className="relative overflow-hidden rounded-2xl border border-gold-metal/20 bg-forest-950 text-cream-100 shadow-[0_18px_50px_-30px_rgba(0,0,0,0.8)]"
      style={{
        backgroundImage:
          'radial-gradient(130% 100% at 90% -20%, rgba(198,161,91,0.06), transparent 60%)',
      }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-metal/40 to-transparent" />

      <div className="relative p-5 sm:p-6 space-y-6">
        {/* Console header */}
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-metal">
              <T>Case theories</T>
            </p>
            <h2 className="mt-1.5 text-2xl font-medium tracking-tight text-cream-50">
              <T>Approaches</T>
            </h2>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-cream-100/55">
              <T>
                Lay out a theory you mean to prove; Advottic marshals the matter&apos;s
                evidence into a cited argument with its own timeline. Run several
                theories side by side.
              </T>
            </p>
          </div>
          {!open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gold-metal/40 bg-gold-metal/10 px-3.5 py-2 text-[13px] font-medium text-gold-metal transition-colors hover:bg-gold-metal/20"
            >
              <span className="text-[15px] leading-none">+</span>
              <T>New approach</T>
            </button>
          )}
        </header>

        {/* New approach vector */}
        {open && (
          <div className="rounded-xl border border-gold-metal/20 bg-forest-900/50 p-4 sm:p-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-metal">
              <T>New approach</T>
            </p>
            <div className="space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('Codename for this theory (e.g. Constructive eviction)')}
                className="w-full rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2 text-sm text-cream-50 placeholder:text-cream-100/35 outline-none transition-colors focus:border-gold-metal/50 focus:shadow-[0_0_0_3px_rgba(198,161,91,0.10)]"
                data-no-translate
              />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  'The theory you are proving. Example: The landlord knew about the mold for months and failed to act. Tie together the inspection report (EX-03), the tenant emails, and the maintenance logs.',
                )}
                rows={4}
                className="w-full resize-y rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2.5 text-sm leading-relaxed text-cream-50 placeholder:text-cream-100/35 outline-none transition-colors focus:border-gold-metal/50 focus:shadow-[0_0_0_3px_rgba(198,161,91,0.10)]"
                data-no-translate
              />
              <div>
                <p className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.2em] text-gold-metal">
                  <T>Connected parties</T>
                </p>
                <textarea
                  value={connections}
                  onChange={(e) => setConnections(e.target.value)}
                  placeholder={t(
                    'Who is connected and how: parties, witnesses, roles. Example: Jane Doe (tenant, claimant); Acme Property LLC (landlord, defendant); Bob Smith (building super, saw the leak).',
                  )}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2.5 text-sm leading-relaxed text-cream-50 placeholder:text-cream-100/35 outline-none transition-colors focus:border-gold-metal/50 focus:shadow-[0_0_0_3px_rgba(198,161,91,0.10)]"
                  data-no-translate
                />
              </div>
              {error && (
                <p className="font-mono text-[11.5px] text-danger-text" data-no-translate>
                  {error}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                {approaches.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setError(null); }}
                    disabled={pending}
                    className="rounded-lg px-3 py-2 text-[13px] text-cream-100/70 hover:text-cream-100"
                  >
                    <T>Cancel</T>
                  </button>
                )}
                <button
                  type="button"
                  onClick={create}
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg border border-gold-metal/50 bg-gold-metal/15 px-4 py-2 text-[13px] font-medium text-gold-metal transition-all hover:bg-gold-metal/25 hover:shadow-[0_0_22px_-6px_rgba(198,161,91,0.7)] disabled:opacity-60"
                >
                  {pending ? (
                    <>
                      <Spinner />
                      <T>Assembling the argument…</T>
                    </>
                  ) : (
                    <T>Assemble the argument</T>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {notice && (
          <p className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] text-warn-text">
            {notice}
          </p>
        )}

        {/* Dossiers */}
        {approaches.length === 0 && !open ? (
          <p className="text-[13px] text-cream-100/45">
            <T>No approaches yet. Start one to begin building your argument.</T>
          </p>
        ) : (
          <div className="space-y-4">
            {approaches.map((a, i) => (
              <ApproachCard
                key={a.id}
                index={i + 1}
                firmId={firmId}
                caseId={caseId}
                approach={a}
                onUpdated={onUpdated}
                onRemoved={onRemoved}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ApproachCard({
  index,
  firmId,
  caseId,
  approach,
  onUpdated,
  onRemoved,
}: {
  index: number;
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
  const [connections, setConnections] = useState(approach.connections);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, startTransition] = useTransition();

  const g = approach.generated;
  const assembled = !!g;
  // The assembly runs in the background (it can take a few minutes). While the
  // row is 'running', poll for the result so the card fills in on its own and
  // survives a page reload mid-run.
  const running = approach.genStatus === 'running';

  useEffect(() => {
    if (!running) return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await getApproachGenState(firmId, caseId, approach.id);
        if (!alive || !res?.ok || !res.approach) return;
        if (res.approach.genStatus !== 'running') {
          onUpdated(res.approach); // done or error -> stops the poll (running flips)
          if (res.approach.genStatus === 'error') setError(res.approach.genError ?? t('Could not re-run.'));
        }
      } catch {
        /* transient; keep polling */
      }
    };
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [running, firmId, caseId, approach.id, onUpdated, t]);

  function rerun(withPrompt?: string) {
    setError(null);
    startTransition(async () => {
      try {
        // Returns immediately with the approach marked 'running'; the poll above
        // then takes over and fills in the assembled argument when it lands.
        const res = await regenerateFirmApproach(firmId, caseId, approach.id, withPrompt);
        if (res?.ok && res.approach) {
          onUpdated(res.approach);
          setEditing(false);
        } else {
          setError(res?.error ?? t('Could not start the re-run. Please try again.'));
        }
      } catch {
        setError(t("Advottic's analysis is temporarily unavailable right now; try assembling the argument again shortly."));
      }
    });
  }

  function saveEdits() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await updateFirmApproach(firmId, caseId, approach.id, { title, prompt, connections });
        if (res?.ok) {
          onUpdated({ ...approach, title: title.trim(), prompt: prompt.trim(), connections: connections.trim() });
          setEditing(false);
        } else {
          setError(res?.error ?? t('Could not save.'));
        }
      } catch {
        setError(t('Could not save. Please try again.'));
      }
    });
  }

  function remove() {
    startTransition(async () => {
      try {
        const res = await deleteFirmApproach(firmId, caseId, approach.id);
        if (res?.ok) onRemoved(approach.id);
        else setError(res?.error ?? t('Could not delete.'));
      } catch {
        setError(t('Could not delete. Please try again.'));
      }
    });
  }

  // Court-ready packet for THIS approach: the assembled argument as the opening
  // narrative, then only the exhibits this approach marshals, embedded. Opens
  // through the in-app browser on native, a new tab on web.
  async function exportPacket() {
    const url = `/counsel/cases/${caseId}/approach/${approach.id}/export`;
    if (isNativeApp()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, toolbarColor: '#0b0b0d' });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-cream-50/10 bg-forest-900/40">
      {/* Left status accent */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-[2px] ${assembled ? 'bg-gold-metal/70' : 'bg-amber-500/40'}`}
      />

      <div className="p-4 pl-5 sm:p-5 sm:pl-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 shrink-0 rounded-md border border-gold-metal/30 bg-gold-metal/10 px-2 py-1 font-mono text-[11px] font-semibold tracking-[0.08em] text-gold-metal">
              {`A-${pad2(index)}`}
            </span>
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold leading-tight text-cream-50" data-no-translate>
                {approach.title || t('Untitled approach')}
              </h3>
              <span
                className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  running
                    ? // `text-info-text` like the two branches below reach for
                      // their own tokens. The near-white sky it replaces was
                      // 1.15:1 once this shell grew a light theme.
                      'bg-sky-500/12 text-info-text'
                    : assembled
                    ? 'bg-gold-metal/[0.12] text-gold-metal'
                    : 'bg-amber-500/10 text-warn-text'
                }`}
              >
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    running ? 'animate-pulse bg-sky-400' : assembled ? 'bg-gold-metal' : 'bg-amber-400'
                  }`}
                />
                {running ? <T>Assembling…</T> : assembled ? <T>Assembled</T> : <T>Not yet assembled</T>}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <button
              type="button"
              onClick={() => rerun()}
              disabled={pending || running}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gold-metal/50 bg-gold-metal/15 px-3 py-1.5 text-[12.5px] font-medium text-gold-metal transition-colors hover:bg-gold-metal/25 disabled:opacity-60"
            >
              {pending || running ? (
                <>
                  <Spinner />
                  <T>Assembling…</T>
                </>
              ) : assembled ? (
                <T>Re-run</T>
              ) : (
                <T>Assemble</T>
              )}
            </button>
            {assembled && (
              <RailButton onClick={exportPacket} disabled={pending || running}>
                <T>Export</T>
              </RailButton>
            )}
            <RailButton onClick={() => setEditing((v) => !v)} disabled={pending || running}>
              {editing ? <T>Cancel</T> : <T>Edit</T>}
            </RailButton>
            <RailButton onClick={() => setConfirmRemove(true)} disabled={pending || running} tone="danger">
              <T>Delete</T>
            </RailButton>
          </div>
        </div>

        {editing ? (
          <div className="space-y-2 rounded-lg border border-cream-50/10 bg-forest-950/50 p-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2 text-sm text-cream-50 outline-none focus:border-gold-metal/50"
              data-no-translate
            />
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder={t('The theory you are proving')}
              className="w-full resize-y rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2.5 text-sm leading-relaxed text-cream-50 outline-none focus:border-gold-metal/50"
              data-no-translate
            />
            <textarea
              value={connections}
              onChange={(e) => setConnections(e.target.value)}
              rows={3}
              placeholder={t('Connected parties: who is involved and how')}
              className="w-full resize-y rounded-lg border border-cream-50/12 bg-forest-950/70 px-3 py-2.5 text-sm leading-relaxed text-cream-50 outline-none focus:border-gold-metal/50"
              data-no-translate
            />
            <div className="flex justify-end gap-2">
              <button onClick={saveEdits} disabled={pending || running} className="rounded-lg px-3 py-1.5 text-[13px] text-cream-100/75 hover:text-cream-100">
                <T>Save</T>
              </button>
              <button onClick={() => rerun(prompt)} disabled={pending || running} className="inline-flex items-center gap-2 rounded-lg border border-gold-metal/50 bg-gold-metal/15 px-3 py-1.5 text-[13px] font-medium text-gold-metal hover:bg-gold-metal/25">
                {(pending || running) && <Spinner />}
                <T>Save and re-run</T>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <blockquote className="border-l-2 border-gold-metal/40 pl-3 text-[13px] italic leading-relaxed text-cream-100/75" data-no-translate>
              {approach.prompt}
            </blockquote>
            {approach.connections.trim() && (
              <div className="rounded-lg border border-cream-50/10 bg-forest-950/40 px-3 py-2">
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-gold-metal">
                  <T>Connected parties</T>
                </p>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-cream-100/75" data-no-translate>
                  {approach.connections}
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          isUnavailable(error) ? (
            <p className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-[12px] text-warn-text">
              <T>Advottic&apos;s analysis is temporarily unavailable right now. Please try re-running this approach shortly.</T>
            </p>
          ) : (
            <p className="font-mono text-[11.5px] text-danger-text" data-no-translate>{error}</p>
          )
        )}

        {pending || running ? (
          <div className="space-y-2">
            <AssembleProgress />
            <p className="text-[11.5px] leading-relaxed text-cream-100/55">
              <T>
                Advottic is reading the whole matter to assemble this argument. On a large matter this can
                take a couple of minutes. You can leave this page; it keeps working and fills in when ready.
              </T>
            </p>
          </div>
        ) : g ? (
          <>
            <GeneratedArgument g={g} firmId={firmId} caseId={caseId} approachId={approach.id} />
            <ApproachEvidence firmId={firmId} caseId={caseId} approachId={approach.id} />
          </>
        ) : (
          !editing && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-[12.5px] text-warn-text">
              <span aria-hidden className="mt-0.5 text-[14px]">◇</span>
              <T>The argument has not been assembled yet. Assemble to build it from the evidence on file.</T>
            </div>
          )
        )}
      </div>

      {/* Deleting an approach throws away its assembled argument and its
          evidence selection. Was a native window.confirm(), suppressed inside
          the Capacitor WebView. */}
      {confirmRemove && (
        <ConfirmDialog
          question={t('Delete this approach?')}
          detail={t('The assembled argument and the exhibits picked for it are removed. This cannot be undone.')}
          confirmLabel={t('Delete')}
          cancelLabel={t('Keep it')}
          busy={pending || running}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            remove();
          }}
        />
      )}
    </div>
  );
}

/**
 * Progress indicator for the assemble step. The server action streams no
 * progress events, so this eases a bar toward ~92% over the expected
 * generation time and the card swaps to the finished argument the moment
 * `pending` clears (the bar unmounts, so it never sits stuck at 92%).
 */
function AssembleProgress() {
  const [pct, setPct] = useState(6);
  useEffect(() => {
    const id = setInterval(() => {
      setPct((p) => (p >= 92 ? p : p + Math.max(0.5, (92 - p) * 0.055)));
    }, 450);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="rounded-lg border border-gold-metal/25 bg-gold-metal/[0.06] px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-mono uppercase tracking-[0.16em] text-gold-metal">
          <Spinner />
          <T>Assembling the argument</T>
        </span>
        <span className="tabular-nums text-gold-metal">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gold-metal/15">
        <div
          className="h-full rounded-full bg-gold-metal transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-cream-100/45">
        <T>
          Reading the matter&apos;s evidence, drafting the argument, and citing exhibits. This can take up to a minute.
        </T>
      </p>
    </div>
  );
}

/** Console section label with a hairline lead-in. */
function ConsoleLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-gold-metal">
      {children}
    </p>
  );
}

/** A collapsible argument section: a console-label header that reveals content. */
function Collapsible({
  label,
  open,
  onToggle,
  children,
}: {
  label: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-cream-50/10 bg-forest-950/25">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-forest-950/45"
      >
        <span className="flex-1 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-gold-metal">
          {label}
        </span>
        <span
          aria-hidden
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold-metal text-forest-950 shadow-sm ring-1 ring-gold-300/40 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3.5">
          {children}
          <div className="mt-3 flex justify-center border-t border-cream-50/10 pt-3">
            <button
              type="button"
              onClick={onToggle}
              className="inline-flex items-center gap-1 rounded-full bg-gold-metal/[0.12] px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-gold-metal ring-1 ring-gold-metal/30 hover:bg-gold-metal/20"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M18 15l-6-6-6 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Collapse
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GeneratedArgument({
  g,
  firmId,
  caseId,
  approachId,
}: {
  g: ApproachArgument;
  firmId: string;
  caseId: string;
  approachId: string;
}) {
  const t = useT();
  // The cited evidence (resolved to the real uploads by exhibit label / title),
  // so each "Exhibits marshalled" row can show a live thumbnail and open the
  // full item in the viewer. Loaded once when the assembled argument mounts.
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [viewerIdx, setViewerIdx] = useState<number | null>(null);
  // Argument sections start COLLAPSED so the card is scannable; the reader opens
  // just what they want, or uses Expand all / Collapse all.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (k: string) =>
    setOpenSections((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  useEffect(() => {
    let on = true;
    getApproachEvidence(firmId, caseId, approachId)
      .then((res) => {
        if (on && res?.ok && res.events) setEvents(res.events);
      })
      .catch(() => {
        /* leave exhibits as text-only if the lookup fails */
      });
    return () => {
      on = false;
    };
  }, [firmId, caseId, approachId]);

  // Resolve an exhibit citation ({exhibit label, title}) to an index in `events`.
  const byLabel = new Map<string, number>();
  const byTitle = new Map<string, number>();
  events.forEach((e, i) => {
    const lbl = exhibitLabel(e.aiExtracted?.exhibit_no);
    if (lbl) byLabel.set(lbl.toUpperCase(), i);
    const ttl = (e.title ?? '').trim().toLowerCase();
    if (ttl && !byTitle.has(ttl)) byTitle.set(ttl, i);
  });
  const indexFor = (ex: { exhibit: string | null; title: string }): number | null => {
    if (ex.exhibit) {
      const i = byLabel.get(ex.exhibit.trim().toUpperCase());
      if (i != null) return i;
    }
    const ttl = (ex.title ?? '').trim();
    if (!ttl) return null;
    const exact = byTitle.get(ttl.toLowerCase());
    if (exact != null) return exact;
    // Fuzzy fallback: first cited item whose title fuzzily matches.
    for (let i = 0; i < events.length; i++) {
      if (fuzzyTitleMatch(ttl, events[i].title ?? '')) return i;
    }
    return null;
  };

  const sectionKeys = [
    g.thesis ? 'thesis' : null,
    g.argument ? 'argument' : null,
    (g.exhibits?.length ?? 0) > 0 ? 'exhibits' : null,
    (g.timeline?.length ?? 0) > 0 ? 'timeline' : null,
    (g.gaps?.length ?? 0) > 0 ? 'gaps' : null,
  ].filter(Boolean) as string[];
  const anyOpen = sectionKeys.some((k) => openSections.has(k));

  return (
    <div className="space-y-2.5 border-t border-cream-50/10 pt-4">
      {sectionKeys.length > 0 && (
        <div className="flex items-center justify-between">
          <ConsoleLabel><T>Assembled argument</T></ConsoleLabel>
          <button
            type="button"
            onClick={() => setOpenSections(anyOpen ? new Set() : new Set(sectionKeys))}
            className="mb-2 rounded-md px-2.5 py-1 text-[11px] font-medium text-gold-metal ring-1 ring-gold-metal/30 transition-colors hover:bg-gold-metal/10"
          >
            {anyOpen ? <T>Collapse all</T> : <T>Expand all</T>}
          </button>
        </div>
      )}
      {g.thesis && (
        <Collapsible label={<T>Thesis</T>} open={openSections.has('thesis')} onToggle={() => toggleSection('thesis')}>
          <p className="rounded-lg border border-gold-metal/20 bg-gold-metal/[0.06] px-3.5 py-3 text-[14px] font-medium leading-relaxed text-cream-50" data-no-translate>
            {g.thesis}
          </p>
        </Collapsible>
      )}

      {g.argument && (
        <Collapsible label={<T>Argument</T>} open={openSections.has('argument')} onToggle={() => toggleSection('argument')}>
          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-cream-100/85" data-no-translate>
            {g.argument}
          </p>
        </Collapsible>
      )}

      {(g.exhibits?.length ?? 0) > 0 && (
        <Collapsible label={<T>Exhibits marshalled</T>} open={openSections.has('exhibits')} onToggle={() => toggleSection('exhibits')}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {g.exhibits.map((ex, i) => {
              const idx = indexFor(ex);
              const ev = idx != null ? events[idx] : null;
              const inner = (
                <>
                  {ev ? (
                    <span className="h-14 w-14 shrink-0 overflow-hidden rounded-md ring-1 ring-cream-50/10">
                      <EvidencePreview firmId={firmId} caseId={caseId} event={ev} rounded="rounded-none" className="h-full w-full" />
                    </span>
                  ) : (
                    <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-md bg-forest-950/60 text-[16px] text-cream-100/25">
                      ▤
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {ex.exhibit && (
                        <span className="rounded bg-gold-metal px-1.5 py-0.5 font-mono text-[10px] font-semibold text-forest-950" data-no-translate>
                          {ex.exhibit}
                        </span>
                      )}
                      <span className="min-w-0 truncate text-[13px] font-medium text-cream-50" data-no-translate>
                        {ex.title}
                      </span>
                    </span>
                    {ex.why && (
                      <span className="mt-0.5 block text-[12px] leading-relaxed text-cream-100/60" data-no-translate>
                        {ex.why}
                      </span>
                    )}
                  </span>
                </>
              );
              return (
                // min-w-0: grid items default to min-width:auto, so the
                // truncate title's nowrap min-content was forcing the whole
                // row wider than the phone viewport (titles/desc bled off the
                // right edge). min-w-0 lets the row shrink so truncate + text
                // wrap work inside the card.
                <li key={i} className="min-w-0">
                  {idx != null ? (
                    <button
                      type="button"
                      onClick={() => setViewerIdx(idx)}
                      aria-label={`${t('Open')} ${ex.title || ex.exhibit || ''}`}
                      className="flex w-full items-start gap-2.5 rounded-lg bg-forest-950/40 p-2 text-left ring-1 ring-transparent transition-colors hover:bg-forest-950/70 hover:ring-gold-metal/30"
                    >
                      {inner}
                    </button>
                  ) : (
                    <div className="flex items-start gap-2.5 rounded-lg bg-forest-950/40 p-2">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </Collapsible>
      )}

      {(g.timeline?.length ?? 0) > 0 && (
        <Collapsible label={<T>Supporting timeline</T>} open={openSections.has('timeline')} onToggle={() => toggleSection('timeline')}>
          <TimelinePanel timeline={g.timeline} hideHeading />
        </Collapsible>
      )}

      {(g.gaps?.length ?? 0) > 0 && (
        <Collapsible label={<T>Gaps to close</T>} open={openSections.has('gaps')} onToggle={() => toggleSection('gaps')}>
          <ul className="space-y-1.5 text-[13px] text-cream-100/85">
            {g.gaps.map((gap, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden className="mt-[7px] h-1.5 w-1.5 flex-none rotate-45 bg-amber-400" />
                <span className="leading-relaxed" data-no-translate>{gap}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}

      {viewerIdx != null && events[viewerIdx] && (
        <EvidenceViewer
          firmId={firmId}
          caseId={caseId}
          event={events[viewerIdx]}
          index={viewerIdx}
          total={events.length}
          hasPrev={viewerIdx > 0}
          hasNext={viewerIdx < events.length - 1}
          onPrev={() => setViewerIdx((i) => (i != null && i > 0 ? i - 1 : i))}
          onNext={() => setViewerIdx((i) => (i != null && i < events.length - 1 ? i + 1 : i))}
          onClose={() => setViewerIdx(null)}
        />
      )}
    </div>
  );
}

type ApproachTimelineEntry = ApproachArgument['timeline'][number];

type ParsedWhen = {
  key: string;
  monthLabel: string;
  day: number | null;
  sortMs: number;
  relative: boolean;
};

/**
 * Best-effort parse of an approach timeline entry's free-text `when` ("March
 * 2024", "2024-03-15", "months prior") into a calendar bucket. Parseable dates
 * group by month; a day chip appears only when the text actually carried a day
 * number (so a bare "March 2024" isn't misrendered as the 1st). Anything the
 * model expressed relatively falls into a trailing "relative / undated" bucket.
 * The raw `when` string is always shown verbatim, so this never misstates it.
 */
function parseWhen(when: string | null | undefined): ParsedWhen {
  const raw = (when ?? '').trim();
  const monthOf = (d: Date) => formatMonthYear(d);
  const relative: ParsedWhen = { key: '~relative', monthLabel: '', day: null, sortMs: Number.POSITIVE_INFINITY, relative: true };
  if (!raw) return relative;

  // Explicit ISO-ish forms are parsed component-wise as LOCAL dates, so an
  // ISO "2024-03-15" isn't rolled back a day by the UTC-midnight/local-read
  // trap, and a bare year isn't mislabelled by it.
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw))) {
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return { key: `${m[1]}-${m[2]}`, monthLabel: monthOf(d), day: +m[3], sortMs: d.getTime(), relative: false };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(raw))) {
    const d = new Date(+m[1], +m[2] - 1, 1);
    return { key: `${m[1]}-${m[2]}`, monthLabel: monthOf(d), day: null, sortMs: d.getTime(), relative: false };
  }
  if ((m = /^(\d{4})$/.exec(raw))) {
    const d = new Date(+m[1], 0, 1);
    return { key: `${m[1]}-00`, monthLabel: m[1], day: null, sortMs: d.getTime(), relative: false };
  }

  // Worded dates ("March 2024", "March 15, 2024"): let Date parse them (these
  // parse as local, no UTC trap). A day chip only when the text carried a day.
  const ms = new Date(raw).getTime();
  if (!Number.isNaN(ms)) {
    const d = new Date(ms);
    const hasDay = /[A-Za-z]{3,}/.test(raw) && /\b(3[01]|[12]\d|0?[1-9])\b/.test(raw);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      monthLabel: monthOf(d),
      day: hasDay ? d.getDate() : null,
      sortMs: ms,
      relative: false,
    };
  }
  return relative;
}

/**
 * The approach's supporting timeline, as a List (vertical rail) or a Calendar
 * (month-grouped agenda). The calendar is the approach's OWN chronology, only
 * the events Advottic marshalled for this theory, grouped into month blocks in
 * chronological order, with day chips where the date is day-precise.
 */
function TimelinePanel({ timeline, hideHeading }: { timeline: ApproachTimelineEntry[]; hideHeading?: boolean }) {
  const t = useT();
  const [mode, setMode] = useState<'list' | 'calendar'>('list');

  const months = (() => {
    const groups: { key: string; label: string; relative: boolean; sortMs: number; items: { tl: ApproachTimelineEntry; day: number | null }[] }[] = [];
    const byKey = new Map<string, number>();
    timeline.forEach((tl) => {
      const p = parseWhen(tl.when);
      let gi = byKey.get(p.key);
      if (gi === undefined) {
        gi = groups.length;
        byKey.set(p.key, gi);
        groups.push({ key: p.key, label: p.monthLabel, relative: p.relative, sortMs: p.sortMs, items: [] });
      }
      groups[gi].items.push({ tl, day: p.day });
    });
    return groups.sort((a, b) => a.sortMs - b.sortMs);
  })();

  return (
    <div>
      <div className={`mb-2 flex items-center gap-2 ${hideHeading ? 'justify-end' : 'justify-between'}`}>
        {!hideHeading && <ConsoleLabel><T>Supporting timeline</T></ConsoleLabel>}
        <div className="inline-flex overflow-hidden rounded-md border border-cream-50/12 font-mono text-[10px] uppercase tracking-[0.14em]">
          {(['list', 'calendar'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`px-2.5 py-1 transition-colors ${
                mode === m
                  ? 'bg-gold-metal/20 text-gold-metal'
                  : 'text-cream-100/55 hover:text-cream-100'
              }`}
            >
              {m === 'list' ? <T>List</T> : <T>Calendar</T>}
            </button>
          ))}
        </div>
      </div>

      {mode === 'list' ? (
        <ol className="relative space-y-3 border-l border-gold-metal/25 pl-4">
          {timeline.map((tl, i) => (
            <li key={i} className="relative">
              <span
                aria-hidden
                className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-forest-900 bg-gold-metal"
                style={{ boxShadow: '0 0 10px 0 rgba(198,161,91,0.55)' }}
              />
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-gold-metal" data-no-translate>{tl.when}</p>
              <p className="text-[13.5px] font-medium text-cream-50" data-no-translate>{tl.title}</p>
              {tl.significance && (
                <p className="text-[13px] leading-relaxed text-cream-100/70" data-no-translate>{tl.significance}</p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-3">
          {months.map((mo) => (
            <div key={mo.key} className="rounded-lg border border-cream-50/10 bg-forest-950/40">
              <div className="flex items-center gap-2 border-b border-cream-50/10 px-3 py-1.5">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold-metal" />
                <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-gold-metal">
                  {mo.relative ? t('Relative / undated') : mo.label}
                </p>
                <span className="ml-auto font-mono text-[10px] text-cream-100/40">{mo.items.length}</span>
              </div>
              <ul className="divide-y divide-cream-50/[0.06]">
                {mo.items.map(({ tl, day }, i) => (
                  <li key={i} className="flex gap-3 px-3 py-2">
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md border font-mono leading-none ${
                        day != null
                          ? 'border-gold-metal/40 bg-gold-metal/10 text-gold-metal'
                          : 'border-cream-50/10 bg-forest-900/40 text-cream-100/40'
                      }`}
                    >
                      {day != null ? (
                        <span className="text-[14px] font-semibold">{day}</span>
                      ) : (
                        <span className="text-[13px]">◇</span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-gold-metal" data-no-translate>{tl.when}</p>
                      <p className="text-[13.5px] font-medium text-cream-50" data-no-translate>{tl.title}</p>
                      {tl.significance && (
                        <p className="text-[12.5px] leading-relaxed text-cream-100/70" data-no-translate>{tl.significance}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The real uploads this approach marshals: only the evidence Advottic cited
 * when assembling the argument. Lazy-loaded on expand (so a page of approaches
 * doesn't fetch every gallery up front); each thumbnail opens the in-window
 * evidence viewer with prev/next scoped to this approach's set.
 */
function ApproachEvidence({
  firmId,
  caseId,
  approachId,
}: {
  firmId: string;
  caseId: string;
  approachId: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      setLoading(true);
      try {
        const res = await getApproachEvidence(firmId, caseId, approachId);
        if (res?.ok && res.events) setEvents(res.events);
      } catch {
        /* leave the gallery empty; the argument still renders */
      }
      setLoaded(true);
      setLoading(false);
    }
  }

  const viewerEvent = viewerIndex != null ? events[viewerIndex] : undefined;

  return (
    <div className="border-t border-cream-50/10 pt-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em] text-gold-metal hover:text-gold-metal"
      >
        <span aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        <span aria-hidden className="h-px w-4 bg-gold-metal/40" />
        <T>Relevant uploads</T>
        {loaded && <span className="text-cream-100/40">({events.length})</span>}
      </button>

      {open && (
        <div className="mt-3">
          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-cream-100/55">
              <Spinner />
              <T>Gathering the cited evidence…</T>
            </div>
          ) : events.length === 0 ? (
            <p className="font-mono text-[11.5px] italic text-cream-100/45">
              <T>No uploads are cited by this approach yet. Re-run so Advottic marks the exhibits it relies on.</T>
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {events.map((e, i) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setViewerIndex(i)}
                  className="group relative overflow-hidden rounded-lg ring-1 ring-cream-50/10 transition-shadow hover:ring-gold-metal/40 hover:shadow-[0_0_16px_-6px_rgba(198,161,91,0.6)]"
                  aria-label={t('Open') + ' ' + (e.title || '')}
                >
                  <EvidencePreview firmId={firmId} caseId={caseId} event={e} rounded="rounded-none" className="h-24 w-full" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {viewerEvent && (
        <EvidenceViewer
          firmId={firmId}
          caseId={caseId}
          event={viewerEvent}
          index={viewerIndex as number}
          total={events.length}
          hasPrev={(viewerIndex as number) > 0}
          hasNext={(viewerIndex as number) < events.length - 1}
          onPrev={() => setViewerIndex((i) => (i != null && i > 0 ? i - 1 : i))}
          onNext={() => setViewerIndex((i) => (i != null && i < events.length - 1 ? i + 1 : i))}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}

/** Decorative corner brackets for the console panels. */
function RailButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-50 ${
        tone === 'danger'
          ? 'text-danger-text hover:bg-rose-500/10'
          : 'text-cream-100/60 hover:bg-cream-50/10 hover:text-cream-50'
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-gold-metal/30 border-t-gold-metal"
    />
  );
}
