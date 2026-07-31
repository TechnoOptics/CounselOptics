# Apple IAP guidelines research: what actually governs Advottic

Research date: **2026-07-31**. Every quotation below was retrieved live on that
date from the URL given directly above it. Nothing here is quoted from memory.

Occasion: App Review rejection dated 2026-07-29 citing Guideline 3.1.1, which
told Advottic that plans purchased on the web must also be purchasable via
In-App Purchase, and pointed at Guideline 3.1.3(b).

---

## 0. Source inventory

| Source | URL | Retrieved | Version marker |
| --- | --- | --- | --- |
| App Review Guidelines (live) | https://developer.apple.com/app-store/review/guidelines/ | 2026-07-31 | "Last Updated: June 8, 2026" |
| News: "Updated guidelines now available" (the US court-decision post) | https://developer.apple.com/news/?id=9txfddzf | 2026-07-31 | Dated May 1, 2025 |
| News: "Updated agreements and guidelines now available" | https://developer.apple.com/news/?id=r9dcmrvs | 2026-07-31 | Dated June 9, 2025 |
| News: "Updated Apple Developer Program License Agreement and App Review Guidelines now available" | https://developer.apple.com/news/?id=a233fmpw | 2026-07-31 | Dated June 8, 2026 (current guidelines revision) |
| News: "App Store Review Guideline updates now available" (origin of 3.1.3(f)) | https://developer.apple.com/news/?id=xqk627qu | 2026-07-31 | Dated September 11, 2020 |
| Support: "Distributing reader apps with a link to your website" | https://developer.apple.com/support/reader-apps/ | 2026-07-31 | live |
| Docs: External Purchase (StoreKit) | https://developer.apple.com/documentation/storekit/external-purchase (JSON: /tutorials/data/documentation/storekit/external-purchase.json) | 2026-07-31 | live |
| Docs: `com.apple.developer.storekit.external-purchase-link` | https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.storekit.external-purchase-link | 2026-07-31 | live |
| Support: StoreKit external entitlement, **US page** | https://developer.apple.com/support/storekit-external-entitlement-us/ | 2026-07-31 | **Now 301-redirects to /support/ (page retired)** |
| Support: StoreKit external entitlement, Netherlands dating apps | https://developer.apple.com/support/storekit-external-entitlement/ | 2026-07-31 | live |
| Apple Developer Forums thread 781935, "Need 3.1.3(f) Guidelines Clarification" (contains a verbatim App Review ruling) | https://developer.apple.com/forums/thread/781935 | 2026-07-31 | Posted Apr 2025 |
| Wayback Machine snapshots of the guidelines page | https://web.archive.org/web/*/https://developer.apple.com/app-store/review/guidelines/ | 2026-07-31 | used to date a silent wording change |

Secondary (litigation status only, clearly marked as such): 9to5Mac, MacRumors,
AppleInsider, supremecourt.gov docket PDF. Apple publishes nothing about the
commission dispute on developer.apple.com, so the litigation section is
necessarily non-Apple sourced.

---

## 1. Guideline 3.1.1: In-App Purchase (verbatim)

Source: https://developer.apple.com/app-store/review/guidelines/ (Last Updated:
June 8, 2026). Retrieved 2026-07-31.

> **3.1.1 In-App Purchase:**
>
> If you want to unlock features or functionality within your app, (by way of example: subscriptions, in-game currencies, game levels, access to premium content, or unlocking a full version), you must use in-app purchase. Apps may not use their own mechanisms to unlock content or functionality, such as license keys, augmented reality markers, QR codes, cryptocurrencies and cryptocurrency wallets, etc.
>
> Apps may use in-app purchase currencies to enable customers to "tip" the developer or digital content providers in the app.
>
> Any credits or in-game currencies purchased via in-app purchase may not expire, and you should make sure you have a restore mechanism for any restorable in-app purchases.
>
> Apps may enable gifting of items that are eligible for in-app purchase to others. Such gifts may only be refunded to the original purchaser and may not be exchanged.
>
> Apps distributed via the Mac App Store may host plug-ins or extensions that are enabled with mechanisms other than the App Store.
>
> Apps offering "loot boxes" or other mechanisms that provide randomized virtual items for purchase must disclose the odds of receiving each type of item to customers prior to purchase.
>
> Digital gift cards, certificates, vouchers, and coupons which can be redeemed for digital goods or services can only be sold in your app using in-app purchase. Physical gift cards that are sold within an app and then mailed to customers may use payment methods other than in-app purchase.
>
> Non-subscription apps may offer a free time-based trial period before presenting a full unlock option by setting up a Non-Consumable IAP item at Price Tier 0 that follows the naming convention: "XX-day Trial." Prior to the start of the trial, your app must clearly identify its duration, the content or services that will no longer be accessible when the trial ends, and any downstream charges the user would need to pay for full functionality. Learn more about managing content access and the duration of the trial period using Receipts and DeviceCheck.
>
> Apps may use in-app purchase to sell and sell services related to non-fungible tokens (NFTs), such as minting, listing, and transferring. Apps may allow users to view their own NFTs, provided that NFT ownership does not unlock features or functionality within the app. Apps may allow users to browse NFT collections owned by others, provided that, except for apps on the United States storefront, the apps may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase.

The only US-specific amendment inside 3.1.1 proper is the final clause of the
NFT paragraph. **The opening sentence, "If you want to unlock features or
functionality within your app … you must use in-app purchase", was not amended
by the US court decision and still reads exactly as it did before.** That is the
sentence the 2026-07-29 rejection rests on.

### 1a. Guideline 3.1.1(a): Link to Other Purchase Methods (verbatim)

> **3.1.1(a) Link to Other Purchase Methods:** Developers may apply for entitlements to provide a link in their app to a website the developer owns or maintains responsibility for in order to purchase digital content or services. These entitlements are not required for developers to include buttons, external links, or other calls to action in their United States storefront apps. Please see additional details below.
>
> **StoreKit External Purchase Link Entitlements:** apps on the App Store in specific regions may offer in-app purchases and also use a StoreKit External Purchase Link Entitlement to include a link to the developer's website that informs users of other ways to purchase digital goods or services. Learn more about these entitlements. In accordance with the entitlement agreements, the link may inform users about where and how to purchase those in-app purchase items, and the fact that such items may be available for a comparatively lower price. The entitlements are limited to use only in the iOS or iPadOS App Store in specific storefronts. In all other storefronts, except for the United States storefront, where this prohibition does not apply, apps and their metadata may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase.
>
> **Music Streaming Services Entitlements:** music streaming apps in specific regions can use Music Streaming Services Entitlements to include a link (which may take the form of a buy button) to the developer's website that informs users of other ways to purchase digital music content or services. These entitlements also permit music streaming app developers to invite users to provide their email address for the express purpose of sending them a link to the developer's website to purchase digital music content or services. Learn more about these entitlements. In accordance with the entitlement agreements, the link may inform users about where and how to purchase those in-app purchase items, and the price of such items. The entitlements are limited to use only in the iOS or iPadOS App Store in specific storefronts. In all other storefronts, streaming music apps and their metadata may not include buttons, external links, or other calls to action that direct customers to purchasing mechanisms other than in-app purchase.
>
> If your app engages in misleading marketing practices, scams, or fraud in relation to the entitlement, your app will be removed from the App Store and you may be removed from the Apple Developer Program.

Note the framing in the second paragraph: the entitlement scheme is described as
being for "apps … **[that] may offer in-app purchases and also** use a StoreKit
External Purchase Link Entitlement". Apple's model of a link-out is a *second*
purchase channel alongside IAP, not a *replacement* for it.

---

## 2. Guideline 3.1.3: Other Purchase Methods, preamble and every sub-clause (verbatim)

Same source and retrieval date.

> **3.1.3 Other Purchase Methods:** The following apps may use purchase methods other than in-app purchase. Apps in this section cannot, within the app, encourage users to use a purchasing method other than in-app purchase, except for apps on the United States storefront and as set forth in 3.1.1(a) and 3.1.3(a). Developers can send communications outside of the app to their user base about purchasing methods other than in-app purchase.

> **3.1.3(a) "Reader" Apps:** Apps may allow a user to access previously purchased content or content subscriptions (specifically: magazines, newspapers, books, audio, music, and video). Reader apps may offer account creation for free tiers, and account management functionality for existing customers. Reader app developers may apply for the External Link Account Entitlement to provide an informational link in their app to a web site the developer owns or maintains responsibility for in order to create or manage an account. This entitlement is not required for developers to include buttons, external links, or other calls to action in their United States storefront apps. Learn more about the External Link Account Entitlement.

> **3.1.3(b) Multiplatform Services:** Apps that operate across multiple platforms may allow users to access content, subscriptions, or features they have acquired in your app on other platforms or your web site, including consumable items in multi-platform games, provided those items are also available as in-app purchases within the app.

> **3.1.3(c) Enterprise Services:** If your app is only sold directly by you to organizations or groups for their employees or students (for example professional databases and classroom management tools), you may allow enterprise users to access previously-purchased content or subscriptions. Consumer, single user, or family sales must use in-app purchase.

> **3.1.3(d) Person-to-Person Services:** If your app enables the purchase of real-time person-to-person services between two individuals (for example tutoring students, medical consultations, real estate tours, or fitness training), you may use purchase methods other than in-app purchase to collect those payments. One-to-few and one-to-many real-time services must use in-app purchase.

> **3.1.3(e) Goods and Services Outside of the App:** If your app enables people to purchase physical goods or services that will be consumed outside of the app, you must use purchase methods other than in-app purchase to collect those payments, such as Apple Pay or traditional credit card entry.

> **3.1.3(f) Free Stand-alone Apps:** Free apps acting as a stand-alone companion to a paid web based tool (i.e. VoIP, Cloud Storage, Email Services, Web Hosting) do not need to use in-app purchase, provided there is no purchasing inside the app, or calls to action for purchase outside of the app.

> **3.1.3(g) Advertising Management Apps:** Apps for the sole purpose of allowing advertisers (persons or companies that advertise a product, service, or event) to purchase and manage advertising campaigns across media types (television, outdoor, websites, apps, etc.) do not need to use in-app purchase. These apps are intended for campaign management purposes and do not display the advertisements themselves. Digital purchases for content that is experienced or consumed in an app, including buying advertisements to display in the same app (such as sales of "boosts" for posts in a social media app) must use in-app purchase.

**Correction to a common assumption:** "Free Stand-alone Apps" is **3.1.3(f)**,
not 3.1.3(d). 3.1.3(d) is Person-to-Person Services. Citing "3.1.3(d) free
stand-alone" in an appeal would be citing the wrong clause.

What each clause exempts you from:

| Clause | Exempts you from | What you still may not do |
| --- | --- | --- |
| 3.1.3(a) Reader | IAP for accessing previously purchased magazines/newspapers/books/audio/music/video | Sell in-app by other means; qualify with non-media content |
| 3.1.3(b) Multiplatform | Nothing. It is a *permission to let cross-platform purchases unlock in the app*, conditioned on the same items **also** being IAPs | Omit the IAP |
| 3.1.3(c) Enterprise | IAP, for organizational buyers, accessing previously purchased subscriptions | Consumer / single-user / family sales: those "must use in-app purchase" |
| 3.1.3(d) P2P | IAP for real-time 1:1 services | One-to-few and one-to-many services |
| 3.1.3(e) Physical goods | IAP (in fact IAP is forbidden here) | Use IAP for physical goods |
| 3.1.3(f) Free stand-alone | IAP entirely, for a free companion app to a paid web tool | Any in-app purchasing **or** any call to action to purchase outside the app |
| 3.1.3(g) Ad management | IAP for ad campaign buying | Sell in-app-consumed content |

---

## 3. A silent narrowing of 3.1.3(f) that matters enormously

3.1.3(f) was introduced on **September 11, 2020**
(https://developer.apple.com/news/?id=xqk627qu, retrieved 2026-07-31), where
Apple's own changelog wrote it as:

> 3.1.3(f): Free Stand-alone Apps: Free apps acting as a stand-alone companion to a paid web based tool (eg. VOIP, Cloud Storage, Email Services, Web Hosting) do not need to use in-app purchase, provided there is no purchasing inside the app, or calls to action for purchase outside of the app.

The live guideline today reads "**i.e.**", not "e.g.". Wayback snapshots of
https://developer.apple.com/app-store/review/guidelines/ (all fetched
2026-07-31) date the change precisely:

| Snapshot | Page's own "Last Updated" | Wording |
| --- | --- | --- |
| 2025-06-03 | April 30, 2025 | "(**e.g.** VoIP, Cloud Storage, Email Services, Web Hosting)" |
| 2025-06-06 | April 30, 2025 | "(e.g. …)" |
| 2025-06-09 | April 30, 2025 | "(e.g. …)" |
| 2025-06-11 | **June 9, 2025** | "(**i.e.** VoIP, Cloud Storage, Email Services, Web Hosting)" |
| 2025-09-01 → 2026-07-15 | later revisions | "(i.e. …)" |

So the change shipped with the **June 9, 2025** revision. Apple's changelog for
that revision (https://developer.apple.com/news/?id=r9dcmrvs, retrieved
2026-07-31) lists only 3.1.2(a), 3.2.1(viii) and 3.2.2(x) under App Review
Guidelines; **the 3.1.3(f) wording change was not announced**.

This is not a typo fix. Two months earlier, in April 2025, App Review had
already told a developer in writing, in public, that the list is closed.

Source: https://developer.apple.com/forums/thread/781935 ("Need 3.1.3(f)
Guidelines Clarification", posted Apr 2025), retrieved 2026-07-31. The thread
starter quotes his reviewer verbatim:

> Please note that Guideline 3.1.3(f) only applies to apps offering one of the following kinds of web-based services:
>
> * VoIP
> * Cloud storage
> * Email
> * Website domain hosting services

An account flagged **App Review (Apple staff)** replied in the same thread
("Thank you for your post. We believe we have resolved this issue…"). The
developer's later summary of a phone call with a reviewer:

> All of the reviewers consistently interpret the 3.1.3(f) "e.g." as "specifically". The reviewer and I talked about this directly. Even though there are cases such as 3.1.3(a) that use the term "specifically", 3.1.3(f) is being interpreted by the reviewers as IF it says "specifically." Doesn't seem to be a way around that.

His own product was a no-code data platform sold to companies, with a free
mobile app for invited team members who buy nothing. His resolution was to
re-position for **3.1.3(c) Enterprise Services**, and specifically to fix three
things:

> we used the word "INDIVIDUAL" payment plans … it was misinterpreted to mean that the product was meant for an individual. So we corrected the web site wording. With this change, we should qualify under 3.1.3(c).

> our app included the ability for invited users … to "sign-up" through the app … But this lead the reviewer to believe that they should be allowed to create a subscription through the app…which isn't possible. So we're going to change that.

> know that the reviewers take into account the entire picture of your app that you present. So be aware of the perception that they can get from the way you present your product on your website.

**Answer to "are the four examples exhaustive or illustrative": as written
today, exhaustive.** The parenthetical says "i.e."; App Review says in writing
that it "only applies to" those four service types; and Apple silently changed
"e.g." to "i.e." to match. Legal case-management software is not VoIP, cloud
storage, email, or domain hosting. **3.1.3(f) is not a lane Advottic can rely
on.**

---

## 4. Reader apps (3.1.3(a)): does legal case management fit? No.

Source: https://developer.apple.com/support/reader-apps/, retrieved 2026-07-31.

> Reader apps are apps that provide one or more of the following digital content types (magazines, newspapers, books, audio, music, or video) as the primary functionality of the app. With reader apps, people can sign in to their account created outside the app, letting them view and enjoy previously purchased media content or content subscriptions on their Apple device.

Eligibility list, verbatim:

> In order to be eligible, your app must:
> * As the primary functionality of your app, provide one or more of the following digital content types: magazines, newspapers, books, audio, music, or video.
> * Allow people to sign in to an account.
> * Allow people to access content or services previously purchased outside of the app when signed in, such as on your website.
> * Not offer in-app purchases on iOS, iPadOS, or tvOS while using the External Link Account Entitlement.
> * Not facilitate real-time, person-to-person services (e.g., providing tutoring services, medical consultations, real estate tours, or fitness training).

> Note: Apps that let people access digital content such as music or video, but not as the primary functionality, are not considered reader apps and are not eligible for the External Link Account Entitlement. For example, a social networking app that lets people stream audiovisual content is not eligible.

Honest judgment: **Advottic is not a reader app.** The enumerated content types
are a closed media list ("specifically:" in the guideline itself). Case files,
timelines, evidence and AI analysis are not magazines, newspapers, books, audio,
music, or video. Internal Advottic code and docs that describe the current iOS
behaviour as the "reader model" are using the word loosely; that framing has no
support in 3.1.3(a) and should not be used in an appeal, because it invites the
reviewer to check the enumerated list and find no fit.

---

## 5. The US link-out situation as of July 2026

### 5.1 The Apple Developer News post the rejection points to

Source: https://developer.apple.com/news/?id=9txfddzf, retrieved 2026-07-31.
Full text of the post:

> **Updated guidelines now available**
> May 1, 2025
> The App Review Guidelines have been updated for compliance with a United States court decision regarding buttons, external links, and other calls to action in apps. These changes affect apps distributed on the United States storefront of the App Store, and are reflected in updates to Guidelines 3.1.1, 3.1.1(a), 3.1.3, and 3.1.3(a).
> View the App Review Guidelines
> Translations of the guidelines will be available on Apple Developer website within one month.

That is the entire post. Apple never published implementation guidance, a
disclosure-sheet spec, or a commission schedule for US link-outs. **This is
almost certainly the "News post on Apple Developer" referenced in the
2026-07-29 rejection.**

### 5.2 Is the StoreKit External Purchase Link Entitlement still required in the US?

No, and the US programme appears to have been dismantled entirely. Three
independent primary indicators, all retrieved 2026-07-31:

1. The guideline text itself: "These entitlements are **not required** for
   developers to include buttons, external links, or other calls to action in
   their **United States storefront** apps" (3.1.1(a)); and "In all other
   storefronts, **except for the United States storefront, where this
   prohibition does not apply**, apps and their metadata may not include
   buttons, external links, or other calls to action…".
2. Apple's US entitlement support page,
   `https://developer.apple.com/support/storekit-external-entitlement-us/`, now
   **301-redirects to `/support/`**. Wayback CDX shows it returned HTTP 200 with
   real content through 2025-04-05 and had become a 301 by 2025-05-19, i.e. it
   was pulled within days of the May 1, 2025 guideline change.
3. Apple's current StoreKit **External Purchase** documentation
   (`/documentation/storekit/external-purchase`) enumerates the regions where
   external-purchase entitlements apply: the **EU / EEA, Russia, Brazil, Japan**,
   plus the Music Streaming Services EEA entitlement. **The United States is not
   in the list at all.** There is no US external-purchase API path to implement.

Practical consequence: in the US there is **no entitlement to request, no
`SKExternalPurchaseLink` Info.plist key to set, no `canMakePayments` precondition,
and no Apple-mandated modal disclosure sheet**. The elaborate UI requirements
documented on `/support/storekit-external-entitlement/` (external purchase modal
sheet, "You're about to leave the app…", "I Understand" button, no query
parameters, no redirects, default browser only) apply to the Netherlands dating
app programme and the EU/Japan/Brazil programmes, **not to the US storefront**.
A US-only app linking to advottic.com needs none of them.

### 5.3 Commission on US link-outs

Apple publishes nothing on developer.apple.com about a US link-out commission
today. This section is therefore sourced from litigation reporting and the
public docket, and is flagged as secondary:

* Apr 30, 2025: N.D. Cal. (Judge Yvonne Gonzalez Rogers) held Apple in civil
  contempt and barred it from collecting any fee on US link-outs. Apple changed
  App Store rules the next day (the May 1, 2025 news post above).
* The Ninth Circuit subsequently held Apple **may** charge some commission on
  external link purchases but remanded the rate to the district court.
* May 4, 2026: Apple applied to the Supreme Court to stay the mandate
  (https://www.supremecourt.gov/DocketPDF/25/25A1213/407958/20260504154515930_2026-05-04%20Apple-Epic%20SCT%20Application%20to%20Stay%20Mandate.pdf).
  **May 6, 2026: Justice Kagan denied the stay**
  (https://9to5mac.com/2026/05/06/supreme-court-rejects-apples-stay-request-epic-games-case-to-head-back-to-district-court/,
  https://appleinsider.com/articles/26/05/06/supreme-court-denies-apples-hopes-for-breathing-space-in-its-fight-against-epic).
* **Jun 30, 2026: the Supreme Court granted certiorari**, limited to whether
  "a court may hold a party in civil contempt based on a violation of an
  injunction's 'spirit' where the injunction is silent as to the conduct upon
  which contempt is based." Argument in the term beginning October 2026;
  decision not expected before mid-2027
  (https://www.macrumors.com/2026/06/30/apple-epic-games-supreme-court/,
  https://9to5mac.com/2026/06/30/supreme-court-agrees-to-hear-apple-appeal-over-epic-games-ruling/).
* Jul 13, 2026: Apple asked the district court to pause the rate-setting
  proceedings; Epic opposed
  (https://9to5mac.com/2026/07/13/epic-games-fights-apples-request-to-pause-app-store-commission-proceedings/).

**Net as of 2026-07-31: US link-outs are permitted without entitlement and
Apple is collecting no commission on them, but a rate is being litigated and
could be imposed prospectively.** The historical 27% / 12% figures that still
appear in blog posts describe the pre-May-2025 US regime and are stale.

### 5.4 Does the US allowance cover *accessing* content bought elsewhere?

**No, and this is the resolution of the tension in the rejection letter.**

Read the May 1, 2025 post carefully: it is "for compliance with a United States
court decision regarding **buttons, external links, and other calls to action**".
The Epic injunction was an *anti-steering* remedy. Everything the US carve-out
touches is steering: 3.1.1's NFT sentence (calls to action), 3.1.1(a) (link
entitlements), 3.1.3's preamble (encouraging other purchase methods), and
3.1.3(a) (reader-app account links). **All four amended locations are about
communicating a purchase option. None of them is about whether digital
functionality may be unlocked in the app by an entitlement bought elsewhere.**

That second question is still governed by unamended 3.1.1 ("If you want to
unlock features or functionality within your app … you must use in-app
purchase") and by the 3.1.3 category list. So Apple's letter is internally
consistent, even though it reads as contradictory:

* *You may link out.* (True: US storefront, no entitlement, no fee today.)
* *You must still offer IAP for the thing the app unlocks*, unless you fall in a
  3.1.3 category. (Also true.)

Linking out is a **permission to steer**, not an **exemption from IAP**.

---

## 6. Analysis

### 6.1 Q3: which lane actually applies to a B2B/professional SaaS?

**3.1.3(f) Free Stand-alone Apps: ruled out on category.** Apple now writes
"i.e." and App Review has stated in writing that the clause "only applies to"
VoIP, cloud storage, email, and website domain hosting services (§3 above).
Advottic is none of those. Even if the category fit, the proviso "provided there
is no purchasing inside the app, **or calls to action for purchase outside of
the app**" is violated today: `app/billing/tier-card.tsx`,
`app/billing/personal-tier-card.tsx` and `components/RestorePurchases.tsx` all
render a link reading "View plans and subscribe at advottic.com" pointing to
`https://advottic.com/pricing` when the platform is iOS. That string is a
textbook call to action for purchase outside the app.

**3.1.3(b) Multiplatform Services: this is the trigger that fired.** Its
condition is unconditional: cross-platform entitlements may unlock in the app
"**provided those items are also available as in-app purchases within the
app**". The trigger is not "the app sells something". The trigger is "**the app
lets a user access content, subscriptions or features acquired elsewhere**".
Advottic does exactly that: sign in with a Stripe-purchased plan, get the paid
features. So 3.1.3(b) applies **by default** to any cross-platform paid service,
and the only way out is to land inside a *different* 3.1.3 sub-clause that
grants access without an IAP condition, which is precisely what (a), (c) and
(f) each do for their own narrow categories. That is why the rejection cites
3.1.1 as the violation and 3.1.3(b) as the cure.

**3.1.3(c) Enterprise Services: the only lane that plausibly fits Advottic,
and it fits only part of the product.** Verbatim: "If your app is only sold
directly by you to organizations or groups for their employees or students (for
example **professional databases** and classroom management tools), you may
allow enterprise users to access previously-purchased content or subscriptions.
**Consumer, single user, or family sales must use in-app purchase.**"

A law-firm matter-management workspace sold to a firm for its attorneys and
staff is a strong fit for "professional databases … sold directly by you to
organizations or groups for their employees". The forum thread shows App Review
steering a comparable B2B SaaS to exactly this clause.

But `lib/entitlements.ts` shows Advottic also sells a **consumer ladder** direct
to individuals: `STRIPE_PRICE_PERSONAL_STARTER / PLUS8 / PRO15 / ULTRA` (plus
legacy `BASIC`/`STANDARD`/`PRO` and `PERSONAL_PRO`/`PERSONAL_PLUS`), alongside
the firm ladder (`COUNSEL_SOLO / SMALL_FIRM / GROWING / ENTERPRISE`). Those
personal plans are "consumer, single user" sales. Under the last sentence of
3.1.3(c), **those must use in-app purchase** if the iOS app unlocks them. The
firm ladder can live under 3.1.3(c); the personal ladder, as sold today, cannot.

**Conclusion:** there is no clause that lets a single iOS binary unlock both a
self-serve consumer subscription and a firm subscription, both bought on the web,
with no IAP. Advottic has to pick one of:

* **(A) Enterprise-only iOS.** The iOS app serves organizational accounts only.
  Consumer/personal accounts do not get paid functionality on iOS (or are not
  supported on iOS at all). Remove every purchase CTA from the app. Present the
  product on advottic.com as sold to firms/organizations, not to individuals.
  Cite 3.1.3(c) in review notes.
* **(B) IAP parity.** Ship auto-renewable IAP subscriptions matching the plans
  the app unlocks (at minimum the consumer ladder), per 3.1.3(b). This is Apple's
  own stated cure and the only lane with no interpretive risk. Note the standing
  decision recorded in project memory to remove Apple IAP entirely after the
  RevenueCat native-skew freeze; choosing (B) reverses that, and would need a
  clean StoreKit 2 implementation rather than a resurrection of RevenueCat.

Anything else is a re-litigation of the same rejection.

### 6.2 Q4: the US link-out situation

Answered in §5. Summary: permitted, entitlement-free, fee-free today, no
Apple-mandated disclosure UI on the US storefront; it authorises **steering
only**; and the referenced news post is
https://developer.apple.com/news/?id=9txfddzf (May 1, 2025).

One extra consequence specific to Advottic: because the app currently shows
"View plans and subscribe at advottic.com", the reviewer sees an app that
markets a web subscription to the person holding the phone. That is legal in the
US, but it actively **undermines** an enterprise-services argument, because it
presents the purchase as something the individual user does. If Advottic pursues
lane (A), those CTAs must go, not because linking out is banned, but because
they characterise the sale as consumer and self-serve.

### 6.3 Q5: under a no-purchase, no-CTA build, may an existing subscriber sign in and use paid features?

Yes, but only if the app is inside a 3.1.3 category. The permission to sign in
and use what you already bought is granted by the *category clause*, never by
the mere absence of a buy button:

* 3.1.3(a): "Apps **may allow a user to access previously purchased content or
  content subscriptions**": reader media only.
* 3.1.3(c): "you **may allow enterprise users to access previously-purchased
  content or subscriptions**": organizational sales only.
* 3.1.3(f): the entire premise is a free app that is "a stand-alone companion to
  a **paid** web based tool" (the user pays on the web and uses the app), but
  only for the four enumerated service types.
* 3.1.3(b): access is allowed for anything cross-platform, **conditioned on IAP
  parity**.

There is no general "if you don't sell anything in the app, anything goes" rule.
Removing the buy button is **necessary but not sufficient**: a build with no
purchase and no CTA that still unlocks a web-bought consumer subscription, and
that fits no 3.1.3 category, is exactly the app 3.1.1 sentence one prohibits and
3.1.3(b) redirects to IAP.

Nothing in the guidelines prohibits a sign-in wall as such. Guideline 5.1.1(v)
only requires login-free access where the app "doesn't include significant
account-based features", and a case-management client plainly does. (Separately,
App Review needs working credentials: "Provide App Review with full access to
your app… provide either an active demo account or fully-featured demo mode".)

**Why Slack, Notion, Salesforce, Figma and Linear ship with no IAP.** Verified
part: their App Store listings are free, they contain no IAP, and the paid plan
is bought on the web. Inference part (Apple has published no ruling on any of
them): they read as **3.1.3(c) Enterprise Services**: sold to organizations for
their employees, seat-based, admin-provisioned; the iOS app is a client for
people whose employer already paid, and the individual holding the phone
typically is not the purchaser. Their apps also, historically, carried no
in-app purchase CTA at all. Notion and Figma do sell individual plans on the
web, which sits uneasily with the last sentence of 3.1.3(c); the honest reading
is that enforcement is uneven and predominantly organizational positioning
carries the day. **Do not build a submission strategy on "but Notion does it".
That is an observation about enforcement, not a rule you can cite.** The citable
rule is 3.1.3(c), and its qualifying condition is who you sell to.

---

## 7. What is still uncertain

1. **Whether 3.1.3(f)'s "no calls to action" proviso is relaxed for US-storefront
   apps.** The 3.1.3 preamble now says apps in the section "cannot, within the
   app, encourage users to use a purchasing method other than in-app purchase,
   **except for apps on the United States storefront**", which could be read as
   overriding the proviso inside (f). But (f)'s proviso is written as a
   *qualifying condition* for the category, not as an anti-steering rule. Apple
   has published no clarification. Moot for Advottic (the category doesn't fit),
   but unresolved as a matter of text.
2. **Whether App Review's April 2025 forum answer about the four service types
   is formal policy.** It was quoted by a developer, not posted by Apple, though
   an Apple-staff "App Review" account replied in the same thread and Apple's
   subsequent "e.g."→"i.e." edit corroborates it. Apple has published no standalone
   statement that the list is closed.
3. **Whether a mixed consumer + firm product can qualify under 3.1.3(c) by
   restricting the iOS app to organizational accounts** while consumer plans
   continue to exist on the web. The guideline's condition is about the **app**
   ("If your app is only sold directly by you to organizations…"), and Advottic's
   app is one binary serving both audiences. Whether Apple accepts an
   iOS-side restriction, or looks at advottic.com and sees consumer plans and
   refuses, is not determinable from published text. The forum thread suggests
   reviewers weigh the **website's** positioning heavily.
4. **The eventual US link-out commission.** Zero today. The Ninth Circuit has
   said Apple may charge something; the rate is before Judge Gonzalez Rogers; the
   Supreme Court hears the contempt question in the term starting October 2026.
   A rate could be set while Advottic is mid-cycle. (Irrelevant if Advottic
   carries no purchase CTA; relevant if it keeps link-outs.)
5. **Whether Apple would accept an appeal citing 3.1.3(c) without a product
   change.** No published precedent. Given six rejections, an appeal that does
   not visibly change the binary is unlikely to land.
6. **Apple's per-app review notes are not policy.** Everything a reviewer writes
   in Resolution Center (including the 2026-07-29 letter) is an application of
   the guidelines to one build, not a general rule. Only the guidelines page and
   Apple's support/news pages are authoritative, and only in their live version.

---

## 8. One-paragraph bottom line

The US court decision bought Advottic the right to *tell* users about
advottic.com inside the app. It did not buy the right to *unlock* a
web-purchased subscription inside the app. That still requires either an IAP for
the same plan (3.1.3(b)) or membership of a 3.1.3 exemption category. Advottic is
not a reader app (3.1.3(a)) and is not VoIP/cloud storage/email/web hosting
(3.1.3(f), now closed by "i.e."). The only viable exemption is **3.1.3(c)
Enterprise Services**, which fits the firm product and expressly excludes the
consumer/personal ladder. Choose: make iOS an enterprise client with zero
purchase CTAs, or ship IAP.
