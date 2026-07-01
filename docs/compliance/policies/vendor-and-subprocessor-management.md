# Vendor & Subprocessor Management (incl. BAA tracker)

**Owner:** Security Official · **Review cadence:** quarterly + on any new subprocessor · **Last updated:** 2026-07-01

Maps to SOC 2 CC9.1 · ISO 27001 A.5.19–A.5.23 · HIPAA §164.308(b) / §164.314(a).

## Policy
1. No subprocessor receives production user data until it has (a) a current SOC 2 Type II or ISO 27001 report on file, and (b) a signed DPA — plus a **BAA** if it will handle PHI.
2. Account owners are notified at least **30 days** before a new subprocessor handling case content is added (already stated on `/security`).
3. Subprocessors are reviewed quarterly against this register; reports are re-collected at least annually.
4. Least-data principle: each subprocessor receives only the minimum data needed for its function.

## Subprocessor register & BAA tracker

| Subprocessor | Function | Data received | PHI? | BAA required | BAA status | DPA | Compliance evidence |
|---|---|---|---|---|---|---|---|
| **Supabase** | Auth, Postgres, Storage | All account + case data, exhibits, PHI | **Yes** | **Yes** | ☐ *Not executed — HIPAA add-on + BAA required (Team/Enterprise plan)* | ☐ | SOC 2 Type II |
| **Vercel** | Hosting, edge, logs | HTTP requests, crash logs | **Yes** (transits) | **Yes** | ☐ *Not executed — Enterprise plan required for BAA* | ☐ | SOC 2 Type II |
| **Anthropic** | Bella + Advottic Review (AI) | Case titles/descriptions, exhibit text, queries | **Yes** | **Yes** | ☐ *Request BAA + confirm zero-retention on the account* | ☐ | SOC 2 Type II; zero-retention commercial terms |
| **Twilio** | Safe Witness SMS | Phone number, alert text, GPS link, PIN | **Possibly** | **Yes** | ☐ *Twilio offers BAA — execute* | ☐ | SOC 2; HIPAA-eligible |
| **Resend** | Transactional email | Recipient email, subject, body | **Possibly** (email content) | **Yes** | ☐ *Confirm BAA availability* | ☐ | SOC 2 |
| **Stripe** | Billing | Customer ID, subscription status (no card data to us) | No | No | N/A | ☐ | PCI-DSS L1, SOC 2 |
| **RevenueCat** | iOS IAP | Supabase user_id, entitlement status | No | No | N/A | ☐ | SOC 2 |
| **CourtListener** | Case-law search | Search query text only | No | No | N/A | N/A | Public dataset |

☐ = action outstanding. **No customer BAA may be counter-signed until every "Yes" row above has an executed BAA and HIPAA-eligible plan.**

## Onboarding a new subprocessor (checklist)
- [ ] Business justification + data categories documented
- [ ] Security report (SOC 2 / ISO 27001) collected & reviewed
- [ ] DPA signed; BAA signed if PHI
- [ ] Added to this register and to the public `/security` subprocessor list
- [ ] 30-day customer notice sent if it handles case content

## Offboarding
- [ ] Confirm data deletion/return per contract
- [ ] Rotate/revoke credentials and API keys
- [ ] Remove from register and public list
