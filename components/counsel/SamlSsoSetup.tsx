'use client';

import { useState } from 'react';
import { T } from '@/components/i18n/LocaleProvider';

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

      <div className="rounded-lg ring-1 ring-edge bg-surface-2 p-4">
        <p className="text-[12px] font-semibold text-foreground">
          <T>Finish setup with Advottic (one-time, per IdP)</T>
        </p>
        <p className="text-[12px] text-muted mt-1 leading-relaxed">
          <T>
            The last step, registering the connection, happens on
            Advottic&rsquo;s side, not in your own console. After you create the
            app in your IdP,
          </T>{' '}
          <a href="/counsel/help" className="underline font-medium">
            <T>open a request with Advottic</T>
          </a>{' '}
          <T>and include your</T> <strong><T>IdP metadata URL</T></strong>{' '}
          <T>and your</T>{' '}
          <strong><T>verified email domain</T></strong>{' '}
          <T>
            (the two fields above). We register it, usually within one business
            day, and email you when it&rsquo;s live.
          </T>
        </p>
        <p className="text-[11px] text-muted mt-2 leading-relaxed">
          <T>
            For reference, that registration is a single Supabase Auth command
            run by Advottic:
          </T>
        </p>
        <CopyField
          label=""
          mono
          value={
            '# run by Advottic, not in your console\nsupabase sso add --type saml \\\n  --metadata-url <YOUR_IDP_METADATA_URL> \\\n  --domains yourcompany.com'
          }
        />
        <p className="text-[12px] text-muted mt-2 leading-relaxed">
          <T>Once we confirm the connection is live, the</T>{' '}
          <strong>
            <T>&ldquo;Sign in with your organization (SSO)&rdquo;</T>
          </strong>{' '}
          <T>
            option on the sign-in page works for anyone with an email on that
            domain. Pair it with SCIM below so people are also added to and
            removed from your firm directory automatically.
          </T>
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
        <p className="text-[11px] font-semibold text-foreground mb-1">
          <T>{label}</T>
        </p>
      )}
      <div className="flex items-stretch gap-2">
        <code
          className={`flex-1 min-w-0 rounded-md ring-1 ring-edge bg-surface px-3 py-2 text-[12px] text-foreground overflow-x-auto ${
            mono ? 'whitespace-pre' : 'break-all'
          }`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 min-h-[40px] rounded-md ring-1 ring-edge px-3 text-[12px] text-foreground hover:bg-surface-2"
        >
          {copied ? <T>Copied</T> : <T>Copy</T>}
        </button>
      </div>
      {hint && (
        <p className="text-[11px] text-muted mt-1">
          <T>{hint}</T>
        </p>
      )}
    </div>
  );
}
