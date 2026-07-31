# Access Control Policy

**Owner:** Security Official · **Review:** annual · Maps to SOC 2 CC6.1–6.3 · ISO 27001 A.5.15–A.8.5 · HIPAA §164.312(a),(d), §164.308(a)(3–4).

## 1. Identity & authentication
- Passwordless: email one-time code, Google/Microsoft/Apple OAuth, and enterprise SAML SSO. No passwords are stored by Advottic.
- **MFA (roadmap → required):** TOTP/WebAuthn must be enrolled and enforced for HQ admins and firm owners/admins. *(Currently a gap; see readiness P0-3.)*
- **Automatic logoff (roadmap → required):** idle timeout (target 15–30 min) and absolute session lifetime. *(Currently a gap: P0-4.)*
- Sensitive actions (account deletion, data export, admin impersonation) must require re-authentication. *(Roadmap.)*

## 2. Authorization model
- **Row-Level Security** on all case/PHI tables scopes rows to owner + explicit collaborators; storage access via signed URLs gated by the same rules.
- **Roles:** consumer user; firm `owner` / `admin` / `staff` / member; platform `is_admin` (HQ). Firm role changes are restricted to owner/admin via RLS helper functions (moved to a private schema).
- **Least privilege:** the global `is_admin` flag grants broad HQ + security-center access; treat it as a privileged role: minimize holders, review quarterly, and log its use (admin impersonation is already audited).
- Service-role (RLS-bypass) use is confined to server code, guarded by explicit ownership/admin checks; each use path is documented.

## 3. Provisioning & de-provisioning
- Enterprise: SCIM 2.0 create/update/deactivate → `firm_employees` (`deactivated_at` soft-delete). SSO maps identities per firm domain.
- **Access review:** owner/admin review firm membership and HQ admins **quarterly**; deactivate on offboarding.
- **Gap to close:** provisioning/role-change events must be written to the audit log (P1-7).

## 4. Segregation
Consumer and firm data are isolated at both the RLS layer and the Bella AI tool layer; a user in one context cannot reach the other's data.

## 5. Records
Access reviews, role changes, and admin actions are logged and retained 6 years.
