# Demo script - Monday

A precise 25-30 minute walkthrough. Times are guidelines; if the
audience starts asking questions, follow their lead and let the
script drop. Use this as a memory aid, not a teleprompter.

**Before the demo:**

1. Hard-refresh both `https://advottic.com` and `https://advottic.com/counsel`
   in two browser tabs. Chrome dev tools should be closed (no
   "inspect element" surface that looks unprofessional).
2. Log in to a dummy account on `/counsel` so the firm-side demo
   loads instantly without auth friction. Pre-create at least
   one matter ("Smith v. Smith - Apartment lease 2026") and pre-
   load 3-5 exhibits so the empty-state isn't the first thing
   the prospect sees.
3. Test your audio. Mute Slack, email notifications, Discord.
4. Have your founder story ready: 30 seconds, conversational,
   end with "and that's why we built Advottic" - they want to
   know you understand the problem before they want product detail.

---

## Talk track outline (25-30 min)

**Minutes 0-3: Hook + positioning**

Open with the painful truth, not the marketing slogan. Something like:

> "Most solo and small-firm attorneys are running 4-5 different
> tools - Clio for matter management, DocuSign for signatures,
> Spellbook for contract review, QuickBooks for accounting, and a
> spreadsheet to remember which client is in which tool. They're
> paying $200-400 per user per month for the privilege of switching
> between five tabs to do one job.
>
> We built Advottic Counsel because we think the AI moment in legal
> is going to make this stack consolidate. Not because the tools
> aren't good - Clio is great, Spellbook is great - but because AI
> works dramatically better when it has access to your whole
> practice, not just a slice.
>
> Today I'm going to show you what 'one tool, one AI, full
> practice' actually looks like."

Open: https://advottic.com on the projector.

Point out the hero: "Big things rarely happen all at once." Read it
to them - it sets the tone that this is a thoughtful product, not
a feature checklist.

---

**Minutes 3-7: The home page tour**

Scroll through the home page. Pause at:

1. **AudienceSplit** (top of page): "Two audiences, one product.
   Personal users who handle their own matters. Firms who run their
   entire practice. Same dashboard, different role."

2. **FeatureGallery**: tap through 2-3 of the visual tiles. Don't
   read every one - that's death. Pick the 2-3 most relevant to
   the audience. For a small-firm prospect, hit Case Management,
   IOLTA, and Marketplace.

3. **BellaShowcase** (dark band): "This is Bella. She's the AI agent.
   And the key word is *agent* - she takes action, not just answers
   questions. We'll come back to her in 10 minutes."

4. **TestimonialMarquee**: skip the marquee, it's a stand-in.

5. **TechTrustStrip** (just added): "Now the part that matters for
   firms thinking about adoption. We're built on real partners.
   Anthropic Claude for the AI. Stripe Connect for IOLTA-compliant
   payment splits. Postgres with row-level security for tenant
   isolation. We've engaged a SOC 2 auditor and we're in the active
   audit phase right now. We can sign a HIPAA BAA on request."

   Pause here. Let them see "this is real" sink in.

6. **AboutTeaser**, **Faq**: skip unless asked.

---

**Minutes 7-12: The resources hub (SEO + content moat)**

Navigate to `/resources`.

> "This is where I want to spend a minute on something most legal-
> tech demos don't show. We've published 8 cornerstone guides on
> the legal questions our customers actually ask - how to write a
> demand letter, what IOLTA is, when an e-signature is binding,
> how legal AI software compares.
>
> This isn't marketing fluff. It's the layer above the product:
> a legal-knowledge content layer that means our customers and
> their prospects get good information from us *before* they ever
> need to talk to a lawyer. Search-engine traffic for these guides
> compounds for years - I'd estimate $200,000 of equivalent ad
> spend in the next 12 months.
>
> For our firm customers, this is also where we get them their
> next client. Every guide ends with a CTA to Bella or to Find
> Counsel. The Find Counsel feed is where firms in our marketplace
> get matched with these readers."

Click into one of the articles - I'd recommend `/resources/best-legal-ai-2026`
because it shows we're not afraid to compare honestly:

> "We compare ourselves against Casetext CoCounsel, Harvey,
> Spellbook, Clio Duo, and Litify. We don't pretend the
> alternatives don't exist. The result is a piece that potential
> customers trust, because it doesn't read as sales copy. The
> trick is that our framing - 'full-stack platforms win for small
> firms because you don't want to maintain three vendors' - is
> *true*, so we can be honest about competitors and still come
> out looking like the answer."

---

**Minutes 12-15: Pricing transparency**

Navigate to `/pricing`.

> "Three things to flag about our pricing.
>
> One: it's public. You're looking at the same page our prospects
> see. We don't gate it behind a sales call.
>
> Two: it's bundled. The cheapest Counsel tier - Solo at $59 per
> user per month - includes practice management, IOLTA, Bella's
> full AI, e-signatures, and the marketplace. Comparable Clio
> setup with Spellbook layered on is $200-300 per user per month.
>
> Three: there's a real path from $0 to $99. Free tier exists.
> Personal tier at $19. The firm tier at $59 to $149. Enterprise
> for the 100+ seat customers. We're not a free-trial-only-then-
> mystery-pricing company."

Point at the TechTrustStrip (you'll see it here too, on /pricing).

---

**Minutes 15-25: The live product demo (Counsel side)**

This is the meat. Navigate to `/counsel` (your pre-logged-in tab).

The demo flow:

1. **Cases dashboard** (1 min): scroll through. Point out the at-
   a-glance status, deadlines, and unread activity. Then click into
   "Smith v. Smith".

2. **Matter detail** (3 min): walk through the matter. Show
   exhibits, timeline, hearing prep, signing requests, and time
   entries. Emphasize that this is one screen, not seven.

3. **Bella + matter** (3 min): open Bella. Say:

   > "Bella, draft a demand letter for the Smith landlord
   > demanding return of the $2,400 security deposit, citing
   > California Civil Code 1950.5, 30-day deadline, copy to
   > opposing counsel."

   Watch Bella produce a draft. She should populate parties, facts,
   legal basis, demand, and deadline. Review it on screen.

   Then say:

   > "Notice she also drafted a time entry for this work
   > automatically. 0.4 hours, billable, with the matter
   > pre-tagged. I review it and approve. That's a billable hour
   > captured that 90% of attorneys would have forgotten about."

4. **IOLTA reconciliation** (2 min): open /counsel/billing/trust.
   Show the three-way reconciliation. The bank ledger, the matter
   ledger, the firm ledger. They should match. Say:

   > "If they ever didn't match, this screen would flag the variance
   > and block the next disbursement. Trust-accounting compliance
   > is a leading cause of bar discipline for small firms. Bella
   > runs reconciliation daily. You get a clean ledger and a
   > defensible audit trail."

5. **E-signature** (1 min): open /counsel/signing. Show a
   pre-created signing request. Click into it - see the recipients,
   the audit trail, the certificate of completion. Say:

   > "UETA-compliant. E-SIGN Act compliant. Every event timestamped,
   > signed with HMAC, and exportable as a signed PDF certificate.
   > This is the cleanest e-sign audit trail in the category - I'd
   > stack it against DocuSign Premium."

---

**Minutes 25-30: Close + Q&A**

End with the close. Three sentences:

> "Three things I'd like to leave you with.
>
> One: every demo I do is the same product you'd see if you signed
> up today. I haven't shown you a mockup. There's no 'when this is
> ready' caveat. The platform is live, the customers are real, the
> AI is actually working.
>
> Two: 14-day free trial, no credit card. You can have a working
> Counsel firm set up in 30 minutes from your phone.
>
> Three: I'd love to know what convinced you to take this call,
> and what I'd have to show you to earn your business."

Then stop talking. Open Q&A. The third sentence is the close - it
makes them tell you what they care about.

---

## Likely objections + answers

**"What about data privacy / training?"**

> "Bella runs on Anthropic Claude. We've configured zero-retention
> mode, which means Anthropic doesn't train on the inputs. Our
> Postgres tenant has row-level security so no other firm's data
> is ever queryable. We retain everything you write in our database,
> not in any model. You can export and delete with one click."

**"How do you compare to Clio?"**

> "Clio is great. We're 30-45% cheaper at comparable tier, we
> bundle the AI that Clio sells as a $30/user/mo Duo add-on, and
> our marketplace is something Clio doesn't have. The honest
> downside is that Clio is 13 years old and we're 18 months. They
> have a deeper feature set in some narrow categories. Whether
> that depth is worth the $40/user/mo gap is a function of how
> many of those edge features your firm actually uses."

**"What if you go out of business?"**

> "Two answers. One: your data is exportable as a JSON archive or
> a PDF case-file bundle. Migration to Clio or any other PMS is
> documented and we maintain the migration scripts. Two: we're
> profitable on each Counsel subscription at scale. We're not a
> burn-100x-revenue VC SaaS. The unit economics doc - I can share
> it on request - shows the path to a sustainable business."

**"How does IOLTA actually work? Stripe is a regular processor,
not a trust account."**

> "Stripe Connect lets us split payments between a firm's
> operating account and the firm's actual trust account at a real
> bank. We don't hold IOLTA funds. The trust account is yours.
> What we provide is the ledger, the reconciliation, the matter-
> level allocation, and the audit-ready report. Stripe is the
> payment rail; the bank is the trustee."

**"Why should I use Bella vs. ChatGPT?"**

> "Three reasons. One: Bella has access to your firm's matter
> context. ChatGPT doesn't - you'd have to copy-paste every
> matter into the chat. Two: Bella runs inside the audit log -
> every action is timestamped and reviewable, which the bar
> rules effectively require. Three: Bella takes action -
> drafts, files, runs conflict checks, starts time entries -
> not just suggests words. ChatGPT is a calculator. Bella is
> a colleague."

---

## Backup slides if the demo can't connect

If wifi drops or Vercel has a regional incident:

1. Have screenshots of /, /resources, /pricing, /counsel, the matter
   detail screen, and the Bella demo response ready in a Google
   Slides deck. Match the talk track above 1:1.
2. Open Loom recording (one is on `/about` linked from the marketing
   home) and play it muted while you narrate.
3. If both fail, just talk. Use the talk track verbatim - it stands
   on its own without slides.

---

## Post-demo follow-up

Send the follow-up within 4 hours of the demo. Template:

> Subject: Followup - [Their Firm Name] + Advottic
>
> [Their Name],
>
> Thanks for the time today. Three things I wanted to send over:
>
> 1. The pricing tier that fits [Their Firm] based on what you
>    described is [Tier]. The all-in monthly is [$X]. I've added
>    a 30-day trial extension on your account if you'd like to
>    take the full month to test.
>
> 2. The [specific feature or question they asked about] in more
>    detail: [1-2 paragraphs of substance].
>
> 3. The next step if you're in: I can do a 30-minute onboarding
>    call with you and your office manager on [specific time
>    options]. The migration script will pull from [their current
>    PMS] automatically.
>
> No pressure - I'd love to know what you need to see to make a
> decision, even if it's not me you go with.
>
> Abel
> abel@advottic.com

---

## Last update
2026-05-10, 24 hours before the demo. Update with what worked and
what flopped after Monday.
