# Data Retention & Disposal Policy

**Owner:** Security Official · **Review:** annual · Maps to SOC 2 C1.1–C1.2 · ISO 27001 A.5.34 · HIPAA §164.316(b)(2) · GDPR Art. 17 / CCPA.

## 1. Principle
Retain personal data and PHI only as long as needed for the service or as required by law, then dispose of it securely.

## 2. Retention schedule
| Data | Retention | Basis |
|---|---|---|
| Account + case data, exhibits, AI reviews | While account is active; deleted on account deletion | Contract / user control |
| **Audit logs** (`audit_events`, `firm_signature_events`, `admin_impersonations`) | **6 years** | **HIPAA §164.316(b)(2)**: overrides erasure for these records |
| Security event logs | 1 year (target) | Security monitoring |
| Billing records (Stripe) | As required by tax/finance law (typically 7 years) | Legal obligation |
| Organization data after a trial lapses or access is suspended | Retained until the organization asks for removal; nothing runs on a timer | Litigation hold + legal retention; see [Trial Lapse Retention Posture](trial-lapse-retention.md) |
| Backups | Per Supabase PITR window; then rotated | Continuity |
| Transactional messages (Twilio/Resend) | Per subprocessor default; minimize | Operational |

## 3. Deletion / right to erasure
- Users delete their account via `/api/account/delete` (typed confirmation). This cascades case/exhibit/collaborator/subscription rows and performs a best-effort purge of the user's `exhibits` storage prefix.
- **Erasure vs. legal retention:** audit and signature records are **retained for 6 years** per HIPAA even after account deletion; user identifiers in ancillary security logs are nulled. This exception is disclosed in the Privacy Policy and honored transparently.
- **Gaps to close (readiness P1-10):** (a) guarantee storage purge (retry/queue instead of best-effort), (b) clean up pending collaborator invitations, (c) add soft-delete + scheduled hard-purge with a defined grace period, (d) include the audit log in data exports.

## 4. Secure disposal
- Database rows: hard-deleted; backups age out of the PITR window.
- Files: removed from Supabase Storage; provider handles media sanitization.
- Keys/secrets: rotated on offboarding or suspected compromise.

## 5. Records
Retention decisions, erasure requests, and disposal actions are logged and retained 6 years.
