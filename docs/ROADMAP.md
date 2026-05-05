# Advottic - Roadmap

Living document. Edit when something flips from "queued" to "in flight"
or "shipped." Keep ordering opinionated - the top of each tier is the
thing we'd start tomorrow if we picked up the next session.

## Shipped (May 2026)

- Multi-tenant Counsel mode at enterprise.advottic.com + per-firm subdomains
- HQ admin console + Security pulse with 10 live monitors and autofix playbook
- E-signature with UETA-aligned 2-step disclosure + tamper-evident audit chain
- Documents v2: 12-state workflow, case linkage, due dates, status changer
- Microsoft 365 + Zoom OAuth (canonical-redirect flow that survives subdomains)
- Real-time team chat over Supabase WebSockets
- Bella with CourtListener case-law search + 8 document-drafting templates
- Consumer notification center + Pro-gated Documents inbox
- Auth-aware redirect: signed-in users skip the marketing splash
- Status page at /status, security disclosure + .well-known/security.txt
- Find-a-lawyer marketplace MVP: consumer brief -> matched-firm notifications

## Tier 1 - Practice management depth (the Clio-killer features)

These are what makes Advottic a defensible practice-management system,
not just an AI assistant with chat. Each is a 1-2 week build.

### 1. Time tracking + invoicing
- Auto-capture from existing surfaces: Bella sessions (one timer per
  matter), document-edit windows (page focus), chat threads, calendar
  events with the `matter:<id>` tag.
- Manual entry with stop/start.
- Approval queue for the firm owner before invoices go out.
- Stripe-rails invoicing: send invoice -> Stripe pays the firm.
- Time-tracking summary on each case file.

### 2. IOLTA / trust accounting
- Per-matter trust ledger.
- Three-way reconciliation: client ledger + firm trust journal + bank
  statement (CSV import from common business banks).
- Monthly statement export (PDF) per state-bar requirement.
- Hold-and-disburse rules, with audit log on every movement.
- Bar-required nuances per state: Texas requires interest-bearing for
  >$50k, California has special handling for unearned fees, etc.

### 3. Conflict checking + matter intake
- New-client wizard runs name + address + employer through the firm's
  existing client list, opposing parties, and adverse witnesses.
- Conditional intake forms - PI intake asks different questions than a
  divorce intake.
- Statute of limitations calculator with auto-alerts at 90 / 30 / 7 days.
- Engagement letter (the `engagement_letter` template Bella already
  drafts) auto-fills from the intake.

### 4. Court-form auto-fill
- Pull facts from a case (parties, jurisdiction, claims) and fill the
  state-specific court forms (CA Judicial Council forms, NY UCS forms,
  federal AO forms, etc.).
- PDF-form field detection + mapping table per form.
- Lawyer reviews + signs in the existing UETA flow.

## Tier 2 - AI depth

### 5. Voice-mode Bella over phone
- Twilio inbound number per firm.
- OpenAI Realtime (or Eleven Labs + Anthropic) for the voice loop.
- Intake script tuned per firm (which questions Bella asks and in what
  order, which she escalates to a human).
- Recording + transcript saved to the case file with consent disclosure.

### 6. Multilingual Bella, Spanish-first
- Existing Claude tools work in Spanish out of the box; the work is
  curating the system prompt + jurisdiction-specific Spanish phrasing
  for immigration, family, and employment law.
- UI string extraction + Spanish translation for the consumer surfaces
  (sign-in, cases, /find-counsel, sign flow).

### 7. Discovery + deposition AI
- Upload a discovery production (PDFs, emails, transcripts), get
  privilege flags, hot-doc summaries, and theme extraction.
- Single biggest cost-saver in litigation today.
- Probably needs a separate worker / queue (Inngest or QStash) since
  scans can run minutes-to-hours.

### 8. Document drafting expansion
- Current set (8 templates) was the MVP. Add: power of attorney,
  living will / advance directive, simple operating agreement,
  independent contractor agreement, MSA + SOW, settlement agreement
  with general release, motion to dismiss shell, motion for summary
  judgment shell.

## Tier 3 - Marketplace + network

### 9. Firm-side acceptance UI for marketplace leads
- Companion to the consumer-side `/find-counsel` form already shipped.
- Counsel inbox surfaces matched leads with the practice area, urgency,
  and summary (NOT the contact details until the firm signals interest).
- Firm clicks "Interested" with optional proposed fee. The lead goes
  to the consumer's inbox who picks one. Firm only sees contact details
  once the consumer accepts.

### 10. Co-counsel referral network
- Firm A refers Firm B with an agreed split percentage.
- System tracks the split + automates the eventual fee transfer (Stripe
  Connect with destination charges).
- Bar-rules differ on referral fees - need state-by-state rules.

### 11. Public-defender / legal-aid bridge
- Existing /public-defender route should be a real intake portal.
- Income / asset screening flows that map to LSC eligibility.
- Hand-off API for state PD offices that opt in.

## Tier 4 - Trust + enterprise (without these you can't sell to bigger firms)

### 12. SOC 2 Type 2 path
- Engage Vanta or Drata.
- 6-month observation window.
- Status page + bug bounty + responsible-disclosure (shipped) are
  prereqs.

### 13. SAML SSO + SCIM provisioning
- Big-firm IT requirement.
- WorkOS or Auth0 are the typical drop-ins.
- SCIM lets firm IT add/remove employees from a single console.

### 14. HIPAA capability + BAA
- For medical-legal cases (PI, malpractice, disability).
- Encryption is already in place; the lift is the contractual surface
  (a BAA we can sign with each firm) and the incident-response runbook.

### 15. Verified publisher status
- Microsoft Partner Center + Zoom Marketplace listing.
- Removes the "unverified" warning users see on first OAuth.
- Free, just paperwork, takes a few business days.

### 16. Data-residency options
- US-only, EU-only, on-prem.
- Big-firm requirement; usually deal-blocker for European firms.
- Probably means deploying separate Supabase projects per region.

## Tier 5 - Operational hardening

### 17. Native iOS + Android shells
- Capacitor wrap of the web app + native push notifications via APNS / FCM.
- Biometric login is already half-built.
- App Store + Play Store listings.

### 18. Disaster recovery drill
- Document RPO / RTO targets.
- Run an actual restore from a Supabase backup once.
- Store the runbook in /docs.

### 19. SIEM export
- Audit log -> Splunk / Datadog stream.
- Big-firm SOC2 customers ask for this.

## Tier 6 - Growth surfaces

### 20. Embeddable widgets
- Firms put an "Ask Bella" widget on their own website.
- Lead-gen for them, distribution for us.
- Iframe-based with origin allowlist.

### 21. Browser extension
- Capture facts from Gmail / Outlook into a case automatically.
- Highlight + "Save to Advottic case [X]".
- Big productivity unlock for litigators.

### 22. Public API
- Let other tools (Clio, MyCase) push and pull cases / documents /
  signing requests.
- OAuth client-credentials for server integrations.
- Per-endpoint rate limits.

### 23. Referral program
- Pro accounts refer Pro accounts, both get a free month.
- Trackable share link via /welcome.

## Tier 7 - Long-tail features

These are nice-to-haves, queued but not urgent.

- Calendar integration with court-date feeds (county clerk RSS where available)
- Pro bono hour tracking + state-bar reporting export
- Anonymous case templates / pattern library for SEO
- Time-cap features (max-fee escrow per matter)
- Conflict-of-interest heat-map across the firm's whole client list
- Client portal customization (firms upload their own branding)
- White-label mobile app per firm (a stretch goal)

---

## How to use this doc

When picking up the next session, scan Tier 1 and pick whichever has
the most concrete spec. Add a "Started YYYY-MM-DD" line to the heading,
move it into "Shipped" once it's live in production, and update the
ordering of remaining items if priorities shifted.

Keep tier headings stable so the rest of the team knows where to find
things; only add NEW tiers when a category genuinely shifts (eg. when
we add an offline-first mobile tier).
