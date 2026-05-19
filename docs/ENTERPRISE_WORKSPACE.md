# Enterprise workspace: employee portal + legal department app

Status: design. Tier 1 (typed intake + notifications) shipped in
`73e4b7e`. Tiers 2 and 3 below are scoped here because they need the
customer's IT (directory, SSO, storage) and a security review. They
cannot be improvised in app code alone.

Driving requirement (Zinpro, paraphrased): one Advottic tenant where
the in-house legal department gets the full Counsel app, and every
other employee gets a watered-down portal that only lets them see
their own requests, file a new one, and run Advottic Review. Who sees
which experience is decided by the login credential, and the employee
directory plus access is provisioned from the company's Azure or
Google environment, not typed in by hand.

---

## 1. What already exists (build on, do not rebuild)

- `lib/firm-types.ts` `FirmRole = owner | admin | attorney | paralegal
  | staff`. The legal-department app is the existing `/counsel/*`
  surface, already role-gated (see `CounselSidebar` owner/admin
  branch).
- `getActiveFirmContext()` resolves the signed-in user to one
  `{ firm, membership }`. Every Counsel page already redirects out
  when there is no context. This is the chokepoint we extend.
- Tenant subdomain plumbing exists: `Firm.subdomainEnabled`,
  `<slug>.advottic.com`, `tenantHref()`. An enterprise tenant is a
  Firm row with `firmType = 'corporate'`.
- Typed intake (Tier 1) already records `request_type`,
  `submitted_by`, employees involved, due/expiry, priority,
  confidentiality in `firm_matter_intakes` / `intake_answers`. The
  employee portal is mostly a *scoped view* over this table.

The gap is not the legal app. It is (a) a second, deliberately small
experience for non-legal employees, and (b) provisioning identity and
storage from the customer's environment.

---

## 2. Role model

Add one axis: **workspace persona**, derived from `FirmRole`, not a
new column.

| Persona  | Source                                   | Sees |
|----------|------------------------------------------|------|
| Legal    | `FirmRole` in {owner, admin, attorney, paralegal, staff} | Full `/counsel/*` |
| Employee | Directory-synced member with no `FirmRole` (a new `firm_employees` row, not `firm_members`) | `/portal/*` only |
| Admin    | `FirmRole` in {owner, admin}             | Full `/counsel/*` + tenant settings |

Decision: employees are **not** `firm_members`. A `firm_members` row
implies a legal-team seat (and billing). Employees live in a separate
`firm_employees` table (id, firm_id, user_id, email, display_name,
department, source = 'azure' | 'google' | 'manual', external_id,
deactivated_at). The persona resolver:

1. `getActiveFirmContext()` -> if a `firm_members` row exists, persona
   = Legal/Admin by role. Done.
2. else if a `firm_employees` row exists for this firm, persona =
   Employee.
3. else no access.

This keeps the legal app's existing RLS untouched and means an
employee can never reach a `/counsel/*` route even by typing the URL,
because there is no `firm_members` row for them.

---

## 3. Employee portal (`/portal/*`) scope

Deliberately three things, nothing more:

1. **My requests** - a list filtered to
   `firm_matter_intakes.intake_answers.submitted_by_user_id = me`
   (add `submitted_by_user_id` to the intake answers; the typed form
   already captures `submitted_by`). Read-only status, no conflict
   panel, no other employees' requests.
2. **New request** - the Tier 1 typed intake form, in-house modes
   only (no "New case / matter (outside client)" option), submitter
   pre-bound to the signed-in employee and not editable.
3. **Advottic Review** - the existing document review entry point,
   scoped so an employee can submit a document and get the AI read,
   but cannot see the firm vault or other matters.

Everything else in the Counsel nav (Cases, Clients, Team, Billing,
Trust, Time, Referrals, Leads, Chat) is absent from the portal nav
and blocked server-side by the persona check. The portal gets its own
minimal layout, not `CounselSidebar`.

---

## 4. Identity provisioning (needs Zinpro IT) - Tier 3

To "auto-populate employees and grant access" from Azure or Google we
need one of:

- **SSO (required):** SAML or OIDC via the customer IdP (Entra ID /
  Google Workspace). Supabase Auth supports SSO connections; the
  tenant Firm is bound to an IdP domain. Login credential then *is*
  the persona signal: anyone in the directory who authenticates and
  is not on the legal team becomes an Employee automatically.
- **Directory sync (required for "auto-populate"):** SCIM 2.0
  provisioning from Entra/Google, or Microsoft Graph / Google
  Directory API read with a service principal. Each synced user
  upserts a `firm_employees` row. Deprovisioning sets
  `deactivated_at` and revokes the session.

What Zinpro must provide before any of this can be built:
- IdP type and the ability to register Advottic as a relying party
  (redirect URIs, entity ID / client credentials).
- A SCIM bearer token *or* a service-principal app registration with
  `User.Read.All` (Graph) / read-only Directory scope (Google), least
  privilege.
- The email domain(s) that map to this tenant.
- Security review sign-off (data residency, token storage, audit).

None of this is buildable from our side alone. It is a joint
integration with a security gate, hence Tier 3.

---

## 5. Bring-your-own storage (needs Zinpro IT) - Tier 3

"Connect to the org's storage" for the vault: support a per-tenant
storage backend so privileged documents live in the customer's Azure
Blob container or Google Drive / Cloud Storage, not only Supabase
Storage.

Design: a `firm_storage_backends` row (firm_id, kind = 'supabase' |
'azure_blob' | 'gcs', config JSON, credential ref). All vault read /
write goes through a `StorageDriver` interface so the call sites in
`lib/` do not change. Credentials are stored as a secret reference,
never in the DB row.

Needs from Zinpro IT: the container/bucket, a scoped credential
(SAS / workload identity / service account with object-level scope),
and confirmation of who owns encryption keys. Security review gate
again.

---

## 6. Phasing

- **Tier 1 - shipped (`73e4b7e`).** Generic typed intake + in-house
  metadata + notifications on by default.
- **Tier 2 - buildable now, no customer dependency.** `firm_employees`
  table + persona resolver + `/portal/*` (My requests, New request,
  Advottic Review) + manual employee add for pilots. Employees can be
  added by an admin from the Team page until SSO lands. This is the
  next code increment and does not need Zinpro IT.
- **Tier 3 - blocked on Zinpro IT + security review.** SSO,
  SCIM/Directory auto-provisioning, BYO storage. Each is a joint
  integration; sequence after Zinpro returns IdP and storage details.

## 7. Open questions for Zinpro

1. IdP: Entra ID or Google Workspace? SAML or OIDC?
2. Can you provision via SCIM, or do we read the directory via a
   service principal?
3. Should an employee who later joins legal keep their request
   history? (Recommend: yes, link by user_id.)
4. Vault storage: stay on Advottic-managed, or your Azure/GCS?
5. Who owns encryption keys for at-rest documents?
6. Data residency constraints (region pinning)?
