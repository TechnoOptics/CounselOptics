'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadContractAction } from '@/lib/contracts-actions';
import {
  CONTRACT_TYPES,
  CONTRACT_GROUPS,
  type ContractType,
} from '@/lib/contract-types';

const GROUPED = (() => {
  const map = new Map<ContractType['group'], ContractType[]>();
  for (const t of CONTRACT_TYPES) {
    if (!map.has(t.group)) map.set(t.group, []);
    map.get(t.group)!.push(t);
  }
  return Array.from(map.entries());
})();

export function ContractUploadForm({
  firmId = null,
  redirectAfter = '/contracts',
}: {
  firmId?: string | null;
  redirectAfter?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [contractType, setContractType] = useState('');
  const [fileName, setFileName] = useState('');

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await uploadContractAction(formData, { firmId });
      if (res.ok && res.contractId) {
        const base = firmId ? '/counsel/contracts' : '/contracts';
        router.push(`${base}/${res.contractId}`);
      } else {
        setError(res.error ?? 'Upload failed.');
      }
    });
  }

  return (
    <form action={submit} className="card p-5 sm:p-6 space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Display name
          </span>
          <input
            name="name"
            placeholder="ACME NDA - 2026"
            className="input"
            required
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Contract type
          </span>
          <select
            name="contractType"
            value={contractType}
            onChange={(e) => setContractType(e.target.value)}
            className="input"
            required
          >
            <option value="" disabled>
              Pick a type...
            </option>
            {GROUPED.map(([group, types]) => (
              <optgroup
                key={group}
                label={CONTRACT_GROUPS[group as ContractType['group']]}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {contractType === 'other' && (
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Custom type
          </span>
          <input
            name="customType"
            placeholder="What kind of document is this?"
            className="input"
            required
          />
        </label>
      )}

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          File{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">
            (optional - up to 50 MB)
          </span>
        </span>
        <label
          htmlFor="contract-file"
          className="btn-secondary cursor-pointer inline-flex"
        >
          Choose file
        </label>
        <span className="ml-3 text-sm text-ink-500 dark:text-cream-100/55 truncate">
          {fileName || 'No file selected'}
        </span>
        <input
          id="contract-file"
          name="file"
          type="file"
          className="sr-only"
          onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? '')}
        />
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Parties{' '}
            <span className="text-ink-400 dark:text-cream-100/45 font-normal">
              (comma-separated)
            </span>
          </span>
          <input
            name="parties"
            placeholder="ACME Inc., John Doe"
            className="input"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Jurisdiction
          </span>
          <input
            name="jurisdiction"
            placeholder="Delaware / California / ..."
            className="input"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Signed on
          </span>
          <input name="signedAt" type="date" className="input" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
            Expires on
          </span>
          <input name="expiryAt" type="date" className="input" />
        </label>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Tags{' '}
          <span className="text-ink-400 dark:text-cream-100/45 font-normal">
            (comma-separated)
          </span>
        </span>
        <input
          name="tags"
          placeholder="vendor, draft, opposing-counsel-acme"
          className="input"
        />
      </label>

      <label className="block">
        <span className="block text-sm font-medium text-forest-900 dark:text-cream-100 mb-1.5">
          Notes for Bella (optional)
        </span>
        <textarea
          name="notes"
          rows={2}
          placeholder="Anything Bella should know when reviewing - eg. 'I am the contractor; they sent this their template, I haven't signed yet.'"
          className="input"
        />
      </label>

      {error && (
        <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? 'Saving...' : 'Save to library'}
        </button>
      </div>
      <p className="text-[11px] text-ink-500 dark:text-cream-100/55">
        Files are stored in your private vault. After saving, you&rsquo;ll
        see options to run a Bella review or just file it for later.
      </p>
    </form>
  );
}
