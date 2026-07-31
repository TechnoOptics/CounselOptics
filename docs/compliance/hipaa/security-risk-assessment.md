# HIPAA Security Risk Assessment (SRA)

**Entity:** Techno Optics LLC (Advottic) · **Role:** Business Associate · **Assessment date:** 2026-07-01 · **Next review:** 2027-07-01 or on material change · **Owner:** Security Official *(to be named)*

Required by 45 CFR §164.308(a)(1)(ii)(A). This SRA identifies PHI, the threats to it, current safeguards, and remediation. It must be reviewed and signed by the Security Official and refreshed at least annually.

## 1. Scope & PHI inventory
Advottic processes PHI on behalf of customers who use it for legal matters that may involve health information (e.g., personal-injury, disability, medical-malpractice, employment-health matters).

| PHI location | Examples | Store |
|---|---|---|
| `cases.description`, `subject_profile` | Diagnoses, treatment narratives | Supabase Postgres |
| `exhibits` (files) | Medical records, bills, imaging | Supabase Storage (`exhibits`, private) |
| `ai_reviews` | AI summaries of the above | Supabase Postgres |
| Safe Witness alerts | Health-relevant emergency context, geolocation | Twilio (SMS, transient) |

Identifiers present: names, contact info, dates, and free-text health details → treat all case content as **potential PHI**.

## 2. Data flows
See [PHI data-flow map](phi-data-flow.md). PHI at rest lives only in Supabase; it transits Vercel (compute) and may be sent to Anthropic (AI features) and Twilio (Safe Witness). All require BAAs.

## 3. Threats, current safeguards, risk & remediation

| # | Threat | Current safeguard | Residual risk | Remediation (ref §6 of readiness) |
|---|---|---|---|---|
| R1 | Unauthorized DB access | RLS on all case tables; service-role guarded | Low | Maintain; add PHI-view audit (P1-7) |
| R2 | Stolen credentials | Passwordless + SSO | **Med**: no MFA | Implement MFA (P0-3) |
| R3 | Unattended session on shared device | None | **Med** | Automatic logoff (P0-4) |
| R4 | No BAA with subprocessor handling PHI | None | **High** | Execute BAAs (P0-1) |
| R5 | PHI leaked via Safe Witness SMS | **RESOLVED**: SMS now links to the secure tracker (opaque UUID); raw GPS + plaintext PIN removed from the SMS body; TLS to Twilio | Low | Done (2026-07-01). tel: 911/call links retained for offline contacts |
| R6 | Data loss / outage | Supabase managed backups (defaults) | **High**: untested, no RPO/RTO | PITR + DR drill (P0-5) |
| R7 | Insufficient audit trail of PHI access | Append-only case-activity log | **Med**: no view/export/login events, no IP | Expand audit logging (P1-7) |
| R8 | AI processor trains on PHI | Zero-retention commercial terms (documented) | Low | Confirm in BAA; keep evidence |
| R9 | Malware in uploaded exhibit | None | **Med** | Upload scanning (P2-15) |
| R10 | Improper disposal / over-retention | Deletion endpoint; cascade + storage cleanup | **Med** | Retention schedule + guaranteed purge (P1-10) |
| R11 | Config/schema drift (unauditable change) | None | **Med** | IaC in version control (P1-9) |

## 4. Determination
Advottic has **strong technical safeguards** (encryption, RLS, append-only logs) but is **not yet HIPAA-ready to accept PHI in production** until the P0 items (chiefly **executed BAAs, MFA, automatic logoff, tested backups, and the Safe Witness transmission fix**) are complete. Until then, PHI intake should be limited/avoided or gated to non-production pilots under written agreement.

## 5. Sign-off
| Role | Name | Date |
|---|---|---|
| Security Official | ____________ | ______ |
| Owner (Techno Optics LLC) | ____________ | ______ |
