# HIPAA Breach Notification Policy

**Owner:** Security Official · **Applies to:** all workforce members · Required by 45 CFR §§164.400–414.

## 1. Definition
A **breach** is the acquisition, access, use, or disclosure of PHI in a manner not permitted by the HIPAA Privacy/Security Rules that compromises the security or privacy of the PHI, unless a risk assessment shows a low probability that PHI was compromised.

## 2. Four-factor risk assessment
On any suspected incident involving PHI, assess: (1) nature/extent of PHI involved; (2) the unauthorized person who used/received it; (3) whether PHI was actually acquired/viewed; (4) the extent to which risk has been mitigated. Document the conclusion.

## 3. As a Business Associate — notification duties
Advottic is a Business Associate. On discovery of a breach of unsecured PHI:
- **Notify affected Covered Entity customers without unreasonable delay and no later than 60 calendar days** from discovery (§164.410). Provide, to the extent known: identity of affected individuals, description of what happened, PHI involved, and mitigation steps.
- The Covered Entity generally handles individual/HHS/media notice; Advottic supports with facts and cooperates per the BAA (which may shorten the timeline).
- If a subprocessor causes the breach, they must notify Advottic per their BAA; Advottic then notifies affected customers.

## 4. Response procedure (ties to Incident Response Plan)
1. **Detect & contain** — follow the [Incident Response Plan](../policies/incident-response-plan.md); preserve logs (`audit_events`, `firm_signature_events`, Supabase/Vercel logs).
2. **Assess** — run the four-factor test; determine if it is a reportable breach.
3. **Notify** — Security Official notifies affected customers within the BAA timeline (≤60 days).
4. **Document** — record discovery date, scope, individuals affected, notifications sent; retain **6 years** (§164.316(b)(2)).
5. **Remediate** — root-cause fix; update the [Risk Register](../policies/risk-register.md).

## 5. Records
Maintain a breach log (date discovered, description, PHI involved, individuals affected, notifications, resolution) for 6 years.
