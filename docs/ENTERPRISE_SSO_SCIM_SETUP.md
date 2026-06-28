# Enterprise SSO + SCIM setup

This is the runbook for connecting a firm's identity provider (IdP) to
Advottic. Two separate features, set up independently:

- **SSO** lets people sign in with their organization's credentials
  (Microsoft Entra ID, Okta, Google Workspace via SAML). No new
  password.
- **SCIM** provisions and deprovisions the firm directory
  automatically: when someone joins or leaves in the IdP, their record
  in Advottic keeps pace without anyone touching the app.

You can run either one alone. SSO controls *who can sign in*; SCIM
keeps the *directory roster* in sync. Most firms want both.

Both are admin work in the IdP plus a few minutes in Advottic. None of
the IdP-side steps are in Advottic's code.

---

## Part 1 - SSO (SAML)

### What Advottic does

The sign-in page shows **"Sign in with your organization (SSO)"**. The
user types their work email; Advottic reads the domain (everything
after the `@`) and calls Supabase Auth's `signInWithSSO({ domain })`,
which redirects to the matching SAML connection. If no connection is
registered for that domain, the user sees a calm "no SSO is set up for
your organization yet" message and can fall back to the normal
sign-in. There is nothing to break for firms that don't use SSO.

### Prerequisites

- A Supabase plan that includes SAML SSO (Pro with the SSO add-on, or
  Team/Enterprise). SAML is **not** available on the free plan.
- Owner access to the firm's IdP (Entra ID, Okta, etc.).

### Endpoints the IdP needs (Supabase ACS)

These come from the Advottic Supabase project, not from advottic.com:

| Field | Value |
| --- | --- |
| ACS URL (Reply URL) | `https://<project-ref>.supabase.co/auth/v1/sso/saml/acs` |
| Entity ID / Audience | `https://<project-ref>.supabase.co/auth/v1/sso/saml/metadata` |
| Metadata URL | `https://<project-ref>.supabase.co/auth/v1/sso/saml/metadata` |

The current project ref is `hpmtlhpyvbreyfimftgt`, so the ACS URL is
`https://hpmtlhpyvbreyfimftgt.supabase.co/auth/v1/sso/saml/acs`.
Confirm the ref in the Supabase dashboard before sending it to a firm,
in case the project moves.

### Steps

1. **In the IdP**, create a new SAML application ("Advottic").
   - Set the ACS / Reply URL and Entity ID from the table above.
   - Map the email claim to the standard
     `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`
     (Entra) or the equivalent NameID = email (Okta). Email is the
     only required attribute; `givenName` / `surname` improve the
     display name.
   - Download the IdP's **metadata XML** (or copy the metadata URL).

2. **Register the connection with Supabase.** This is a one-time admin
   call per firm domain. Using the Supabase CLI / Management API:

   ```bash
   # Metadata URL form (preferred - auto-refreshes signing certs):
   supabase sso add --project-ref hpmtlhpyvbreyfimftgt \
     --type saml \
     --metadata-url "https://<idp-metadata-url>" \
     --domains firm.com
   ```

   Use `--metadata-file ./idp-metadata.xml` if the IdP only exports a
   file. The `--domains` value must match the email domain users will
   type (add every domain the firm signs in with).

3. **Verify.** Go to advottic.com/sign-in, choose "Sign in with your
   organization", enter an address at that domain. You should bounce to
   the IdP and back, signed in.

### Troubleshooting SSO

- **"No SSO is set up for your organization yet."** The typed domain
  doesn't match any `--domains` on a registered connection. Check for
  a typo or a missing domain (e.g. you registered `firm.com` but the
  user typed `mail.firm.com`).
- **Redirect loops or "invalid SAML response".** The ACS URL in the
  IdP doesn't exactly match Supabase's, or the IdP isn't sending email
  as NameID. Re-check both.
- **Works for some users, not others.** Those users aren't assigned to
  the SAML app in the IdP. Assignment is an IdP-side setting.

---

## Part 2 - SCIM provisioning

### What Advottic does

Advottic exposes a SCIM 2.0 service at **`/api/scim/v2`**. A SCIM
"User" maps to a row in the firm's directory (`firm_employees`):

- **Create** -> inserts the employee (`source = 'scim'`).
- **Update / PUT / PATCH** -> updates display name, external id, and
  the active flag.
- **Deactivate** (`active: false`) **or DELETE** -> soft-deprovision:
  the row is kept for audit and `deactivated_at` is set. Re-provisioning
  the same email reactivates the existing row rather than duplicating
  it.

Tokens are per-firm and stored only as a SHA-256 hash. The plaintext
is shown once, at creation.

### Endpoints

| SCIM resource | URL |
| --- | --- |
| Tenant URL (base) | `https://advottic.com/api/scim/v2` |
| Discovery | `https://advottic.com/api/scim/v2/ServiceProviderConfig` |
| Users | `https://advottic.com/api/scim/v2/Users` |

Supported: pagination (`startIndex` / `count`), the
`userName eq "..."` filter IdPs use to check existence before
creating, PATCH (the `active` toggle), and soft-delete. Not supported:
Groups, bulk operations, password change.

### Steps

1. **In Advottic**, sign in as a firm **owner or admin** and go to
   **Firm settings -> Set up SCIM provisioning**
   (`/counsel/settings/scim`).
   - Copy the **SCIM base URL** (the Tenant URL).
   - Click **Generate token** and copy the secret immediately - it is
     shown only once. Generating again rotates; the previous token
     keeps working until it's removed, so you can roll without an
     outage.

2. **In the IdP's provisioning settings:**
   - **Microsoft Entra ID:** the enterprise app -> Provisioning ->
     Automatic. Paste the base URL into **Tenant URL** and the token
     into **Secret Token**. Click **Test Connection** (Entra calls
     `/ServiceProviderConfig` and a `userName` filter; both should
     succeed), then Save, then start provisioning.
   - **Okta:** the app -> Provisioning -> Configure API Integration ->
     Enable. Paste the base URL as **SCIM connector base URL** and the
     token as the **OAuth Bearer Token / API token**. Set "Import
     Groups" off (Groups aren't supported). Enable Create / Update /
     Deactivate.

3. **Attribute mapping.** The defaults work; the only required field is
   `userName` mapped to the user's email. Advottic also reads:

   | SCIM attribute | Advottic field |
   | --- | --- |
   | `userName` | email (required, the match key) |
   | `displayName` / `name.formatted` | display name |
   | `externalId` | external id (the IdP's stable user id) |
   | `active` | `false` -> soft-deprovision |

4. **Verify.** Assign a test user to the app in the IdP and let it
   provision. They should appear in the firm directory. Unassign them;
   the row should flip to deactivated (not vanish).

### Troubleshooting SCIM

- **Test Connection fails with 401.** The Tenant URL is right but the
  token is wrong, expired, or has a trailing space/newline. Generate a
  fresh token in Advottic and paste it cleanly.
- **Test Connection fails with 404 / HTML response.** The Tenant URL
  is wrong (e.g. missing `/api/scim/v2`, or pointing at a preview
  deployment). Use exactly `https://advottic.com/api/scim/v2`.
- **Users provision into the wrong firm.** Each token is scoped to one
  firm. A token generated by Firm A's admin only ever writes to Firm
  A. If users land in the wrong place, the IdP is using the wrong
  firm's token.
- **Deactivated users still appear.** That's intentional - deprovision
  is a soft delete so the audit trail survives. The row's `active` flag
  is `false`; it's filtered out of active rosters.

---

## Who can do what

- **Firm owner / admin:** issues and rotates SCIM tokens; is the
  point of contact for the IdP-side SSO registration.
- **Advottic operator:** registers each firm's SAML connection with
  Supabase (`supabase sso add ...`), since that's a project-level call.
- **No one** can read a stored SCIM token back out - only its hash is
  kept. If a token is lost, generate a new one.
