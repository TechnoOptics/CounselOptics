# Incident Response Plan

**Owner:** Security Official · **Review:** annual + after each incident · Maps to SOC 2 CC7.3–7.4 · ISO 27001 A.5.24–A.5.28 · HIPAA §164.308(a)(6).

## 1. Definitions & severity
An **incident** is any event that may compromise the confidentiality, integrity, or availability of Advottic data or systems.

| Sev | Example | Target response |
|---|---|---|
| SEV1 | PHI/data breach, prod outage, key compromise | Immediate; all-hands |
| SEV2 | Attempted intrusion, partial degradation, subprocessor incident | < 4 h |
| SEV3 | Isolated bug with security impact, single-account issue | < 1 business day |

## 2. Roles
- **Incident Commander**: Security Official (or delegate); coordinates and decides.
- **Comms**: owner handles customer/legal/regulator notification.
- **Responders**: engineering.

## 3. Lifecycle
1. **Detect**. Sources: crash instrumentation, security-pulse dashboard, rate-limit/anomaly signals, subprocessor notice, user report (security.txt contact).
2. **Triage & declare**: assign severity + Incident Commander; open an incident record.
3. **Contain**: revoke sessions/keys, disable affected accounts (`profiles.is_blocked`), block IPs, tighten `/auth` rate limit.
4. **Eradicate & recover**: patch root cause; restore from backup per [BC/DR](business-continuity-dr.md); verify integrity (hash-chain checks).
5. **Notify**: if PHI is involved, follow the [Breach Notification Policy](../hipaa/breach-notification-policy.md) (BA duty: notify affected customers ≤60 days).
6. **Post-incident review**, within 5 business days: timeline, root cause, corrective actions → [Risk Register](risk-register.md).

## 4. Evidence preservation
Preserve `audit_events`, `firm_signature_events`, `admin_impersonations`, `security_events`, and Supabase/Vercel logs. Do not alter; export copies for the incident record.

## 5. Contacts
Security contact: see `/.well-known/security.txt`. Maintain an internal on-call + subprocessor-support contact list.

## 6. Testing
Run a **tabletop exercise annually** (e.g., simulated PHI breach) and document results.
