# Information Security Policy

**Owner:** Security Official · **Approved by:** ____________ (Owner) · **Effective:** ______ · **Review:** annual
Maps to SOC 2 CC1–CC2 · ISO 27001 A.5.1 · HIPAA §164.316.

## 1. Purpose & scope
Defines how Techno Optics LLC protects the confidentiality, integrity, and availability of information in the Advottic platform, including customer case data and Protected Health Information (PHI). Applies to all workforce members, contractors, and systems that store or process Advottic data.

## 2. Principles
- **Confidentiality**: access on a least-privilege, need-to-know basis, enforced by Row-Level Security and role checks.
- **Integrity**: changes are authorized, logged, and (for signatures) tamper-evident via hash chaining.
- **Availability**: the service is resilient and recoverable per the [BC/DR plan](business-continuity-dr.md).
- **Privacy by design**: collect the minimum data necessary; never sell data; no training on customer data.

## 3. Roles & responsibilities
- **Security Official**: owns this policy set, the [risk register](risk-register.md), incident response, and vendor reviews.
- **Owner (Techno Optics LLC)**: approves policies, accepts residual risk, funds remediation.
- **Workforce**: complete security training; report incidents immediately; follow the [Access Control Policy](access-control-policy.md).

## 4. Control domains (see linked policies)
Access control · Cryptography (TLS 1.2+, AES-256, AES-256-GCM for tokens) · Logging & monitoring · Vulnerability management (Dependabot + `npm audit` CI) · Change management · Incident response · Business continuity · Vendor/subprocessor management · Data retention & disposal · HIPAA safeguards.

## 5. Acceptable use
Workforce access production data only for legitimate business purposes, only through approved devices/accounts, never over untrusted networks without TLS, and never copy PHI to unmanaged locations.

## 6. Enforcement & exceptions
Violations may result in access revocation and disciplinary action. Exceptions require written Security-Official approval, a compensating control, and an expiry date, tracked in the risk register.

## 7. Review
Reviewed at least annually and after any major incident or architecture change. Policies retained 6 years (HIPAA §164.316(b)(2)).
