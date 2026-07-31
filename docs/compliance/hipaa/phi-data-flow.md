# PHI Data-Flow Map

**Last updated:** 2026-07-01 · Supports HIPAA §164.308(a)(1) risk analysis and the [SRA](security-risk-assessment.md).

## Where PHI enters
- **Web/mobile app** (`advottic.com` / Capacitor shells): user types case details or uploads medical documents over TLS 1.2+.

## Where PHI rests
| Store | Contents | Protection |
|---|---|---|
| Supabase Postgres | `cases`, `exhibits` (metadata), `ai_reviews` | AES-256 at rest; RLS per user/case; append-only audit |
| Supabase Storage `exhibits` (private) | Uploaded medical files | AES-256 at rest; RLS via signed URLs |

## Where PHI transits / is processed
| Destination | When | Data | Safeguard | BAA |
|---|---|---|---|---|
| Vercel | Every request | Whatever is processed server-side | TLS; ephemeral compute | **Required** |
| Anthropic (Claude) | Bella / Advottic Review | Case text, exhibit text, queries | TLS; zero-retention terms | **Required** |
| Twilio | Safe Witness alert | Phone #, alert text, secure tracker link (opaque UUID) | TLS to Twilio; **raw GPS + PIN no longer in SMS body** (fixed 2026-07-01) | **Required** |
| Resend | Transactional email | Recipient email, message body | TLS | **Required** |

## Where PHI leaves the system
- **User export** (`/api/account/export`): JSON to the authenticated user; exhibit files fetched separately via signed URL.
- **Account deletion** (`/api/account/delete`): cascades DB rows + best-effort storage purge; audit records retained per 6-year HIPAA rule.

## Trust boundaries & key risks
1. **App ↔ Anthropic**: PHI leaves to a third party for AI; mitigated by zero-retention terms, must be covered by BAA.
2. **App ↔ Twilio SMS**: *(resolved 2026-07-01)* the SMS now sends a secure tracker link (unguessable UUID) instead of raw GPS coordinates + plaintext PIN; offline `tel:` 911/call links retained. Residual: the link still reveals location to whoever holds the SMS; accepted as necessary for the emergency function, and server-side revocable/expirable.
3. **Consumer ↔ Firm isolation**: enforced at the Bella tool layer + RLS; PHI in one portal is not visible to the other.

## Diagram (textual)
```
User (TLS) ──▶ Vercel (compute) ──▶ Supabase (Postgres + Storage)   [PHI at rest]
                    │
                    ├──▶ Anthropic (AI: Bella / Review)   [PHI processed, zero-retention]
                    ├──▶ Twilio (Safe Witness SMS)        [PHI in transit, hardening needed]
                    └──▶ Resend (email)                   [PHI in transit]
```
