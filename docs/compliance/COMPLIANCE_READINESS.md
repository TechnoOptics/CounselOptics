# Advottic: SOC 2 / ISO 27001 / HIPAA Readiness Assessment

**Prepared:** 2026-07-01 · **System:** Advottic (CounselOptics), running Next.js 14 on Vercel + Supabase (Auth/Postgres/Storage), Capacitor iOS/Android WebView · **Owner:** Techno Optics LLC

> **Read this first: what "compliant" actually means.**
> Code alone cannot make a product "SOC 2 / ISO 27001 / HIPAA compliant." These are earned as follows, and this document is the map to each:
> - **SOC 2**: a CPA firm examines your controls and issues a report. **Type II** requires an *observation window* (typically 3–12 months) proving the controls operate over time. There is no certificate; there is a report.
> - **ISO 27001**: an accredited registrar audits your Information Security Management System (ISMS) in two stages and issues a certificate (3-year cycle with annual surveillance).
> - **HIPAA**: a *legal* framework, not a certification. It applies because Advottic stores Protected Health Information (PHI). It requires signed **Business Associate Agreements (BAAs)** with Advottic's customers *and* with every subprocessor that touches PHI, plus a documented Security Risk Assessment and safeguards.
>
> This engagement delivers the ~80% that is in our control: the technical safeguards, the control-to-requirement mapping, and the policy/evidence documentation. The remaining ~20% (the audit engagements and the legal agreements) only you can execute, and they are listed explicitly in §7.

---

## 1. Executive summary

Advottic starts from a **strong technical baseline**: passwordless auth with enterprise SSO/SCIM, pervasive Postgres Row-Level Security, TLS 1.2+ in transit, AES-256 at rest, app-level AES-256-GCM encryption for OAuth tokens, a hash-chained tamper-evident e-signature ledger, an append-only case-activity audit log, rate limiting, and a broad security-header set. Privacy Policy, Terms, and a public Security/Trust page already exist.

The gaps that matter for the three frameworks are concentrated in a few areas:

| Theme | State |
|---|---|
| Encryption, transport, RLS access control | **Strong**: largely audit-ready |
| Audit logging | **Partial**: append-only + hash-chained where present, but no login/export/permission-change events and no IP capture on `audit_events` |
| MFA | **Gap**: not implemented (roadmap only); HIPAA/SOC 2 expect it, especially for admins |
| Session controls | **Gap**: no idle/absolute timeout, no re-auth for sensitive actions |
| Backup / DR | **Gap**: relies on Supabase defaults; no documented RPO/RTO or tested restore |
| Data retention / disposal | **Gap**: no retention schedule; erasure leaves audit + some security rows (partly *correct* for HIPAA, see §5) |
| HIPAA BAAs & PHI handling | **Gap**: no BAAs executed; no PHI tagging or PHI-specific access logging; Safe Witness sends geolocation over SMS |
| Governance / policies / IaC in version control | **Gap**: policies now drafted here; live DB schema (`firms`, `firm_members`, `audit_events`, etc.) is **not** in `schema.sql` (change-management drift) |

**Two false alarms from the automated scan, corrected for the record:**
1. `.env.local` is **not** committed and never was. It is git-ignored; only `.env.local.example` (placeholders) is tracked. **No secret exposure.**
2. `audit_events` / `firm_signature_events` are **not** un-protected. RLS is enabled with INSERT/SELECT policies and **no** UPDATE/DELETE policies, so they are effectively **append-only** for all non-service roles.

---

## 2. System & data scope

- **Application:** `advottic.com` (Next.js/Vercel) + iOS/Android Capacitor shells loading the same web app.
- **Data stores:** Supabase Postgres (case data, profiles, subscriptions, audit), Supabase Storage (`exhibits` private bucket), Supabase Auth (identities/sessions).
- **PHI in scope:** health information can appear in `cases.description`, `exhibits` (uploaded medical records), and `ai_reviews`. See [PHI data-flow](hipaa/phi-data-flow.md).
- **Subprocessors:** Supabase, Vercel, Anthropic (Claude / "Bella"), Stripe, Resend, Twilio, RevenueCat, CourtListener. Full inventory + BAA status in [Vendor & Subprocessor Management](policies/vendor-and-subprocessor-management.md).

---

## 3. SOC 2 (Trust Services Criteria): control status

Status legend: ✅ Implemented · 🟡 Partial · ❌ Gap · 🔒 Requires external/organizational action

| TSC | Criterion | Status | Evidence / Gap |
|---|---|---|---|
| CC1 | Control environment (governance, org structure) | 🔒 | Policies drafted in `docs/compliance/policies/`; needs board/owner sign-off + org chart + roles |
| CC2 | Communication of policies | 🟡 | Public Security page + Privacy/Terms exist; internal policy set now drafted, needs adoption |
| CC3 | Risk assessment | 🟡 | [Risk register](policies/risk-register.md) drafted; needs periodic review cadence |
| CC4 | Monitoring | 🟡 | Security-pulse dashboard + crash instrumentation exist; no formal control-monitoring cadence |
| CC5 | Control activities | 🟡 | RLS + server-side guards strong; change-management (IaC in VCS) is a gap |
| CC6.1 | Logical access (auth) | ✅/🟡 | SSO, OAuth, magic-link, SCIM; **MFA missing** |
| CC6.2 | Access provisioning/de-provisioning | 🟡 | SCIM soft-deletes; provisioning events not audited |
| CC6.3 | Least privilege / RBAC | ✅/🟡 | Firm roles + RLS; global `is_admin` flag is broad (see [Access Control](policies/access-control-policy.md)) |
| CC6.6 | Boundary protection | ✅ | TLS 1.2+, HSTS, security headers, WAF via Vercel edge |
| CC6.7 | Data in transit/at rest encryption | ✅ | TLS 1.2+; AES-256 at rest; AES-256-GCM for OAuth tokens |
| CC6.8 | Malicious software prevention | 🟡 | No upload malware scanning on `exhibits` |
| CC7.1 | Vulnerability management | ✅ (new) | **Added:** Dependabot + `npm audit` CI gate. Pen test still 🔒 |
| CC7.2 | Security monitoring / anomaly detection | 🟡 | Rate limiting + security-pulse; no automated failed-login alerting |
| CC7.3–7.4 | Incident response | 🟡 | [IR plan](policies/incident-response-plan.md) drafted; needs tabletop exercise |
| CC8.1 | Change management | ❌ | Live DB schema not fully in version control; no formal change approval record |
| CC9.1 | Risk mitigation / vendors | 🟡 | Subprocessor list public; formal vendor reviews + DPAs/BAAs pending |
| A1.1–1.3 | Availability (backup/DR) | ❌ | No documented RPO/RTO or tested restore (see [BC/DR](policies/business-continuity-dr.md)) |
| C1.1–1.2 | Confidentiality (retention/disposal) | 🟡 | Export + deletion exist; retention schedule missing |

---

## 4. ISO 27001:2022 Annex A: key control status

| Annex A | Control | Status | Note |
|---|---|---|---|
| A.5.1 | Policies for information security | 🟡 | Drafted here; needs formal approval |
| A.5.15 | Access control | ✅/🟡 | RLS + roles strong; MFA gap |
| A.5.17 | Authentication information | 🟡 | Passwordless (good); no MFA |
| A.5.19–5.23 | Supplier / cloud security | 🟡 | Subprocessor inventory done; DPAs/BAAs pending |
| A.5.24–5.28 | Incident management | 🟡 | IR plan drafted |
| A.5.30 | ICT readiness for continuity | ❌ | DR untested |
| A.5.34 | Privacy & PII protection | ✅/🟡 | Privacy Policy strong; PHI tagging missing |
| A.8.5 | Secure authentication | 🟡 | MFA gap |
| A.8.8 | Technical vulnerability management | ✅ (new) | Dependabot + audit CI added |
| A.8.9 | Configuration management | ❌ | Schema/IaC drift |
| A.8.12 | Data leakage prevention | 🟡 | No log PII/PHI masking |
| A.8.15 | Logging | 🟡 | Append-only audit logs; coverage gaps |
| A.8.16 | Monitoring activities | 🟡 | Partial |
| A.8.24 | Use of cryptography | ✅ | TLS + AES-256 + AES-256-GCM |
| A.8.28 | Secure coding | ✅/🟡 | Parameterized queries, HTML escaping; no schema-validation lib (Zod) |

---

## 5. HIPAA Security Rule: safeguard status

Advottic is a **Business Associate** (it processes PHI on behalf of covered-entity / professional customers). It must satisfy 45 CFR §164.308/310/312/314/316. See the full [HIPAA Security Risk Assessment](hipaa/security-risk-assessment.md).

### Administrative safeguards (§164.308)
| Requirement | Status | Note |
|---|---|---|
| Security Management / Risk Analysis §164.308(a)(1) | 🟡 | SRA drafted; must be reviewed + owner-signed |
| Assigned Security Responsibility §164.308(a)(2) | 🔒 | Name a Security Official (owner action) |
| Workforce security / access management (a)(3–4) | 🟡 | RLS + roles; needs documented access-authorization procedure |
| Security awareness & training (a)(5) | 🔒 | Establish workforce training + log completion |
| Incident procedures (a)(6) | 🟡 | IR plan + [breach policy](hipaa/breach-notification-policy.md) drafted |
| Contingency plan (a)(7) | ❌ | Backup/DR undocumented + untested |
| Business Associate Agreements (a)(1)(ii)(B), §164.308(b) | 🔒 | **Execute BAAs with all PHI subprocessors + with customers** |

### Physical safeguards (§164.310)
| Requirement | Status | Note |
|---|---|---|
| Facility / device controls | ✅ | Inherited from Vercel + Supabase (SOC 2 / ISO 27001 data centers); document via their reports |

### Technical safeguards (§164.312)
| Requirement | Status | Note |
|---|---|---|
| Access control §164.312(a)(1) | ✅/🟡 | RLS + roles; add automatic logoff (idle timeout), currently **missing** |
| Unique user ID | ✅ | Per-user Supabase identities |
| Emergency access | 🟡 | Service-role admin path exists; document procedure |
| **Automatic logoff** §164.312(a)(2)(iii) | ❌ | No idle/absolute session timeout |
| Encryption/decryption §164.312(a)(2)(iv) | ✅ | AES-256 at rest, TLS in transit |
| **Audit controls** §164.312(b) | 🟡→ | Append-only logs; **now capturing login / export / deletion / role-change / (de)activation with IP + UA** in `security_events`. Remaining: PHI-*view* logging + IP on case-scoped `audit_events` |
| Integrity §164.312(c) | ✅/🟡 | Hash-chained e-sign ledger; extend integrity checks to PHI records |
| **Person/entity authentication** §164.312(d) | 🟡 | Strong identity; **MFA missing** |
| Transmission security §164.312(e) | ✅/🟡 | TLS everywhere **except Safe Witness geolocation over SMS** (Twilio) |

### Organizational & documentation (§164.314 / §164.316)
| Requirement | Status | Note |
|---|---|---|
| BAA contract language | 🔒 | Template + tracker in [vendor doc](policies/vendor-and-subprocessor-management.md) |
| Policies & procedures, 6-year retention | 🟡 | Policy set drafted; must be retained 6 years incl. audit logs |

---

## 6. Prioritized remediation roadmap

**P0: do before representing HIPAA compliance or signing an enterprise BAA**
1. 🔒 Execute **BAAs** with every PHI subprocessor (Supabase, Vercel, Anthropic, Twilio, Resend) and upgrade Supabase/Vercel to HIPAA-eligible plans. *(Legal/owner)*
2. 🔒 Name a **Security Official** and adopt the drafted policy set. *(Owner)*
3. 🟡 **MFA**: ✅ opt-in TOTP enrollment shipped (Profile → Two-factor authentication). **Remaining:** sign-in-time AAL2 enforcement for firm admins + HQ, after on-device validation of the enroll/verify loop. *(Code: medium)*
4. ✅ **Automatic logoff** shipped: 30-min idle timeout + 60s warning + 12h absolute cap (`components/IdleLogout.tsx`, mounted in root layout). *Remaining:* re-auth prompt for sensitive actions (deletion, export, admin impersonation). *(Code: small)*
5. ❌→ Define + test **backup/DR**: enable Supabase PITR, document RPO/RTO, run one restore drill. *(Infra/owner: small)*
6. ✅ **Safe Witness transmission fixed**: SMS now links to the secure tracker (opaque UUID) instead of raw GPS + plaintext PIN; offline `tel:` 911/call links retained. *(Done 2026-07-01)*

**P1: audit-readiness hardening**
7. 🟡 Extend **audit logging**. ✅ Shipped: **login**, **data export**, **account deletion**, **role change**, and **employee (de)activation** now write to the append-only `security_events` table with IP + user-agent via `lib/security-audit.ts` (routine events auto-acknowledged so they don't flood triage). **Remaining:** PHI/exhibit *view* logging and adding `ip_address`/`user_agent` to the case-scoped `audit_events`. *(Code)*
8. Add **PHI tagging** (`contains_phi` flag on cases/exhibits) + minimum-necessary access notes; segregate PHI-view audit. *(Code + schema)*
9. Bring **live DB schema into version control** (dump `firms`, `firm_members`, `audit_events`, etc. into `schema.sql`/migrations). This resolves the CC8.1 / A.8.9 change-management gap. *(Code)*
10. Add **data-retention schedule** + soft-delete/purge jobs; reconcile HIPAA 6-year audit retention vs. GDPR/CCPA erasure (see note below). *(Code + policy)*
11. Move **`/api/intake` (voice-notes)** to the shared DB-backed rate limiter; extend rate limiting to remaining public routes. *(Code: small)*
12. Promote **CSP from Report-Only to enforcing** after a quiet observation window. *(Code: small, needs monitoring)*
13. Add **failed-login anomaly alerting** + optional CAPTCHA on repeated failures. *(Code)*

**P2: maturity**
14. Third-party **penetration test** + remediate findings. *(External)*
15. **Malware scanning** on `exhibits` uploads. *(Code/infra)*
16. **Structured logging** with PII/PHI redaction + defined log retention. *(Code)*
17. Adopt **Zod** (or similar) schema validation across API routes. *(Code)*
18. **Security awareness training** program + records. *(Owner)*

> **Retention vs. erasure note:** HIPAA §164.316(b)(2) requires audit logs and policies be retained **6 years**. That can lawfully override a GDPR/CCPA erasure request for those *specific* records. So "audit_events survive account deletion" is not simply a bug; it must be documented as an intentional legal-retention exception (see [Data Retention & Disposal](policies/data-retention-and-disposal.md)).

---

## 7. What only you can do (cannot be done in code)

| Item | Framework | Action |
|---|---|---|
| SOC 2 Type II report | SOC 2 | Engage a CPA firm (e.g., via Vanta/Drata/Secureframe for evidence automation); expect a 3–12 month observation window |
| ISO 27001 certificate | ISO 27001 | Engage an accredited registrar; Stage 1 + Stage 2 audit |
| Penetration test | all | Engage a qualified testing firm annually |
| BAAs with subprocessors | HIPAA | Sign Supabase, Vercel, Anthropic, Twilio, Resend BAAs; upgrade to HIPAA plan tiers |
| BAA with customers | HIPAA | Counter-sign customer BAAs (only after the above) |
| Cyber-insurance / legal review | all | Have counsel review policies, BAA template, DPA |
| Name Security Official + train workforce | HIPAA/SOC 2/ISO | Owner assignment + training records |

---

## 8. Delivered in this engagement

**Code (committed):**
- Corrected public over-claims: `/enterprise` "SOC 2 Type II controls in place → built to the SOC 2 criteria"; `llms.txt` / `llms-full.txt` removed unimplemented "MFA enforcement" claims and softened BAA/audit wording.
- Strengthened **HSTS** to 1-year max-age (preload-eligible).
- Added **Dependabot** + **`npm audit` CI gate** (CC7.1 / A.8.8).

**Documentation (this folder):**
- This readiness assessment + control mappings.
- Policy set: Information Security, Access Control, Incident Response, Business Continuity/DR, Data Retention & Disposal, Vendor & Subprocessor Management (+ BAA tracker), Risk Register.
- HIPAA: Security Risk Assessment, Breach Notification Policy, PHI data-flow map.

**Not done (and why):** the P0/P1 *code* items (MFA, session timeout, expanded audit logging, PHI tagging) are scoped in §6 but not yet built. Several are sizable features and one (Safe Witness SMS change) affects an emergency-safety flow that must be changed carefully. Tell me which to implement next and I'll drive them. The §7 items are external by nature.

---
*This document reflects the codebase as of 2026-07-01 and must be re-reviewed after each P0/P1 item lands and at least annually.*
