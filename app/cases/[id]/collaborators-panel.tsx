'use client';

import { useState, useTransition } from 'react';
import {
  inviteCollaboratorAction,
  removeCollaboratorAction,
} from '@/lib/actions';
import {
  COLLABORATOR_ROLE_LABEL,
  type Collaborator,
  type CollaboratorRole,
} from '@/lib/types';

export function CollaboratorsPanel({
  caseId,
  collaborators,
  isOwner,
}: {
  caseId: string;
  collaborators: Collaborator[];
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  function invite(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await inviteCollaboratorAction(caseId, formData);
        setShowForm(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invite failed.');
      }
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeCollaboratorAction(caseId, id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Remove failed.');
      }
    });
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-forest-900">Collaborators</h2>
          <p className="text-sm text-ink-500 mt-0.5">
            {collaborators.length === 0
              ? 'Invite your attorney, co-counsel, or trusted party to view this case.'
              : `${collaborators.length} collaborator${collaborators.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {isOwner && (
          <button
            onClick={() => setShowForm((s) => !s)}
            className={showForm ? 'btn-secondary' : 'btn-primary'}
          >
            {showForm ? 'Cancel' : 'Invite collaborator'}
          </button>
        )}
      </header>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {showForm && isOwner && (
        <form action={invite} className="card p-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px]">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                placeholder="lawyer@example.com"
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="role">
                Role
              </label>
              <select id="role" name="role" defaultValue="attorney" className="input">
                <option value="attorney">Attorney</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-ink-500">
            If they already have a CounselOptics account, they get access immediately. Otherwise
            their invite is held until they sign up with that email.
          </p>
          <div className="flex justify-end">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      )}

      {collaborators.length > 0 && (
        <ul className="card divide-y divide-ink-100 overflow-hidden">
          {collaborators.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink-950 text-sm truncate">{c.email}</span>
                  <span className="badge bg-forest-50 text-forest-900 border border-forest-200">
                    {COLLABORATOR_ROLE_LABEL[c.role]}
                  </span>
                  {c.acceptedAt ? (
                    <span className="badge bg-emerald-50 text-emerald-800 border border-emerald-200">
                      Active
                    </span>
                  ) : (
                    <span className="badge bg-amber-50 text-amber-900 border border-amber-200">
                      Pending signup
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-500 mt-1">
                  Invited {new Date(c.invitedAt).toLocaleDateString()}
                  {c.acceptedAt && ` · joined ${new Date(c.acceptedAt).toLocaleDateString()}`}
                </p>
              </div>
              {isOwner && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={pending}
                  className="text-xs text-rose-700 hover:text-rose-900 underline"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
