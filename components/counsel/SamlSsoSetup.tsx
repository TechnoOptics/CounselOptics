'use client';

import { useState } from 'react';

/**
 * SAML SSO setup reference (#11). SCIM (provisioning) and the sign-in
 * `signInWithSSO` flow already exist; the only remaining step to turn
 * SSO on for a firm is registering their IdP with Supabase Auth using
 * these service-provider (SP) values. This panel surfaces the exact
 * URLs an admin gives their IdP (Entra, Okta, ...) plus the CLI command
 * to register the connection - so the config step is self-serve.
 *
 * All values are derived from the project's public Supabase URL; no
 * secrets are shown here.
 */
export function SamlSsoSetup({
  acsUrl,
  metadataUrl,
  entityId,
}: {
  acsUrl: string;
  metadataUrl: string;
  entityId: string;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        <CopyField
          label="ACS (Assertion Consumer Service) URL"
          value={acsUrl}
          hint="Also called the SAML Reply URL / Single Sign-On URL in your IdP."
        />
        <CopyField
          label="SP Entity ID / Audience"
          value={entityId}
          hint="The Identifier / Audience URI your IdP expects."
        />
        <CopyField
          label="SP metadata URL"
          value={metadataUrl}
          hint="Some IdPs can import all of the above from this one URL."
        />
      </div>

      <div className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/50 dark:bg-forest-900/30 p-4">
        <p className="text-[12px] font-semibold text-forest-900 dark:text-cream-100">
          Finish setup with Advottic (one-time, per IdP)
        </p>
        <p className="text-[12px] text-ink-600 dark:text-cream-100/70 mt-1 leading-relaxed">
          The last step, registering the connection, happens on Advottic&rsquo;s
          side, not in your own console. After you create the app in your IdP,{' '}
          <a href="/counsel/help" className="underline font-medium">
            open a request with Advottic
          </a>{' '}
          and include your <strong>IdP metadata URL</strong> and your{' '}
          <strong>verified email domain</strong> (the two fields above). We
          register it, usually within one business day, and email you when it&rsquo;s
          live.
        </p>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-2 leading-relaxed">
          For reference, that registration is a single Supabase Auth command run
          by Advottic:
        </p>
        <CopyField
          label=""
          mono
          value={
            '# run by Advottic, not in your console\nsupabase sso add --type saml \\\n  --metadata-url <YOUR_IDP_METADATA_URL> \\\n  --domains yourcompany.com'
          }
        />
        <p className="text-[12px] text-ink-600 dark:text-cream-100/70 mt-2 leading-relaxed">
          Once we confirm the connection is live, the{' '}
          <strong>&ldquo;Sign in with your organization (SSO)&rdquo;</strong>{' '}
          option on the sign-in page works for anyone with an email on that
          domain. Pair it with SCIM below so people are also added to and removed
          from your firm directory automatically.
        </p>
      </div>
    </div>
  );
}

function CopyField({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  }
  return (
    <div>
      {label && (
        <p className="text-[11px] font-semibold text-forest-900 dark:text-cream-100 mb-1">
          {label}
        </p>
      )}
      <div className="flex items-stretch gap-2">
        <code
          className={`flex-1 min-w-0 rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-950 px-3 py-2 text-[12px] text-ink-800 dark:text-cream-100/85 overflow-x-auto ${
            mono ? 'whitespace-pre' : 'break-all'
          }`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 min-h-[40px] rounded-md ring-1 ring-ink-200 dark:ring-forest-700/40 px-3 text-[12px] text-ink-700 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/40"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {hint && (
        <p className="text-[11px] text-ink-500 dark:text-cream-100/55 mt-1">
          {hint}
        </p>
      )}
    </div>
  );
}
