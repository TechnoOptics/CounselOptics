# Risk Register

**Owner:** Security Official · **Review:** quarterly · Maps to SOC 2 CC3 · ISO 27001 A.5.7/Clause 6 · HIPAA §164.308(a)(1).

Scoring: Likelihood (L) × Impact (I), each 1–3. Risk = L×I (1–9). Treat ≥6 as priority.

| ID | Risk | L | I | Score | Treatment | Ref | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| R1 | No BAAs with PHI subprocessors | 3 | 3 | 9 | Execute BAAs + HIPAA plans | P0-1 | Owner | Open |
| R2 | No MFA on privileged accounts | 3 | 3 | 9 | Implement + enforce MFA | P0-3 | Eng | Open |
| R3 | Backup/DR untested (availability) | 2 | 3 | 6 | PITR + annual restore drill | P0-5 | Owner/Eng | Open |
| R4 | No automatic logoff | 2 | 2 | 4 | Idle + absolute timeout | P0-4 | Eng | Open |
| R5 | PHI in Safe Witness SMS body | 1 | 1 | 1 | RESOLVED: SMS links to secure tracker; raw GPS + PIN removed | P0-6 | Eng | **Closed 2026-07-01** |
| R6 | Audit-log coverage gaps (login/export/PHI view) | 1 | 2 | 2 | Login/export/deletion/role-change/(de)activation now logged w/ IP+UA; PHI-view + audit_events IP remain | P1-7 | Eng | In progress |
| R7 | Schema/IaC drift (change mgmt) | 2 | 2 | 4 | DB schema into VCS | P1-9 | Eng | Open |
| R8 | Over-broad `is_admin` flag | 2 | 2 | 4 | Minimize holders; quarterly review | — | Sec | Open |
| R9 | No malware scan on uploads | 3 | 3 | 9 | Add scanning; re-scored up (was 2×2) - Community Case public uploads (R13) elevate exposure. Magic-byte + allowlist validation shipped for that surface; full AV scanning still open | P2-15 | Eng | Open |
| R10 | Retention/erasure not fully enforced | 2 | 2 | 4 | Retention schedule + purge jobs | P1-10 | Eng | Open |
| R11 | No third-party pen test | 2 | 2 | 4 | Engage tester | P2-14 | Owner | Open |
| R12 | CSP in report-only | 1 | 2 | 2 | Promote to enforcing | P1-12 | Eng | Open |
| R13 | Community Case pages: first surface accepting file uploads + PII from anonymous, unauthenticated members of the public | 3 | 3 | 9 | Evidence submissions (2026-07-02) + Letters of Support incl. ID photo capture (2026-07-02) both shipped. Mitigations live: service-role-only inserts (zero anon RLS write path), magic-byte + allowlist upload validation, per-IP rate limiting (stricter on the ID-collecting letter path), link-out-only fundraising, `pending_review` gate on every letter (organizer must click through an explicit malware-risk warning before opening an ID photo, and separately mark it reviewed) as an INTERIM stand-in for real AV scanning. Re-scored up now that government ID collection is live, not just evidence. Still open: full AV/malware scanning (see R9 - this is the blocking item to retire the pending_review workaround), Cloudflare Turnstile bot-mitigation, plan-tier + phone-verification organizer gate (currently email-verified-only). Standing category, not a one-time gap - new abuse patterns expected post-launch | P1-16 | Eng | In progress |

**Accepted/known:** Next.js 14.2.x advisories mitigated by Vercel edge + `npm audit` gate; upgrade tracked separately. Update scores as remediation lands.
