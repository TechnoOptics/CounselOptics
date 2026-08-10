# Vendor & Subprocessor Management (incl. BAA tracker)

**Owner:** Security Official · **Review cadence:** quarterly + on any new subprocessor · **Last updated:** 2026-08-10

Maps to SOC 2 CC9.1 · ISO 27001 A.5.19–A.5.23 · HIPAA §164.308(b) / §164.314(a).

## Policy
1. No subprocessor receives production user data until it has (a) a current SOC 2 Type II or ISO 27001 report on file, and (b) a signed DPA, plus a **BAA** if it will handle PHI.
2. Account owners are notified at least **30 days** before a new subprocessor handling case content is added (already stated on `/security`).
3. Subprocessors are reviewed quarterly against this register; reports are re-collected at least annually.
4. Least-data principle: each subprocessor receives only the minimum data needed for its function.

## Subprocessor register & BAA tracker

| Subprocessor | Function | Data received | PHI? | BAA required | BAA status | DPA | Compliance evidence |
|---|---|---|---|---|---|---|---|
| **Supabase** | Auth, Postgres, Storage | All account + case data, exhibits, PHI | **Yes** | **Yes** | ☐ *Not executed: HIPAA add-on + BAA required (Team/Enterprise plan)* | ☐ | SOC 2 Type II |
| **Vercel** | Hosting, edge, logs | HTTP requests, crash logs | **Yes** (transits) | **Yes** | ☐ *Not executed: Enterprise plan required for BAA* | ☐ | SOC 2 Type II |
| **Anthropic** | Bella + Advottic Review (AI) | Case titles/descriptions, exhibit text, queries | **Yes** | **Yes** | ☐ *Request BAA + confirm zero-retention on the account* | ☐ | SOC 2 Type II |
| **OpenAI** | Whisper transcription of audio/video exhibits | **The raw uploaded media file itself** (up to 25 MB) **and its original filename** | **Yes** | **Yes** | ☐ *Not executed. No DPA, no BAA, no security report collected. See the note below.* | ☐ | ☐ *Not collected* |
| **Twilio** | Safe Witness SMS | Phone number, alert text, GPS link, PIN | **Possibly** | **Yes** | ☐ *Twilio offers BAA; execute* | ☐ | SOC 2; HIPAA-eligible |
| **Resend** | Transactional email | Recipient email, subject, body | **Possibly** (email content) | **Yes** | ☐ *Confirm BAA availability* | ☐ | SOC 2 |
| **Google Maps** | Geocoding + static/interactive maps | Place names extracted from case evidence content; Safe Witness GPS coordinates | **Possibly** | **Yes** | ☐ *Not executed; confirm BAA availability* | ☐ | ☐ *Not collected* |
| **OpenStreetMap (Nominatim)** | Reverse geocoding | Latitude/longitude only. **EU-hosted**, the only non-US subprocessor | **Possibly** | **Yes** | ☐ *Public keyless service; no contract is available. Assess whether to keep it.* | ☐ | ☐ *None available* |
| **Microsoft Graph** | Firm calendar sync (opt-in per firm) | Meeting subjects, times, attendees; profile | **Possibly** | **Yes** | ☐ *Microsoft offers BAA; execute* | ☐ | ☐ *Not collected* |
| **Zoom** | Firm meeting creation (opt-in per firm) | Meeting topic, time; profile | **Possibly** | **Yes** | ☐ *Zoom offers BAA; execute* | ☐ | ☐ *Not collected* |
| **Cloudflare** | Turnstile bot check | Challenge token, requesting IP address | No | No | N/A | ☐ | ☐ *Not collected* |
| **Apple / Google / Mozilla push services** | Browser push delivery | Routing endpoint + payload **encrypted end-to-end** per the Web Push spec (VAPID + p256dh/auth), so the service cannot read the content | No (content unreadable) | No | N/A | ☐ *No contract exists; delivery is via the browser vendor's public endpoint* | N/A |
| **Stripe** | Billing | Customer ID, subscription status (no card data to us) | No | No | N/A | ☐ | PCI-DSS L1, SOC 2 |
| **RevenueCat** | iOS IAP | Supabase user_id, entitlement status | No | No | N/A | ☐ | SOC 2 |
| **CourtListener** | Case-law search | Search query text only | No | No | N/A | N/A | Public dataset |

☐ = action outstanding. **No customer BAA may be counter-signed until every "Yes" row above has an executed BAA and HIPAA-eligible plan.**

### Note on OpenAI (added 2026-08-10, highest priority)

This entry was missing from the register while the integration was
live, so it had never been through policy step 1. It is the most
data-exposed row in the table and it is the only one that receives an
unredacted source file rather than text we derived.

Two code paths send exhibit media to `https://api.openai.com/v1/audio/transcriptions`:

- `transcribeMedia` in `lib/ai.ts:566-651`, reached from
  `transcribeExhibitAction` (`lib/actions.ts:702-719`) when a user
  asks to transcribe an audio or video exhibit.
- `transcribeAudio` in `lib/timeline-ai.ts:362-399`, reached from
  `analyzeEvidence` (`lib/case-evidence.ts:242-245`), which downloads
  the file from the private exhibits bucket with the admin client
  during timeline and firm evidence analysis.

Both post the complete file bytes plus the user's original filename.
A client voice note or incident video can contain anything the client
said, including health information, so this path must be treated as
carrying PHI until proven otherwise. Policy step 1 was not satisfied
before this went live: no security report was collected, no DPA was
signed, and no BAA exists.

Owner decision needed, and this should not wait for the next quarterly
review. The options are to execute a DPA and BAA and move to a
zero-retention configuration, to replace the provider, or to disable
transcription by unsetting `OPENAI_API_KEY` (both call sites already
degrade cleanly when it is absent).

### Why several rows say "Not collected"

Google Maps, Microsoft Graph, Zoom, Cloudflare and the push services
were all in production and none was in this register. They are listed
now so the register matches reality; the empty boxes are the honest
current state, not a formatting placeholder. The public `/security`
table was updated in the same change and says a vendor review is
outstanding for each.

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
