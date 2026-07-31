'use client';

import { useState } from 'react';
import { submitUploadRequestAction } from '@/lib/intake-upload-public';
import { formatBytes } from '@/lib/intake-conversation-types';

export function SendForm({ token, remaining }: { token: string; remaining: number }) {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(0);

  if (done > 0) {
    return (
      <div className="rounded-2xl border border-emerald-300/50 bg-emerald-50 p-6 text-center dark:border-emerald-700/40 dark:bg-emerald-950/30">
        <p className="text-2xl" aria-hidden>
          ✓
        </p>
        <p className="mt-2 font-display text-lg text-forest-900 dark:text-cream-100">
          Sent. Thank you.
        </p>
        <p className="mt-1 text-[13.5px] text-ink-600 dark:text-cream-100/70">
          {done} file{done === 1 ? '' : 's'} went straight to the legal team. You can close this page.
        </p>
      </div>
    );
  }

  async function submit() {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      if (name.trim()) fd.set('senderName', name.trim());
      const res = await submitUploadRequestAction(token, fd);
      if (!res.ok) {
        setError(res.error ?? 'Could not send that.');
        return;
      }
      setDone(res.count ?? files.length);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-[13px] font-medium text-forest-900 dark:text-cream-100">
          Your name
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="So the team knows who sent it"
          className="w-full rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] text-forest-900 outline-none focus:border-gold-500/70 focus:ring-2 focus:ring-gold-500/25 dark:border-forest-700/50 dark:bg-forest-900/60 dark:text-cream-100"
        />
      </label>

      <label className="block cursor-pointer rounded-xl border-2 border-dashed border-ink-200 px-4 py-8 text-center hover:border-gold-500/60 dark:border-forest-700/50">
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []).slice(0, remaining);
            setFiles(picked);
            setError(null);
          }}
        />
        <span className="block text-2xl" aria-hidden>
          📎
        </span>
        <span className="mt-2 block text-[14px] font-medium text-forest-900 dark:text-cream-100">
          Choose file{remaining > 1 ? 's' : ''}
        </span>
        <span className="mt-0.5 block text-[12.5px] text-ink-500 dark:text-cream-100/55">
          Up to {remaining} file{remaining === 1 ? '' : 's'}, 25 MB each
        </span>
      </label>

      {files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.name}
              className="flex items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-[13px] text-forest-900 dark:border-forest-700/50 dark:text-cream-100"
            >
              <span aria-hidden>📄</span>
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-ink-400 dark:text-cream-100/40">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </p>
      )}

      <button
        type="button"
        disabled={busy || files.length === 0}
        onClick={() => void submit()}
        className="btn-primary w-full disabled:opacity-50"
      >
        {busy ? 'Sending securely…' : 'Send to the legal team'}
      </button>

      <p className="text-center text-[11.5px] text-ink-400 dark:text-cream-100/40">
        This link is private and expires. Files go only to the legal team handling this request.
      </p>
    </div>
  );
}
