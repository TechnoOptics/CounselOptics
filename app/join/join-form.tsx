'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { requestWorkspaceAccessAction } from '@/lib/access-actions';

type Outcome =
  | { ok: true; kind: 'internal' | 'external' | 'existing'; message: string }
  | { ok: false; error: string };

export function JoinForm({
  defaultSlug,
  firmName,
  lockedSlug,
}: {
  defaultSlug: string;
  firmName: string | null;
  lockedSlug: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Outcome | null>(null);

  function submit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const res = await requestWorkspaceAccessAction(formData);
      setResult(res);
    });
  }

  if (result && result.ok) {
    const isExternal = result.kind === 'external';
    return (
      <div className="space-y-4">
        <div
          className={`rounded-xl p-5 ring-1 ${
            isExternal
              ? 'ring-amber-700/40 bg-amber-950/25'
              : 'ring-emerald-700/40 bg-emerald-950/25'
          }`}
        >
          <p
            className={`font-display text-lg ${
              isExternal ? 'text-amber-200' : 'text-emerald-200'
            }`}
          >
            {isExternal ? 'Request sent' : "You're all set"}
          </p>
          <p className="text-[13px] text-cream-100/80 mt-1.5 leading-relaxed">
            {result.message}
          </p>
        </div>
        {!isExternal && (
          <Link
            href="/sign-in?next=/portal"
            className="btn w-full bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold justify-center"
          >
            Sign in to your hub
          </Link>
        )}
        {isExternal && (
          <p className="text-[12px] text-cream-100/55 text-center">
            You can close this page - we&rsquo;ll email you the moment
            it&rsquo;s reviewed.
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-3.5">
      <label className="block">
        <span className="block text-[12px] font-medium text-cream-100/85 mb-1">
          Full name
        </span>
        <input
          name="fullName"
          required
          autoComplete="name"
          placeholder="Jordan Rivera"
          disabled={pending}
          className="input"
        />
      </label>
      <label className="block">
        <span className="block text-[12px] font-medium text-cream-100/85 mb-1">
          Work email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@company.com"
          disabled={pending}
          className="input"
        />
      </label>
      <label className="block">
        <span className="block text-[12px] font-medium text-cream-100/85 mb-1">
          Organization {lockedSlug ? '' : 'code'}
        </span>
        {lockedSlug ? (
          <>
            <input type="hidden" name="firmSlug" value={defaultSlug} />
            <div className="input flex items-center text-cream-100/70 cursor-not-allowed select-none">
              {firmName ?? defaultSlug}
            </div>
          </>
        ) : (
          <input
            name="firmSlug"
            required
            defaultValue={defaultSlug}
            placeholder="your-organization"
            disabled={pending}
            className="input"
          />
        )}
      </label>

      {result && !result.ok && (
        <p className="rounded-lg ring-1 ring-rose-700/40 bg-rose-950/30 px-3 py-2 text-[12.5px] text-rose-200">
          {result.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn w-full bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold justify-center disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Continue'}
      </button>
    </form>
  );
}
