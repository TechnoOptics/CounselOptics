import { scimJson } from '@/lib/scim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SCIM discovery: tells the IdP what we support. */
export async function GET() {
  return scimJson({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://advottic.com/enterprise',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Per-firm SCIM token issued in Advottic firm settings.',
        primary: true,
      },
    ],
  });
}
