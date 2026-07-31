# Apple App Review: Precedent and Practice for Advottic

Research compiled 2026-07-31. Scope: how apps in Advottic's exact position (web-sold
SaaS, remote-URL WebView shell, hybrid consumer + firm product) actually get approved.

This document covers **practice and precedent**. A separate agent covers the verbatim
guideline text. Where guideline text appears here it is only to anchor the practice.

Throughout, findings are tagged:

- **[FACT]**: Apple's own published statement, or a directly observable artifact
  (App Store listing, vendor help doc).
- **[APPLE-STAFF]**: a reply from the `App Review` account on the Apple Developer Forums.
- **[ANECDOTE]**: a developer report. Treat as signal, not rule.
- **[INFERENCE]**: my reading, labelled as such.

---

## 0. Executive summary of what the evidence supports

1. The US Epic link-out change (May 2025) **did not remove the IAP requirement**. It only
   removed the anti-steering ban. An app that unlocks paid features must still either use
   IAP *or* qualify under a 3.1.3(a)–(f) carve-out. Advottic's round-7 rejection citing
   3.1.1 with a pointer to 3.1.3(b) is Apple saying exactly this. **[FACT + INFERENCE]**
2. The carve-out that real B2B SaaS apps live under is **3.1.3(c) Enterprise Services**
   (and, for a narrow set, 3.1.3(f)). Not 3.1.3(b). 3.1.3(b) Multiplatform Services
   *requires* IAP parity. Citing it is Apple telling you to add IAP. **[FACT]**
3. 3.1.3(c) has an explicit kill-switch for hybrids: *"Consumer, single user, or family
   sales must use in-app purchase."* Advottic's "Personal Plus" is exactly that.
   Apple has a boilerplate rejection built for this case. **[FACT]**
4. The market's answer to the hybrid problem, observable today in App Store listings:
   **IAP for the single-user plan, web-only for the multi-seat plan** (Notion), or
   **no consumer plan at all** (Slack, Figma, Clio). **[FACT]**
5. Reviewers read your **website and marketing copy**, not just the binary. At least one
   documented case was resolved by changing website wording away from individual plans.
   **[ANECDOTE, first-hand, with an Apple staff reply in-thread]**
6. Platform-differentiated behaviour (hiding purchase surfaces from the iOS app) is what
   Apple itself instructs developers to do. What gets apps killed is behaviour that
   differs **during review** vs. in production, or undisclosed behaviour. The line is
   *permanent + disclosed* vs. *review-time + hidden*. **[FACT + INFERENCE]**

---

## 1. The B2B SaaS pattern: what actually makes Slack/Figma/Clio compliant

### 1.1 The guideline they rely on

Apple's App Review Guidelines, section 3.1.3, current text as of 2026-07-31
(https://developer.apple.com/app-store/review/guidelines/): **[FACT]**

> **3.1.3(c) Enterprise Services**: If your app is only sold directly by you to
> organizations or groups for their employees or students (for example professional
> databases and classroom management tools), you may allow enterprise users to access
> previously-purchased content or subscriptions. **Consumer, single user, or family sales
> must use in-app purchase.**

> **3.1.3(f) Free Stand-alone Apps**: Free apps acting as a stand-alone companion to a
> paid web based tool (i.e. VoIP, Cloud Storage, Email Services, Web Hosting) do not need
> to use in-app purchase, **provided there is no purchasing inside the app, or calls to
> action for purchase outside of the app.**

> **3.1.3(b) Multiplatform Services**: Apps that operate across multiple platforms may
> allow users to access content, subscriptions, or features they have acquired in your app
> on other platforms or your web site … **provided those items are also available as
> in-app purchases within the app.**

Note the chapeau to 3.1.3: *"The following apps may use purchase methods other than in-app
purchase."* You must land inside (a)–(f) to be exempt from 3.1.1 at all. **[FACT]**

**"Professional databases"** in 3.1.3(c) is the phrase that covers legal practice
management. That is Advottic's natural home. **[INFERENCE]**

**Warning on 3.1.3(f):** a developer who took a phone consultation with an App Review
reviewer reported (April 2025) that *"all reviewers interpret 3.1.3(f)'s 'e.g.' as
'specifically'"*, i.e. reviewers treat VoIP / Cloud Storage / Email / Web Hosting as an
exhaustive list, not examples. He was steered to 3.1.3(c) instead.
Source: https://developer.apple.com/forums/thread/781935 (April 2025). **[ANECDOTE,
first-hand, corroborated by a veteran forum regular; the `App Review` staff account posted
in the same thread but only said the issue was resolved]**

Do not bet on 3.1.3(f). Bet on 3.1.3(c).

### 1.2 What those apps actually ship (observed from live App Store listings, 2026-07-31)

All checked directly on apps.apple.com (US storefront) on 2026-07-31. **[FACT]**

| App | Price | "In-App Purchases" section | Sells to individuals? |
|---|---|---|---|
| Slack (id618783545, v26.07.50, updated 2026-07-30) | Free | **None** | No (workspace/seat only) |
| Figma (id1152747299, v26.27.0, updated 2026-07-21) | Free | **None** | No (seat-based) |
| Clio for Law Firms and Lawyers (id686777370, v20260720.0.0, updated 2026-07-21) | Free | **None** | No (firm subscription) |
| Notion (id1232780281, v1.7.326) | Free | **Yes**: Plus Monthly $11.99, Plus Yearly $119.99, Plus & AI $21.99 / $214.99 | **Yes** (single-member workspaces) |
| Canva (id897446215, v4.219.0) | Free | **Yes**: Pro Monthly $14.99–$18.00, Pro Yearly $119.99/$143.99, Business $25.00, Teams $30.00, Credits | **Yes** (consumer product) |

The correlation is exact: **any app that sells a plan to an individual carries IAP.**
Every no-IAP app in the list sells only to organizations.

**Clio is the closest analogue to Advottic that exists**: legal practice management,
subscription sold on clio.com, free iOS app, no IAP, actively updated (July 2026). Clio
has no individual-consumer plan; it sells firm subscriptions. **[FACT]**

### 1.3 What those apps do and do not show in-app

- **Logged out:** sign-in first. Slack's logged-out flow offers sign-in / create a free
  workspace; it does not present plans or prices. Figma's mobile app is explicitly
  "View Designs. Comment. Mirror." (a viewer, not a purchase surface). **[FACT from
  listing copy]**
- **Pricing in-app:** none of the no-IAP apps present a price or a checkout.
- **Mentioning paid tiers is tolerated in *metadata*.** Slack's App Store description
  says things like *"Requires an upgrade to Slack Pro, Business+, or Enterprise"* and
  *"Requires Slack AI add-on"*. So naming a paid tier as a feature prerequisite has not,
  in Slack's case, drawn a 3.1.1 rejection. **[FACT: observed listing text]**
  **[INFERENCE]** This is safe because it is a capability statement, not a call to action,
  and there is no purchase path anywhere.
- **Free user hits a paid feature:** the pattern is a *dead end with an explanation*, not a
  link. Typical copy: "This feature is not available on your plan. Ask your workspace
  owner." No price, no URL, no "upgrade" button.
- **Billing links:** Slack's own help docs route billing management through the desktop
  admin surface only (https://slack.com/help/articles/218915087). Notion's billing help
  page (https://www.notion.com/help/billing) documents only the desktop path (Settings →
  Billing) and contains no mobile equivalent. **[FACT]**

### 1.4 The Notion split: the single most useful hybrid precedent

Notion's own help centre, https://www.notion.com/help/upgrade-or-downgrade-your-plan
(checked 2026-07-31): **[FACT, verbatim]**

> "If you're on Notion on an iOS or Android device and you're currently on the Free Plan
> with no other members, you'll be able to upgrade from the Free Plan to the Plus Plan on
> that device."
>
> "Plus Plan subscriptions purchased on mobile are limited to workspaces with only one
> member."
>
> "If you want to upgrade to the Plus Plan for a workspace with multiple members, you'll
> have to do that desktop or web."

This is 3.1.3(c) implemented literally: **single-user sale → Apple IAP; organizational
sale → web only.** Notion did not split into two apps and did not argue with Apple. It
drew the line Apple's text draws, inside one binary.

---

## 2. The consumer-hybrid trap

### 2.1 Yes, a consumer subscription changes the analysis. Decisively.

Apple has a **boilerplate rejection specifically for hybrids**. Verbatim, as quoted by a
developer on the Apple Developer Forums (January 2025):
https://developer.apple.com/forums/thread/773357 **[APPLE-STAFF text quoted by developer]**

> "We noticed in our review that your app offers enterprise services that are sold
> directly to organizations or groups of employees or students. However, these same
> services are also available to be sold to single users, consumers, or for family use
> without using in-app purchase."

That thread is worth reading in full because of how it ends:

- The developer's app was org-only: manual onboarding, no self-registration, all purchases
  off-store. Rejected anyway. **[ANECDOTE]**
- **[APPLE-STAFF]** The `App Review` account replied in January 2025 and gave no
  substantive guidance on 3.1.3(c). It told the developer to **submit an appeal to the App
  Review Board**, note that only one appeal per rejection is allowed, and that the Board
  would contact them directly.
- **June 2026**: another developer ("Salwan") posted in the same thread that they had hit
  the *identical* rejection **three times** with boilerplate replies. The thread contains
  **no documented resolution**. **[ANECDOTE]**

Read that as: this rejection is sticky, it is applied by pattern-match, and it is currently
unresolved in public for at least two developers.

### 2.2 Is "make the iOS app organization-only" a recognised, workable strategy?

**Yes, and it is the only strategy with a documented success in the record.**

Forum thread https://developer.apple.com/forums/thread/781935 (April 2025), the no-code
data platform case: **[ANECDOTE, first-hand, most detailed account found]**

The developer took a phone consultation with App Review. What the reviewer identified:

1. Their **website marketing** advertised "INDIVIDUAL" payment plans (they meant individual
   team managers). The reviewer read this as consumer sales → 3.1.3(c) disqualified.
2. Their **website copy** ("create apps for inputting data") was misread as a 2.5.2 issue.
3. The **in-app sign-up flow for invited users** "created perception users should be able
   to purchase subscriptions through the app."

What fixed it:

1. Rewrote the **website** to focus on team/corporate use, explicitly to qualify under
   3.1.3(c).
2. Removed marketing speak from the website.
3. Removed / modified the **sign-up flow in the app**.

The takeaway the developer wrote up himself: *"website/marketing presentation
significantly influences App Review's interpretation of compliance."*

This is the single most transferable finding in this document for Advottic, because
advottic.com currently sells "Personal Plus" to individuals in public marketing.

Corroborating success, older but cleaner: https://developer.apple.com/forums/thread/724032
(January 2023, marked **Resolved**). A hotel-SaaS companion app rejected under 3.1.1
because the service was "available for both multiple users as well as for individual
users." The developer **appealed with a written explanation of the B2B model** and was
**approved in 3 days**. **[ANECDOTE, resolved]**

### 2.3 Have apps split into two bundles?

I found **no documented case** of a company splitting into a free B2B iOS app and a
separate consumer iOS app with IAP purely to resolve 3.1.1. Searches for this returned only
Apple Business Manager / Custom Apps / Enterprise Program distribution material, which is a
different problem (private distribution). **[Absence of evidence, not evidence of absence]**

What the market actually does instead, observed above: **one binary, IAP on the individual
tier only** (Notion). That is cheaper, is documented, and matches 3.1.3(c)'s own sentence
structure. **[INFERENCE]**

Note that Apple Business Manager **Custom Apps** *is* a real escape hatch if Advottic ever
wants a firm-only build that is unlisted and distributed to named organizations, and no IAP
question arises at all. But it is not searchable on the App Store, so it cannot be the
consumer or self-serve channel. **[FACT]**

---

## 3. What actually triggers 3.1.1 enforcement: ranked tripwires

Ranked by how often each appears as the *stated cause* across the threads and write-ups
reviewed. This ranking is my synthesis of ~12 developer reports; it is **[INFERENCE]** on
top of **[ANECDOTE]**.

### Tier 1: near-certain rejection

1. **Any reachable checkout inside the app, including inside your own WebView.**
   Apple's wording: *"The app allows users to purchase digital content natively or via a
   web view in the app using payment mechanisms other than in-app purchase. Apps cannot
   include in-app payment mechanisms other than in-app purchase."*
   Source: https://developer.apple.com/forums/thread/802224 (September 2025). **[FACT:
   verbatim rejection text]**

2. **Account registration / sign-up flows.** This is the most under-appreciated tripwire
   and it hits WebView shells hardest. Apple, to a WebView developer
   (https://developer.apple.com/forums/thread/684850, July 2021): **[FACT: verbatim
   rejection text]**

   > "Your app includes an account registration feature for businesses and organizations,
   > which is considered access to external mechanisms for purchases or subscriptions to be
   > used in the app. To resolve this issue, please remove features, account registrations
   > links, and any other fully qualified links to your site that could indirectly provide
   > access to external purchase mechanisms."

   Note "**indirectly**". Apple is treating sign-up as a purchase funnel entrance.
   Independently corroborated in thread 781935 (April 2025): the in-app sign-up flow
   "created perception users should be able to purchase subscriptions through the app."

3. **Any fully-qualified link to your own marketing/pricing site** reachable from the app.
   Same rejection text as above. Outside the US storefront this is flatly banned by the
   3.1.3 chapeau; on the US storefront it is *permitted* but **does not cure 3.1.1** and it
   **forfeits the 3.1.3(c)/(f) "no calls to action" safe harbour**. **[FACT + INFERENCE]**

### Tier 2: frequently cited

4. **A visible price or plan name attached to a call to action.** Naming a tier as a
   prerequisite ("requires Pro") is evidently survivable. Slack does it in its own App
   Store description. Naming a tier next to a way to get it is not. **[FACT (Slack listing)
   + INFERENCE]**

5. **The words "Subscribe" / "Upgrade" / "View plans" as an actionable control.** Recurs in
   nearly every 3.1.1 thread. The B2B fitness-coach case
   (https://developer.apple.com/forums/thread/811018, December 2025) is the control
   experiment: the developer had **no pricing, no plans, no upsells, no sign-up, no
   external links, no in-app purchase** and was *still* rejected with *"Your app accesses
   digital content purchased outside the app, and that content is not available through
   in-app purchase."* **[ANECDOTE: unresolved, 0 replies]**
   That case tells you removing tripwires is **necessary but not sufficient**; you also have
   to affirmatively land a 3.1.3 carve-out and say so.

6. **"Restore purchases" / "Restore account" buttons on a welcome screen.** Reported as
   frequently cited under the standard 3.1.1 rejection text in 2026 write-ups.
   **[ANECDOTE: secondary source, Stora implementation guide, 2026-05-16]**
   Relevant: Advottic ships `components/RestorePurchases.tsx`.

### Tier 3: contributory

7. **Your public website's marketing copy** implying individual/consumer plans, when you
   are arguing 3.1.3(c). Documented as a direct cause in thread 781935. **[ANECDOTE]**
8. **Vague or generic Notes for Review.** Apple's own "Tips from App Review"
   (https://developer.apple.com/forums/thread/810791, December 2025) states that for new
   apps you must *"describe concept, business model, and location-specific operation"* in
   the Notes field, and that **"generic descriptions will be rejected"** (2.3.1(a)).
   **[FACT / APPLE-STAFF]**
9. **Reviewer roulette.** A veteran on thread 802224: previous acceptance by one reviewer
   does not bind the next. Multiple threads show identical setups going both ways.
   **[ANECDOTE]**

---

## 4. The remote-URL WebShell problem, and whether UA-gating is safe

This is the highest-stakes question in the brief, so I want to be precise about which
parts are Apple's own words.

### 4.1 A purchase page inside your own WebView is treated as an in-app purchase mechanism

Not as a link-out. Apple's verbatim text, thread 802224 (Sept 2025): *"natively **or via a
web view in the app**"*. **[FACT]** The Stora 2026 guide puts it plainly for external-link
implementations: *"opening the URL in any embedded browser is an instant rejection … Apple
wants the user to leave the app environment entirely."* **[ANECDOTE: secondary source,
https://stora.sh/blog/2026-05-16-apple-app-store-external-purchase-links-implementation-guide]**

For a remote-URL Capacitor shell this is existential: **your entire app is the web view.**
If /pricing is reachable by any route (nav, deep link, redirect, email link opened
in-app, search), the reviewer will treat it as an in-app purchase mechanism.

### 4.2 Apple explicitly instructs developers to remove those routes

This is the crux, and it is Apple's own words, not inference. From the 3.1.1 rejection
issued to the WebView developer in thread 684850: **[FACT]**

> "To resolve this issue, please **remove features, account registrations links, and any
> other fully qualified links to your site** that could indirectly provide access to
> external purchase mechanisms."

Apple is telling a WebView app to serve less than its website serves. **Differentiating
what the iOS app can reach is the remedy Apple prescribes.** It is not, in itself,
concealment.

### 4.3 Where it becomes concealment

Guideline 2.3.1(a), verbatim (checked 2026-07-31): **[FACT]**

> "Don't include any hidden, dormant, or undocumented features in your app; your app's
> functionality should be clear to end users **and App Review**. All new features,
> functionality, and product changes **must be described with specificity in the Notes for
> Review** section of App Store Connect (generic descriptions will be rejected) and
> accessible for review."

2.3.1(b): *"Egregious or repeated behavior is grounds for removal from the Apple Developer
Program."* And the Guidelines introduction: *"If you attempt to cheat the system (for
example, by trying to trick the review process) … your apps will be removed from the store
and you will be expelled from the Apple Developer Program."* **[FACT]**

Apple **does** detect review-time differentiation, and words the rejection explicitly.
Thread 802224, verbatim: **[FACT]**

> "The app contains hidden features. Specifically, we still noticed that your app includes
> **code which causes it to behave differently during the review process** regarding web
> game presentation and payment."

That app was rejected three times, kept getting flagged after claiming to remove the code,
and was never resolved in the thread.

### 4.4 The test that separates the two

The distinguishing variable in every case reviewed is **what the gate keys on**:

| Gate keys on | Verdict | Basis |
|---|---|---|
| "is this the iOS app": permanent, applies to every iOS user forever | Legitimate; it is the remedy Apple prescribes | Apple's own 684850 rejection text; Spotify/Kindle/Slack product behaviour **[FACT + INFERENCE]** |
| "is this a reviewer": IP range, review window, TestFlight state, a remote kill-switch flipped after approval | **2.3.1 hidden features + 2.5.2. Account-termination territory** | 802224 verbatim rejection; 2.3.1(b) **[FACT]** |
| "is this the iOS app", but **undisclosed** in Notes for Review | Legitimate behaviour, unnecessarily framed as a hidden feature | 2.3.1(a) requires specificity in Notes **[FACT + INFERENCE]** |

**My assessment: UA-gating pricing is safe for Advottic, subject to four conditions.**
**[INFERENCE: Apple has never published a statement blessing UA gating by name, and I
found no forum thread where a reviewer either approved or rejected UA-gating explicitly.
This conclusion is reasoning from Apple's prescribed remedy plus the 2.3.1 text, not from a
documented case.]**

Conditions:

1. **Permanent and universal.** Every iOS-app user, every session, forever. Never a flag
   that flips after approval. That is 2.5.2 and it is how accounts get terminated.
2. **Disclosed in Notes for Review, in writing.** State that the iOS build does not present
   plans, prices, sign-up or checkout, that this is by design for 3.1.1 compliance, and
   that the gate is server-side on the app's User-Agent token. Disclosure is what converts
   "hidden feature" into "documented feature". 2.3.1(a) demands it.
3. **Server-side and fail-closed, not CSS.** Advottic already has this: `lib/platform.ts`
   appends `AdvotticApp/ios` to the WebView UA via `capacitor.config.ts`, and
   `lib/iap-guard.ts` refuses checkout server-side with a 403. The code comment in
   `iap-guard.ts` already notes CSS-only hiding *"is the pattern behind prior Apple
   rejections."* That judgement is correct. The gate must extend from checkout routes to
   **every plan, price, upgrade and sign-up surface and route**, not just the POST handler.
4. **Honest UA token.** The app identifies *itself* as the app. It is not spoofing a
   browser to evade anything. That framing matters if you ever have to defend it.

**The danger is not the gate. The danger is a leak.** If a reviewer reaches /pricing inside
the app by *any* route (a redirect, a marketing email opened in-app, a stale deep link, a
`target=_blank` that stays in the WebView, an og: card, a 404 fallback to the marketing
site), you have simultaneously a 3.1.1 violation *and* the appearance of a concealment
attempt. That combination is far worse than never gating at all.

---

## 5. Recovering from repeat rejections

### 5.1 What Apple says the options are

Apple's official "Tips from App Review" (https://developer.apple.com/forums/thread/810791,
December 2025) **[FACT / APPLE-STAFF]**:

- **Reply to App Review** in App Store Connect (Resolution Center).
- **Request a call** with an Apple representative: *"include preferred time and language"*
  in the reply. This is a real, documented channel and it is cheaper than an appeal.
- **App Review Appointments** via Meet with Apple (https://developer.apple.com/events/).
  1:1 with an App Review expert, *"Tuesdays and Thursdays during local business hours"*,
  subject to availability.
- **Appeal to the App Review Board** if you believe the reviewer misunderstood the app or
  the review was unfair. **One appeal per rejection.** The Board contacts you after
  investigating.
- **Suggest a guideline change** (separate form).

Scale context: Apple reviewed **more than 9.1 million submissions and rejected over 1.2
million new apps in 2025**. **[ANECDOTE: secondary reporting of Apple's figure]**

### 5.2 What developers report actually works, ranked

1. **A phone call / App Review Appointment. Highest-value action found in this research.**
   In thread 781935 the phone consultation is what surfaced the *actual* three causes
   (website copy, marketing wording, sign-up flow), none of which appeared in the written
   rejection. The developer's own conclusion: a call *"can provide guidance (though not
   approval)"*. **[ANECDOTE, first-hand]**
   Given Apple's own rejection message to Advottic offers an appointment, **take it.** The
   written rejections are boilerplate; the call is where you learn the real objection.

2. **A written business-model explanation in Resolution Center, or an appeal.** Thread
   724032 (2023): appeal + business-model explanation → approved in 3 days, thread marked
   Resolved. **[ANECDOTE, resolved]**
   Thread 684850: the **App Review Board overturned the original rejection**, verbatim:
   *"The App Review Board evaluated your app and determined that the original rejection
   feedback was not accurate. Your app is not currently in violation for the previous 3.1.1
   concern."* Apple then raised a *different* 3.1.1 issue (the sign-up links). **[FACT]**
   So: appeals do get rejections overturned, and they also produce fresh objections.

3. **Complying.** Thread 781935 resolved by changing the product and the website.
   Notion resolved it by shipping IAP on the single-user tier.

4. **Arguing by analogy to other apps.** Repeatedly attempted, never once observed to work.
   The fitness-coach developer cited Trainerize, Everfit and Hubfit (thread 811018); the
   other cited Spotify (thread 812386, January 2026, rejected 3 times). Both threads have
   **zero replies and no resolution**. Do not build your Resolution Center reply around
   "but Spotify does it". Spotify is a 3.1.3(a) reader app and Advottic is not.
   **[ANECDOTE]**

### 5.3 Is there real risk from repeated non-compliance?

- **From honest repeat rejections: low.** Nothing in the record shows an account penalised
  for resubmitting in good faith. Devs report 3, 4, 6 rounds routinely.
- **From anything that looks like evasion: severe and explicit.** 2.3.1(b):
  *"Egregious or repeated behavior is grounds for removal from the Apple Developer
  Program."* The word "repeated" is doing real work there. **[FACT]**
- **[INFERENCE]** Advottic is now seven rounds in on the same app with a rejection history
  that already includes a 2.3.10 gating fix. The file is visible to reviewers. The
  practical risk is not a ban; it is that the app becomes a known-problem submission that
  draws stricter reads. That argues for one decisive, over-compliant submission rather than
  another incremental patch.

### 5.4 Appeal timing caveat

Appeals are not fast. Thread https://developer.apple.com/forums/thread/818150
("Appeal Submitted Over 30 Days Ago") and thread 773183, "No response to my appeals",
both document long silences. **[ANECDOTE]** The Meet with Apple appointment is the faster
channel.

---

## 6. The US link-out route in practice

### 6.1 What the May 2025 change did and did not do

**[FACT]** Apple updated the Guidelines effective 2025-05-01 to comply with the US court
order (https://developer.apple.com/news/?id=9txfddzf; contemporaneous reporting:
AppleInsider 2025-05-02, iClarified 2025-05-02, Michael Tsai 2025-05-02).

Current guideline text, 3.1.3 chapeau: *"Apps in this section cannot, within the app,
encourage users to use a purchasing method other than in-app purchase, **except for apps on
the United States storefront** and as set forth in 3.1.1(a) and 3.1.3(a)."* And per 3.1.1(a)
as reported: *"On the United States storefront, there is no prohibition on an app including
buttons, external links, or other calls to action, and no entitlement is required to do so."*

**The critical practical point, and the one that explains Advottic's round-7 rejection:**

> "The ruling did **not** remove the requirement to offer in-app purchases. Instead, it
> eliminated the anti-steering prohibition."
> Source: Swift with Vincent, "The rules of the App Store have changed", May 2025
> (https://www.swiftwithvincent.com/blog/the-rules-of-the-app-store-have-changed)
> **[ANECDOTE: secondary source, but consistent with the guideline text, which places the
> US exception only in the *steering* clauses and leaves 3.1.1's unlock requirement intact]**

So: adding "subscribe at advottic.com" made the link **legal**. It did **not** make the
app **exempt**. And it simultaneously destroyed the 3.1.3(c)/(f) *"no calls to action for
purchase outside of the app"* safe harbour. **[INFERENCE: but it is the only reading that
explains a 3.1.1 rejection pointing at 3.1.3(b) after a US-only link-out was shipped.]**

The apps that legitimately ship link-out-only with no IAP (Spotify, Kindle) are
**3.1.3(a) reader apps**. Legal case management is not a reader category (the enumerated
list is magazines, newspapers, books, audio, music, video). **[FACT]**

### 6.2 Does the link-out route work smoothly in practice? No.

**[ANECDOTE: 2026 secondary sources]**

- *"If you're submitting an external-link app in the first half of 2026, budget for two
  rejection rounds before you ship. External purchase links are not a free win."*
  (Stora, 2026-05-16)
- **Region leakage is the #1 killer.** *"Apps without a region check fail review for non-US
  regions and sometimes have the entitlement revoked entirely."* The same code path that is
  compliant in the US is a violation in most other storefronts. Advottic's US-only
  availability handles this, but it means the app cannot expand storefronts without
  re-architecting.
- **Companion apps still get rejected anyway**, *"even when they offer no sign-up and no
  purchase flow inside the app, because the reviewer reads the in-app content as paid
  digital content acquired outside the App Store."* That is verbatim Advottic's situation.
- **Embedded-browser link-outs are an instant rejection.** The link must leave the app to
  the default browser; SFSafariViewController / in-app browser does not count.
- Apple presents a **system disclosure sheet** before the user leaves; you cannot suppress
  or restyle it. (RevenueCat, "App-to-web", 2025-12-09, updated 2026-02-20.)

### 6.3 Commission status as of 2026-07-31

**[ANECDOTE: press reporting, verify before relying on it financially]**

- 2025-04: Judge Gonzalez Rogers held Apple in contempt; external links permitted from
  2025-05-01, Apple's 27% commission struck.
- 2025-12-11: Ninth Circuit largely upheld the contempt finding but ruled Apple **may**
  charge *some* fee on external purchases, just not 27% (MacRumors 2025-12-11; Fenwick).
- 2026-06-30: **Supreme Court granted cert** on Apple's appeal (MacDailyNews 2026-06-30);
  a decision is not expected before 2027 (TechCrunch 2026-04-06).
- 2026-07: Apple sought to pause the district-court commission proceedings pending SCOTUS;
  Epic opposed (9to5Mac 2026-07-07, 2026-07-13).
- **Net: 0% commission on US external links remains in effect until the district court sets
  a rate.** This is a live, moving target.

---

## 7. Sources

Apple primary:
- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/ (checked 2026-07-31)
- Tips from App Review: https://developer.apple.com/forums/thread/810791 (Dec 2025)
- Updated guidelines announcement: https://developer.apple.com/news/?id=9txfddzf (May 2025)
- Meet with Apple / App Review Appointments: https://developer.apple.com/events/
- App Review overview: https://developer.apple.com/distribute/app-review/

Apple Developer Forums (rejection text and developer reports):
- 781935: 3.1.3(f) clarification; phone consult; website-copy fix; 3.1.3(c) route (Apr 2025) **← most useful**
- 684850: WebView app; "remove account registration links and any fully qualified links"; Board overturned original rejection (Jul 2021)
- 802224: "behaves differently during the review process"; web-view payment (Sep 2025)
- 773357: 3.1.3(c) hybrid boilerplate rejection; Apple says appeal; unresolved as of Jun 2026 (Jan 2025)
- 811018: B2B SaaS, login-only, zero purchase surface, still rejected; unresolved (Dec 2025)
- 812386: external-subscription unlock, rejected 3×, cited Spotify; unresolved (Jan 2026)
- 724032: B2B hotel SaaS; appeal + business-model explanation → approved in 3 days; **Resolved** (Jan 2023)
- 818150 / 773183: appeal response-time complaints

Vendor help docs (observed product behaviour):
- Notion: https://www.notion.com/help/upgrade-or-downgrade-your-plan ; https://www.notion.com/help/billing
- Slack: https://slack.com/help/articles/218915087 ; https://slack.com/help/articles/221099048

App Store listings, all checked 2026-07-31 (US storefront):
- Slack id618783545 · Figma id1152747299 · Clio id686777370 · Notion id1232780281 · Canva id897446215

Secondary / practitioner:
- Stora, "How to Add External Purchase Links to Your iOS App in 2026": https://stora.sh/blog/2026-05-16-apple-app-store-external-purchase-links-implementation-guide (2026-05-16)
- RevenueCat, "App-to-web: navigating external purchases": https://www.revenuecat.com/blog/engineering/app-to-web-purchase-guidelines (2025-12-09, upd. 2026-02-20)
- Dodo Payments, "Selling Digital Goods Outside the App Store: A 2026 Compliance Playbook": https://dodopayments.com/blogs/digital-goods-outside-app-store (2026-05-10)
- Swift with Vincent, "The rules of the App Store have changed": https://www.swiftwithvincent.com/blog/the-rules-of-the-app-store-have-changed (May 2025)
- PTKD Journal, "Why did Apple reject my app under 3.1.1 for an in-app purchase link?": https://ptkd.com/journal/apple-rejection-3-1-1-in-app-purchase-links (site returned TLS errors on direct fetch; content available only via search-result excerpts, so treated as low-confidence)
- MacRumors 2025-12-11; Fenwick (Ninth Circuit analysis); TechCrunch 2026-04-06; MacDailyNews 2026-06-30; 9to5Mac 2026-07-07 and 2026-07-13

Advottic code inspected for context:
- `lib/platform.ts`: `AdvotticApp/ios` UA token, server-safe native detection
- `lib/iap-guard.ts`: fail-closed server-side 403 on iOS-app checkout
- `app/billing/tier-card.tsx:212` and `components/RestorePurchases.tsx:38` currently render
  a link to `https://advottic.com/pricing` labelled "View plans and subscribe at advottic.com"
  **inside the iOS app**. See §3 Tier 1 tripwire #3 and §6.1.
