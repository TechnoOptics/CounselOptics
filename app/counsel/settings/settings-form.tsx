'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateFirmAction } from '@/lib/firm-actions';
import { LogoUploader } from './logo-uploader';
import { LetterheadUploader } from './letterhead-uploader';
import { LetterheadDesigner } from './letterhead-designer';
import type { LetterheadDesign } from '@/lib/letterhead-design';
import { T, useT } from '@/components/i18n/LocaleProvider';

export function SettingsForm({
  firmId,
  letterheadDesign,
  defaultValues,
}: {
  firmId: string;
  /** The designed letterhead, already normalized on the server. */
  letterheadDesign: LetterheadDesign | null;
  defaultValues: {
    name: string;
    accentColor: string;
    logoUrl: string;
    letterheadUrl: string;
    jurisdictions: string[];
    practiceAreas: string[];
    hideAdvotticLogo: boolean;
    brandName: string;
    portalTagline: string;
  };
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  // The firm has a logo if one is stored; the uploader manages it
  // separately and refreshes the page, so this is read-only here.
  const hasLogo = Boolean(defaultValues.logoUrl.trim());

  function submit(formData: FormData) {
    setError(null);
    setOk(false);
    startTransition(async () => {
      const res = await updateFirmAction(firmId, formData);
      if (res.ok) {
        setOk(true);
        router.refresh();
      } else {
        setError(res.error ?? t('Could not save.'));
      }
    });
  }

  return (
    /* No card: the settings page wraps this in a PanelCard. */
    <div className="space-y-6">
      <LogoUploader firmId={firmId} currentUrl={defaultValues.logoUrl} />
      <LetterheadUploader
        firmId={firmId}
        currentUrl={defaultValues.letterheadUrl}
      />

      <div className="pt-2 border-t border-edge space-y-4">
        <p className="text-[12.5px] text-muted leading-relaxed max-w-2xl">
          <T>
            You can upload a letterhead image above, design one below, or do
            both. If you have both, the uploaded image is the one Advottic
            prints.
          </T>
        </p>
        <LetterheadDesigner firmId={firmId} initial={letterheadDesign} />
      </div>

      <form action={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="name">
            <T>Firm name</T>
          </label>
          <input
            id="name"
            name="name"
            required
            defaultValue={defaultValues.name}
            className="input"
            maxLength={120}
            disabled={pending}
          />
        </div>

        <div>
          <label className="label" htmlFor="brandName">
            <T>Product name</T>{' '}
            <span className="text-muted font-normal">
              <T>(shown in the header + footer)</T>
            </span>
          </label>
          <input
            id="brandName"
            name="brandName"
            defaultValue={defaultValues.brandName || 'Advottic Enterprise'}
            className="input"
            maxLength={48}
            placeholder="Advottic Enterprise"
            disabled={pending}
          />
        </div>

        <div>
          <label className="label" htmlFor="portalTagline">
            <T>Employee portal tagline</T>{' '}
            <span className="text-muted font-normal">
              <T>(optional)</T>
            </span>
          </label>
          <input
            id="portalTagline"
            name="portalTagline"
            defaultValue={defaultValues.portalTagline}
            className="input"
            maxLength={160}
            placeholder={t('How can legal help you today?')}
            disabled={pending}
          />
        </div>

        <div className="grid sm:grid-cols-[1fr,auto] gap-3 items-end">
          <div>
            <label className="label" htmlFor="accentColor">
              <T>Accent color (hex)</T>
            </label>
            <input
              id="accentColor"
              name="accentColor"
              defaultValue={defaultValues.accentColor}
              className="input"
              maxLength={7}
              placeholder="#0f2d24"
              disabled={pending}
            />
          </div>
          <span
            className="h-10 w-10 rounded-md ring-1 ring-edge"
            style={{ backgroundColor: defaultValues.accentColor }}
            aria-hidden
          />
        </div>

        {/* White-label: drop the Advottic mark and lead with the firm's
            own logo. Gated on having a logo so the header always has an
            identity. */}
        <label
          className={`flex items-start gap-3 rounded-lg ring-1 p-3.5 transition-colors ${
            hasLogo
              ? 'ring-edge'
              : 'ring-ink-100 dark:ring-forest-700/30 opacity-60'
          }`}
        >
          <input
            type="checkbox"
            name="hideAdvotticLogo"
            defaultChecked={defaultValues.hideAdvotticLogo}
            disabled={pending || !hasLogo}
            className="mt-0.5 h-4 w-4 flex-none accent-gold-500"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              <T>Use only our logo (hide the Advottic logo)</T>
            </span>
            <span className="block text-[12px] text-muted mt-0.5 leading-relaxed">
              {hasLogo ? (
                <T>
                  The header and portal lead with your logo and name. The
                  Advottic wordmark and &quot;powered by&quot; mark are removed
                  for everyone in your workspace.
                </T>
              ) : (
                <T>Upload a logo above to enable full white-label branding.</T>
              )}
            </span>
          </span>
        </label>

        <div>
          <label className="label" htmlFor="jurisdictions">
            <T>Jurisdictions</T>{' '}
            <span className="text-muted font-normal">
              <T>(comma-separated)</T>
            </span>
          </label>
          <input
            id="jurisdictions"
            name="jurisdictions"
            defaultValue={defaultValues.jurisdictions.join(', ')}
            className="input"
            disabled={pending}
          />
        </div>
        <div>
          <label className="label" htmlFor="practiceAreas">
            <T>Practice areas</T>{' '}
            <span className="text-muted font-normal">
              <T>(comma-separated)</T>
            </span>
          </label>
          <input
            id="practiceAreas"
            name="practiceAreas"
            defaultValue={defaultValues.practiceAreas.join(', ')}
            className="input"
            disabled={pending}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? <T>Saving...</T> : <T>Save changes</T>}
          </button>
        </div>
        {error && (
          <p className="rounded-lg border border-rose-200 dark:border-rose-700/40 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
            {error}
          </p>
        )}
        {ok && (
          <p className="rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-sm text-emerald-900 dark:text-emerald-100">
            <T>Saved.</T>
          </p>
        )}
      </form>
    </div>
  );
}
