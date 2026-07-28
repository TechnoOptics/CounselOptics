'use client';

import { useState, useTransition } from 'react';
import {
  assignIntakeAction,
  createIntakeUploadRequestAction,
  getIntakeFileUrlAction,
  inviteToIntakeAction,
  removeIntakeParticipantAction,
  revokeIntakeUploadRequestAction,
} from '@/lib/intake-conversation';
import {
  avatarTint,
  formatBytes,
  initialsOf,
  relativeTime,
  type IntakeDocument,
  type IntakeParticipant,
  type IntakePerson,
  type IntakeUploadRequest,
} from '@/lib/intake-conversation-types';

/**
 * The context rail beside the conversation: who owns the request, who else is
 * on it, every document tied to it, and the tokenized link the legal team
 * sends when they need a file back.
 */
export function IntakeWorkPanel({
  intakeId,
  canManage,
  assignee,
  participants,
  people,
  documents,
  uploadRequests,
  sections = ['people', 'documents', 'requests'],
  embedded = false,
}: {
  intakeId: string;
  canManage: boolean;
  assignee: IntakePerson | null;
  participants: IntakeParticipant[];
  people: IntakePerson[];
  documents: IntakeDocument[];
  uploadRequests: IntakeUploadRequest[];
  /** Which blocks to render, so the record pane and the rail can split them. */
  sections?: Array<'people' | 'documents' | 'requests'>;
  /** Inside a RecordSection: drop our own card chrome and headings. */
  embedded?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const legalPeople = people.filter((p) => p.side === 'legal');
  const invitable = people.filter((p) => !participants.some((x) => x.userId === p.userId));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'That did not work.');
    });
  }

  async function openDoc(path: string) {
    const res = await getIntakeFileUrlAction(intakeId, path);
    if (res.ok && res.url) window.open(res.url, '_blank', 'noopener,noreferrer');
    else setError(res.error ?? 'Could not open that file.');
  }

  function copy(url: string, id: string) {
    void navigator.clipboard?.writeText(url);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 2000);
  }

  const activeRequests = uploadRequests.filter((r) => !r.revokedAt);
  const card = embedded
    ? ''
    : 'rounded-2xl border border-ink-200 bg-white p-4 dark:border-forest-700/50 dark:bg-forest-900/40';
  const heading = 'mb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55';

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      {/* People */}
      {sections.includes('people') && (
      <section className={card}>
        {!embedded && <h2 className={heading}>People</h2>}

        <div className="mb-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-400 dark:text-cream-100/40">
            Owner
          </p>
          {canManage ? (
            <select
              value={assignee?.userId ?? ''}
              disabled={pending}
              onChange={(e) => run(() => assignIntakeAction(intakeId, e.target.value || null))}
              className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] text-forest-900 outline-none focus:border-gold-500/70 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100"
            >
              <option value="">Unassigned — anyone can pick this up</option>
              {legalPeople.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-[13px] text-forest-900 dark:text-cream-100">
              {assignee ? assignee.name : 'Not yet assigned'}
            </p>
          )}
        </div>

        <ul className="space-y-1.5">
          {participants.map((p) => (
            <li key={p.userId} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold ${avatarTint(
                  p.userId,
                )}`}
                aria-hidden
              >
                {initialsOf(p.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-forest-900 dark:text-cream-100">
                  {p.name}
                </span>
                <span className="block text-[11px] text-ink-400 dark:text-cream-100/40">
                  {p.side === 'legal' ? 'Legal team' : 'Requester'}
                </span>
              </span>
              {canManage && p.side === 'legal' && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeIntakeParticipantAction(intakeId, p.userId))}
                  className="text-[11px] text-ink-400 hover:text-rose-600 dark:text-cream-100/35"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>

        {canManage && (
          <div className="mt-3">
            {inviteOpen ? (
              <select
                autoFocus
                disabled={pending}
                defaultValue=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  const id = e.target.value;
                  setInviteOpen(false);
                  run(() => inviteToIntakeAction(intakeId, id));
                }}
                className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] text-forest-900 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100"
              >
                <option value="">Choose someone to add…</option>
                {invitable.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name} {p.side === 'legal' ? '· Legal' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="text-[12.5px] font-medium text-gold-700 hover:underline dark:text-gold-300"
              >
                + Add someone to this request
              </button>
            )}
          </div>
        )}
      </section>

      )}

      {/* Documents */}
      {sections.includes('documents') && (
      <section className={card}>
        {!embedded && <h2 className={heading}>Documents ({documents.length})</h2>}
        {documents.length === 0 ? (
          <p className="text-[12.5px] text-ink-400 dark:text-cream-100/40">
            Nothing attached yet. Files shared in the conversation land here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {documents.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => void openDoc(d.path)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-cream-50 dark:hover:bg-forest-800/40"
                >
                  <span aria-hidden className="mt-0.5">
                    📄
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-forest-900 dark:text-cream-100">
                      {d.name}
                    </span>
                    <span className="block text-[11px] text-ink-400 dark:text-cream-100/40">
                      {d.origin === 'filed' ? 'Filed with the request' : 'Shared in conversation'}
                      {d.size ? ` · ${formatBytes(d.size)}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      )}

      {/* Request a document */}
      {sections.includes('requests') && canManage && (
        <section className={embedded ? 'mt-5 border-t border-ink-100 pt-4 dark:border-forest-800/60' : card}>
          <h2 className={embedded ? 'mb-1 text-[12px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55' : 'mb-1 text-[13px] font-semibold uppercase tracking-wider text-ink-500 dark:text-cream-100/55'}>
            Ask for a document
          </h2>
          <p className="mb-3 text-[12px] text-ink-500 dark:text-cream-100/55">
            Sends a secure link. Whoever opens it can send the file straight into this request — no
            account needed.
          </p>

          {activeRequests.length > 0 && (
            <ul className="mb-3 space-y-2">
              {activeRequests.map((r) => {
                const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/send/${r.token}`;
                return (
                  <li
                    key={r.id}
                    className="rounded-lg border border-ink-100 bg-cream-50/60 px-3 py-2 dark:border-forest-800/60 dark:bg-forest-950/40"
                  >
                    <p className="text-[12.5px] font-medium text-forest-900 dark:text-cream-100">
                      {r.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-400 dark:text-cream-100/40">
                      {r.uploadCount > 0
                        ? `${r.uploadCount} file${r.uploadCount === 1 ? '' : 's'} received`
                        : 'Waiting'}{' '}
                      · asked {relativeTime(r.createdAt)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => copy(url, r.id)}
                        className="text-[11.5px] font-medium text-gold-700 hover:underline dark:text-gold-300"
                      >
                        {copied === r.id ? 'Copied' : 'Copy link'}
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => revokeIntakeUploadRequestAction(intakeId, r.id))}
                        className="text-[11.5px] text-ink-400 hover:text-rose-600 dark:text-cream-100/35"
                      >
                        Revoke
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {requestOpen ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="What do you need? e.g. the signed vendor NDA"
                className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] text-forest-900 outline-none focus:border-gold-500/70 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100"
              />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional note for whoever sends it"
                className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13px] text-forest-900 outline-none focus:border-gold-500/70 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pending || label.trim().length < 3}
                  onClick={() =>
                    run(async () => {
                      const res = await createIntakeUploadRequestAction(intakeId, {
                        label,
                        note,
                      });
                      if (res.ok) {
                        setLabel('');
                        setNote('');
                        setRequestOpen(false);
                      }
                      return res;
                    })
                  }
                  className="btn-primary !py-1.5 text-[12.5px] disabled:opacity-50"
                >
                  {pending ? 'Creating…' : 'Create link'}
                </button>
                <button
                  type="button"
                  onClick={() => setRequestOpen(false)}
                  className="rounded-lg border border-ink-200 px-3 py-1.5 text-[12.5px] text-forest-900 dark:border-forest-700/50 dark:text-cream-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setRequestOpen(true)}
              className="text-[12.5px] font-medium text-gold-700 hover:underline dark:text-gold-300"
            >
              + Request a document
            </button>
          )}
        </section>
      )}
    </div>
  );
}
