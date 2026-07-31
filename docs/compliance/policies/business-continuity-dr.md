# Business Continuity & Disaster Recovery

**Owner:** Security Official · **Review:** annual + after any DR test · Maps to SOC 2 A1.1–A1.3 · ISO 27001 A.5.30 · HIPAA §164.308(a)(7) (contingency plan).

> **Status: this is the largest availability gap.** Targets below are the intended policy; the enabling steps (PITR, restore drill) are outstanding (readiness P0-5).

## 1. Objectives (targets)
- **RPO (max data loss):** 1 hour. Requires Supabase Point-in-Time Recovery (PITR) enabled.
- **RTO (max downtime):** 4 hours for the application; 8 hours for full data restore.

## 2. What we depend on
| Component | Provider | Continuity mechanism | Action |
|---|---|---|---|
| Database | Supabase Postgres | Daily backups (default); **PITR to be enabled** | Enable PITR; confirm backup SLA |
| File storage | Supabase Storage | Provider-managed redundancy | Confirm backup coverage for `exhibits` |
| Compute/hosting | Vercel | Multi-region edge, stateless redeploy from Git | None (stateless) |
| Billing history | Stripe | Independent system of record | None |
| Source & IaC | GitHub | Full history | **Bring live DB schema into VCS** (P1-9) |

## 3. Backup strategy
- Database: automated backups + PITR; verify encryption of backups (inherits AES-256).
- Application: fully reproducible from Git (`main`) + Vercel; no state in compute.
- **Restore drill:** perform at least **annually**: restore to a staging project, verify row counts + integrity, record time-to-restore. *(Not yet performed.)*

## 4. Continuity scenarios
- **Region/provider outage:** Vercel edge is multi-region; DB failover per Supabase plan (document capabilities of chosen tier).
- **Data corruption / accidental deletion:** restore via PITR to just before the event.
- **Subprocessor outage** (Anthropic/Twilio/Resend): degrade gracefully. AI features and Safe Witness SMS may pause; core case access remains.

## 5. Roles & communication
Security Official declares a continuity event and coordinates restore; owner communicates status to customers. Ties into the [Incident Response Plan](incident-response-plan.md).

## 6. Testing & records
Document each backup verification and DR drill (date, scope, RTO/RPO achieved, issues). Retain 6 years.
