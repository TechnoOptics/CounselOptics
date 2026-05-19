# Microsoft 365 (Teams) connection setup

This is Azure portal + Vercel work. None of it is in Advottic's
code. Follow it once per environment.

## The error you keep seeing

`AADSTS7000215: Invalid client secret provided ... value, not the
client secret ID`

Microsoft is rejecting the `MICROSOFT_CLIENT_SECRET` value Advottic
sent. After this deploy, the connect screen will name the exact
cause. The cause is almost always one of these, in order of how
common it is:

1. **You pasted the Secret ID, not the Value.** In Azure, App
   registration, Certificates & secrets, the table has two columns:
   `Value` and `Secret ID`. The **Value** is shown only once, right
   after you click "New client secret". The `Secret ID` is a GUID
   (looks like `1a2b3c4d-...`). You must use the **Value**. If you
   missed it, delete the secret, create a new one, and copy the
   Value immediately.
2. **It was set in the wrong Vercel environment.** Vercel scopes
   env vars to Production / Preview / Development. The live site uses
   **Production**. Set `MICROSOFT_CLIENT_SECRET` (and
   `MICROSOFT_CLIENT_ID`) for **Production**.
3. **You did not redeploy.** Vercel env changes do NOT apply to
   already-built deployments. After editing the env var, trigger a
   new deployment (Deployments, redeploy, or push a commit).
4. **Trailing space or newline.** Pasting can append a newline.
   Re-paste with no spaces or line breaks.
5. **The secret expired**, or it belongs to a **different app** than
   `MICROSOFT_CLIENT_ID`. Create a fresh secret on the SAME app
   registration whose Application (client) ID is in
   `MICROSOFT_CLIENT_ID`.

## Full setup checklist

1. portal.azure.com, Microsoft Entra ID, App registrations, New
   registration (or open the existing app).
2. Authentication, Add a platform, Web, Redirect URI:
   `https://advottic.com/api/integrations/microsoft/callback`
   (add the localhost one too if you test locally).
3. API permissions: Microsoft Graph, delegated:
   `offline_access`, `User.Read`, `Calendars.ReadWrite`. Grant
   admin consent if your tenant requires it.
4. Certificates & secrets, New client secret. Copy the **Value**
   (not the Secret ID) right away.
5. Vercel, Project, Settings, Environment Variables, Production:
   - `MICROSOFT_CLIENT_ID` = Application (client) ID (a GUID)
   - `MICROSOFT_CLIENT_SECRET` = the secret **Value** from step 4
   - `INTEGRATION_ENCRYPTION_KEY` = `openssl rand -base64 32`
   - (optional) `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`
6. Redeploy.
7. In Advottic: Counsel, Meetings, Connect Microsoft 365.

## The "unverified" label and the app name

Both come from the Azure app registration, not Advottic.

- **Rename**: App registration, Branding & properties, Name ->
  `Advottic Enterprise`, Save. Updates on the next consent.
- **Remove "unverified"**: requires Microsoft Publisher
  Verification. Need a Microsoft AI Cloud Partner Program account
  with a Partner ID, verify your domain there, then App
  registration, Branding & properties, set the Publisher domain and
  complete the verify/add MPN ID flow. Until then Microsoft shows
  "unverified". It is a trust label only and does not block the
  connection.
