# Advottic - Roadmap

Living document. Edit when something flips from "queued" to "in flight"
or "shipped." Keep ordering opinionated - the top of each tier is the
thing we'd start tomorrow if we picked up the next session.

## Shipped

- Multi-tenant Counsel mode at enterprise.advottic.com + per-firm subdomains
- HQ admin console + Security pulse with 10 live monitors and autofix playbook
- E-signature with UETA-aligned 2-step disclosure + tamper-evident audit chain
- Documents v2: 12-state workflow, case linkage, due dates, status changer
- Microsoft 365 + Zoom OAuth (canonical-redirect flow that survives subdomains)
- Real-time team chat over Supabase WebSockets
- Bella with CourtListener case-law search + 13 document-drafting templates
  (demand letter, cease-and-desist, lease termination, mutual NDA, engagement
  letter, civil complaint shell, employment offer, terms of service, durable
  power of attorney, living will / advance directive, independent contractor,
  MSA + SOW, settlement + general release)
- Consumer notification center + Pro-gated Documents inbox
- Auth-aware redirect: signed-in users skip the marketing splash; logo
  routes them to /cases at the edge
- /status public live status page
- /security/disclosure responsible-disclosure policy + .well-known/security.txt
  (RFC 9116) + bounty tier ladder
- Find-a-lawyer marketplace end-to-end:
    - Consumer brief at /find-counsel -> matched-firm notifications
    - Firm-side inbox at /counsel/leads with Interested / Pass actions and
      proposed-fee field; consumer contact stays masked until acceptance
    - Consumer-side response viewer at /inbox/leads/{id} with accept-and-share
      flow that politely declines the rest
- Time tracking MVP: firm_time_entries schema with one-open-timer-per-user
  invariant, start/stop server actions, manual back-fill, list-by-case query,
  TimerWidget component
- Deadlines + statute-of-limitations engine: per-state SOL lookup table for
  the largest 6 jurisdictions + sensible default for the rest, /api/cron/
  deadlines sweep firing 90/30/7 day notifications with idempotent flags
- Public API skeleton: /api/v1/me, /api/v1/cases (more endpoints to come),
  bearer-token auth, hashed token storage, scope ladder (read / write /
  admin), per-token last-used tracking
- Web push notifications: VAPID-based push, /api/push/subscribe endpoint,
  /sw-push.js service worker, PushOptIn React component, automatic fan-out
  on every createNotification (best-effort, dead subscriptions self-heal)

## Tier 1 - Practice management depth (the Clio-killer features)

### 1. Time tracking polish + invoicing
- Time tracking schema is shipped; build the firm-side ledger view at
  /counsel/time with filters (per case, per attorney, per week).
- Stripe-rails invoicing: bundle approved entries, generate an invoice
  PDF, email-link to the client, accept payment via Stripe.
- Auto-capture from existing surfaces: Bella sessions (matter-tagged
  timer auto-starts), document-edit windows (page focus), chat
  threads (idle-aware), calendar events with the matter:<id> tag.

### 2. IOLTA / trust accounting
- Per-matter trust ledger.
- Three-way reconciliation: client ledger + firm trust journal + bank
  statement (CSV import from common business banks).
- Monthly statement export (PDF) per state-bar requirement.
- Hold-and-disburse rules, with audit log on every movement.
- Bar-required nuances per state.

### 3. Conflict checking + matter intake
- New-client wizard runs name + address + employer through the firm's
  existing client list, opposing parties, and adverse witnesses.
- Conditional intake forms - PI intake asks different questions than a
  divorce intake.
- Engagement letter (the engagement_letter template Bella drafts)
  auto-fills from the intake.

### 4. Court-form auto-fill
- Pull facts from a case (parties, jurisdiction, claims) and fill the
  state-specific court forms (CA Judicial Council, NY UCS, federal AO).
- PDF-form field detection + mapping table per form.
- Lawyer reviews + signs in the existing UETA flow.

## Tier 2 - AI depth

### 5. Voice-mode Bella over phone
- Twilio inbound number per firm. (Requires Twilio account.)
- OpenAI Realtime (or Eleven Labs + Anthropic) for the voice loop.
- Intake script tuned per firm.
- Recording + transcript saved to the case file with consent disclosure.
- **Gap**: requires a Twilio account + funded balance + dialer phone numbers.
  Shipped scaffolding lives in the roadmap; account setup is yours.

### 6. Multilingual Bella, Spanish-first
- System prompt + i18n string extraction.
- Spanish translation for the consumer surfaces.
- Jurisdiction-specific phrasing for immigration, family, employment.

### 7. Discovery + deposition AI
- Upload a discovery production, get privilege flags + hot-doc
  summaries + theme extraction.
- Needs a separate worker / queue (Inngest or QStash) since scans run
  minutes-to-hours.

### 8. Document drafting expansion
- Already shipped 13 templates. Next batch: simple operating agreement,
  partnership agreement, motion to dismiss shell, motion for summary
  judgment shell, will codicil, employee handbook acknowledgement, equity
  grant agreement, vendor contract, NDA + IP assignment combo.

## Tier 3 - Marketplace + network

### 9. Co-counsel referral network with auto fee-split
- Firm A refers Firm B with an agreed split percentage.
- Stripe Connect with destination charges for the eventual fee transfer.
- Bar-rules per state on referral fees.

### 10. Public-defender / legal-aid bridge
- /public-defender as a real intake portal.
- Income / asset screening that maps to LSC eligibility.
- Hand-off API for state PD offices that opt in.

## Tier 4 - Trust + enterprise (must-have to sell to bigger firms)

### 11. SOC 2 Type 2 path
- Engage Vanta or Drata.
- 6-month observation window.
- /status, /security/disclosure, .well-known/security.txt, bug bounty
  (all shipped) are prereqs.
- **Gap**: this is a contract you sign with an auditor, not code. Months
  of operational evidence collection.

### 12. SAML SSO + SCIM provisioning
- Big-firm IT requirement.
- WorkOS or Auth0 are the typical drop-ins.
- SCIM lets firm IT add/remove employees from a single console.
- **Gap**: requires a WorkOS or Auth0 account.

### 13. HIPAA capability + BAA
- Encryption is in place; the lift is the contractual surface (a BAA
  we can sign with each firm) and the incident-response runbook.
- **Gap**: legal review + signed BAA is your work. The technical surface
  is mostly ready.

### 14. Verified publisher status
- Microsoft Partner Center + Zoom Marketplace listing.
- Removes the "unverified" warning users see on first OAuth.
- **Gap**: paperwork only. Free, takes a few business days.

### 15. Data-residency options
- US-only, EU-only, on-prem.
- Means deploying separate Supabase projects per region.

## Tier 5 - Operational hardening

### 16. Native iOS + Android shells
- Capacitor wrap of the web app + native push via APNS / FCM.
- Biometric login is already half-built.
- App Store + Play Store listings.
- **Gap**: requires Apple + Google developer accounts ($99 / yr + $25
  one-time) and ~3 days of native packaging work.

### 17. Disaster recovery drill
- Document RPO / RTO targets.
- Run an actual restore from a Supabase backup once.
- Store the runbook in /docs.

### 18. SIEM export
- Audit log -> Splunk / Datadog stream.
- Big-firm SOC2 customers ask for this.

## Tier 6 - Growth surfaces

### 19. Embeddable widgets
- Firms put an "Ask Bella" widget on their own website.
- Iframe-based with origin allowlist.

### 20. Browser extension
- Capture facts from Gmail / Outlook into a case automatically.
- Highlight + "Save to Advottic case [X]".

### 21. Public API expansion
- Skeleton shipped. Next endpoints:
  /v1/cases/{id}, /v1/cases/{id}/exhibits, /v1/documents,
  /v1/signing-requests, /v1/notifications, /v1/firms, /v1/leads.
- Webhooks for case_created, signing_completed, etc.
- Per-token rate limits.

### 22. Referral program
- Pro accounts refer Pro accounts, both get a free month.

## Tier 7 - Long-tail features

- Calendar integration with court-date feeds (county clerk RSS where available)
- Pro bono hour tracking + state-bar reporting export
- Anonymous case templates / pattern library for SEO
- Time-cap features (max-fee escrow per matter)
- Conflict-of-interest heat-map across the firm's whole client list
- Client portal customization (firms upload their own branding)
- White-label mobile app per firm

---

## Honest gap doc

These are explicitly NOT shippable from inside a coding session because
they require external accounts, contracts, audits, or paperwork:

- **SOC 2 Type 2 audit** - 6-month auditor engagement with Vanta or Drata
- **Microsoft Partner Center publisher verification** - free paperwork,
  a few business days
- **Zoom Marketplace published listing** - similar paperwork
- **Twilio account + phone numbers** for voice-mode Bella
- **WorkOS / Auth0 account** for SAML / SCIM
- **HIPAA Business Associate Agreement** template review by counsel
- **Apple Developer Program + Google Play Developer** accounts for
  native mobile shells
- **Stripe Connect** account onboarding for marketplace fee transfers

Everything else is buildable; queue them in the appropriate tier.

## How to use this doc

When picking up the next session, scan Tier 1 and pick whichever has
the most concrete spec. Add a "Started YYYY-MM-DD" line to the heading,
move it into "Shipped" once it's live, and update ordering if priorities
shifted.

Keep tier headings stable so the rest of the team knows where to find
things; only add NEW tiers when a category genuinely shifts.
