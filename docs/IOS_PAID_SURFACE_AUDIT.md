# iOS paid-surface audit

Reconnaissance for the Guideline 3.1.1 rejection of build 22 (2026-07-29) and
for evaluating Guideline 3.1.3(d) (free stand-alone companion app, which
requires **zero** purchasing in the app **and zero** calls to action to
purchase outside it).

Audited commit: `c0efbeb` (working tree, no modifications made).
Repo: `/Users/technooptics/Advottic/CounselOptics`.

**Architecture reminder.** The iOS app is a remote-URL Capacitor shell
(`capacitor.config.ts:43` - `server.url: 'https://advottic.com'`). There is no
bundled iOS UI beyond a branded offline page. Everything the reviewer sees is
the live web app deciding what to render for an iOS request. Any change here
ships instantly to already-installed builds.

---

## 1. iOS detection

### 1.1 The five mechanisms

| # | Mechanism | Where | Rendered | Race-free? |
|---|---|---|---|---|
| 1 | **UA token** `AdvotticApp/ios` appended to the WKWebView User-Agent | `capacitor.config.ts:68` (`ios.appendUserAgent`); mirrored into the signed binary at `ios/App/App/capacitor.config.json` | native binary | n/a (binary property) |
| 2 | **Server-side UA parse** → `NativePlatform` | `lib/platform.ts:65-77` (`NATIVE_UA_TOKEN`, `nativePlatformFromUserAgent`) | **server** | **Yes - race-free.** Decided before the first byte of HTML. |
| 3 | **`<html>` class from the server** | `lib/platform.ts:86-90` (`nativeHtmlClass`) applied at `app/layout.tsx:406-413` | **server** | **Yes.** Class is in the SSR'd `<html>` tag. |
| 4 | **Client bridge boot script** (backstop) | `components/NativePlatformBoot.tsx:36`, mounted in `<head>` at `app/layout.tsx:422` | client, inline `<head>` script | **No - retries for up to 3 s.** See 1.3. |
| 5 | **Client React hook** `useIsNativeApp()` | `components/useIsNativeApp.ts:19-32` → `lib/platform.ts:26-49` (`getNativePlatform`) | client, `useEffect` | **No - one-shot, no retry.** This is the mechanism that caused the 2026-07-02 rejection. |

`middleware.ts` does **not** participate in iOS detection at all - it only calls
`updateSession` and forwards `x-pathname`. There is no cookie-based and no
env-flag-based iOS detection anywhere.

### 1.2 The canonical helper and its exact semantics

```ts
// lib/platform.ts:70-77
export function nativePlatformFromUserAgent(ua: string | null | undefined): NativePlatform {
  if (!ua) return 'web';
  if (ua.includes(NATIVE_UA_TOKEN.ios)) return 'ios';        // 'AdvotticApp/ios'
  if (ua.includes(NATIVE_UA_TOKEN.android)) return 'android';
  return 'web';
}
```

**Semantics:** substring match on the UA. Fails **open** (returns `'web'`) when
the token is absent. That "fail open" direction is the dangerous one: an iOS
session that loses the token is treated as a web browser and gets the full
purchase UI.

Consumers of the server signal:

| Consumer | file:line |
|---|---|
| `<html>` class | `app/layout.tsx:406` |
| `/pricing` whole-page branch | `app/pricing/page.tsx:294-295` |
| `/billing` plan-ladder branch | `app/billing/page.tsx:200`, `:305` |
| `/billing` top-up section branch | `app/billing/page.tsx:~360` (`serverPlatform !== 'ios' && <TopUpButtons />`) |
| `TierCard` prop | `app/billing/tier-card.tsx:100`, `:119` |
| `PersonalTierCard` prop | `app/billing/personal-tier-card.tsx:61`, `:67` |
| `RestorePurchases` prop | `components/RestorePurchases.tsx:22`, `:26` |
| Server 403 purchase guard | `lib/iap-guard.ts:23-34` |

### 1.3 Race analysis - where flicker is still possible

**A. CSS gating is race-free on current builds, racy on older ones.**
`app/globals.css:71-78`:

```css
.is-native-app [data-hide-in-app] { display: none !important; }
.is-ios-app    [data-hide-on-ios] { display: none !important; }
[data-show-in-app] { display: none !important; }
.is-native-app [data-show-in-app] { display: revert !important; }
```

The class arrives on the SSR'd `<html>` (mechanism 3), so no flash - **provided
the binary sends the UA token**. `NativePlatformBoot` (`components/NativePlatformBoot.tsx:36`)
is the fallback for binaries predating the token: it polls
`window.Capacitor.getPlatform()` every 50 ms up to 60 times (**3 seconds**). On
such a build, purchase UI is visible for up to 3 seconds. Its own header comment
concedes this: "Worst case inside the app is a sub-second badge flash before the
class lands."

**B. `useIsNativeApp()` is still wired into three purchase components.**
`app/billing/tier-card.tsx:118-119`, `app/billing/personal-tier-card.tsx:66-67`,
`components/RestorePurchases.tsx:25-26` all compute:

```ts
const isIOS = serverPlatform === 'ios' || (ready && platform === 'ios');
```

The `serverPlatform ===` term short-circuits, so the client race can only ever
*add* iOS-ness, never remove it. **This specific expression is safe.** The
client hook is a widen-only backstop here.

**C. The real residual race is the server branch, not the client.**
`/pricing` (`app/pricing/page.tsx:295`) and the `/billing` plan ladder
(`app/billing/page.tsx:305`) branch **only** on `serverPlatform`. Their non-iOS
branches carry **no** `data-hide-on-ios` markers, so the CSS backstop cannot
help them. If the UA token is ever missing (older binary, a WebView that drops
the appended UA, a proxy that rewrites it), the reviewer sees the **complete
five-rung price ladder with live Stripe Subscribe buttons**. There is no second
line of defence on those two routes.

**D. `ExternalLink`'s native check is click-time, not render-time.**
`components/ExternalLink.tsx:27` calls `isNativeApp()` inside the click handler,
by which point the bridge is certainly present. No race - but see §5 for why
this component is itself the problem.

---

## 2. Every purchase / pricing surface

Legend for "iOS today":
- **HIDDEN (CSS)** - present in the DOM, hidden by `data-hide-on-ios` /
  `data-hide-in-app`. Not visible, but shipped in the HTML.
- **NOT RENDERED** - server branch omits it entirely.
- **VISIBLE** - reachable and visible inside the iOS app.

### 2.1 The five "subscribe at advottic.com" link-outs (commit `1168e61`)

These are the surfaces that most directly contradict both the App Review Notes
and Guideline 3.1.3(d). All five are **VISIBLE on iOS by design** - they are the
iOS branch.

| # | file:line | Copy | Target |
|---|---|---|---|
| 1 | `app/pricing/page.tsx:304-309` | "View plans & subscribe at advottic.com" (styled as a primary button) | `https://advottic.com/pricing` |
| 2 | `app/billing/page.tsx:318-323` | "View plans and subscribe at advottic.com" | `https://advottic.com/pricing` |
| 3 | `app/billing/tier-card.tsx:211-216` | "Your access unlocks here automatically once your account is subscribed." + "View plans and subscribe at advottic.com" | `https://advottic.com/pricing` |
| 4 | `app/billing/personal-tier-card.tsx:143-149` | Same pair as #3 | `https://advottic.com/pricing` |
| 5 | `components/RestorePurchases.tsx:37-42` | "View plans and subscribe at advottic.com" | `https://advottic.com/pricing` |

`git show --stat 1168e61` confirms exactly these five files. Each is a literal
call to action to purchase outside the app, opened in an **in-app** browser
(§5), with **no** External Link Account / External Purchase entitlement on the
binary (`ios/App/App/App.entitlements` contains only the App Group).

### 2.2 Prices and plan names rendered on iOS

| file:line | What renders | iOS today |
|---|---|---|
| `app/billing/tier-card.tsx:166-168` | `${f.monthlyPriceUsd} / month` in a 3xl bold price block | **VISIBLE** - the price element sits **above** the `isIOS` branch and is never gated. Any route that renders `TierCard` shows a price on iOS. |
| `app/billing/personal-tier-card.tsx:109` | `${tier.priceUsd}` price block | **VISIBLE** - same structural problem; gated only below, at the button. |
| `app/billing/page.tsx:305-325` | iOS branch: "Your plan / {TIER_LABEL} - active" or "Free plan" | VISIBLE (intentional) |
| `app/pricing/page.tsx:296-315` | iOS branch: "Plans" heading + link-out | VISIBLE (intentional) |
| `app/gift/gift-form.tsx:276-298` | Order summary: tier name, "Annual prepay discount (20%)", **"Total today" $ amount** | **VISIBLE** - the total block has **no** `data-hide-on-ios`; only the plan fieldset (`:162`), duration fieldset (`:205`) and submit button (`:303`) are gated. |
| `app/cases/new/page.tsx:118-119` | "the Pro plan ($19/mo) gives you 20 items + 500K Bella tokens" | HIDDEN (CSS) |
| `app/billing/topup-buttons.tsx:59` | `${o.usd}` on each Boost pack card | HIDDEN (CSS at `:52`) + NOT RENDERED (`app/billing/page.tsx` gates `<TopUpButtons />` on `serverPlatform !== 'ios'`) |
| `app/cases/[id]/review-panel.tsx:170` | "…included with Personal Plus." | HIDDEN (CSS); `data-show-in-app` twin at `:169` |
| `app/cases/[id]/timeline/page.tsx:108-112` | "Available on Personal Plus (submit & overview) and firm plans" | HIDDEN (CSS) |
| `app/what-is-advottic/page.tsx:221`, `:347` | "$19/month … $59/seat/month … Enterprise from $1,800/month" | `:347` prose is **VISIBLE**; only the `/pricing` link at `:348` is gated |
| `app/es/que-es-advottic/page.tsx:114`, `:221-222` | Spanish equivalent, "$19/mes … $59 por usuario al mes" | prose **VISIBLE**; link gated |
| `app/compare/[slug]/page.tsx:263` | "Counsel Small Firm starts at $99 per user per month…" | **VISIBLE** (ungated prose) |
| `app/compare/[slug]/page.tsx:271` | `<Link href="/pricing" className="btn-secondary">` | **VISIBLE** - ungated (only the sign-in CTA at `:268` is gated) |
| `app/affiliate/page.tsx:40`, `:50`, `:53`, `:58` | Commission blurbs naming Personal Pro / Plus / Solo / Small Firm / Growing Firm / Enterprise | **VISIBLE**; only the `/pricing` link at `:241` is gated |

### 2.3 Upgrade / paywall CTAs

| file:line | Copy | Target | iOS today |
|---|---|---|---|
| `app/billing/page.tsx:495` | **"Buy a Boost pack →"** | `#topup` | **VISIBLE - ungated.** Inside `ItemsGauge`, which renders for **every** signed-in user on `/billing`. |
| `app/billing/page.tsx:498-502` | **"Compare tiers"** | `/pricing` | **VISIBLE - ungated.** Same block. |
| `app/billing/page.tsx:485-490` | "You're N items past your plan limit. The next billing cycle will deduct about N tokens…" | - | **VISIBLE - ungated.** |
| `app/billing/page.tsx:508-511` | "…Consider upgrading if you'll keep growing." | - | **VISIBLE - ungated.** |
| `app/billing/page.tsx:271-294` | Tokens row: "Top up tokens →" / **"Upgrade to enable top-ups"** | `#topup` / `#tiers` | HIDDEN (CSS at `:271`) |
| `app/billing/page.tsx:240-244` | Stripe customer-portal `ManageButton` | Stripe billing portal | HIDDEN (CSS) |
| `app/billing/page.tsx:382-385` | "Payments are processed by Stripe…" | - | HIDDEN (CSS) |
| `app/billing/page.tsx:167-192` | "**Your trial has ended.** Subscribe below to keep creating cases…" (two copies, `isPeriodPast` + `?gate=trial-ended`) | - | **VISIBLE - ungated.** Says "Subscribe below" on a page whose ladder is not rendered on iOS. |
| `app/billing/page.tsx:142-160` | "Subscription confirmed" / "Checkout canceled…" / "Top-up confirmed" / "Top-up canceled. No charge has been made." | - | **VISIBLE - ungated** (query-param driven) |
| `components/TrialBanner.tsx:146-151` | **"Subscribe"** button (expired banner) | `/billing` | HIDDEN (CSS at `:147`) |
| `components/TrialBanner.tsx:142` | "…**Subscribe** to keep using Bella, Advottic Review, and create new cases." | - | **VISIBLE - ungated body copy** |
| `components/TrialBanner.tsx:196-201` | **"Subscribe"** button (trialing banner) | `/billing` | HIDDEN (CSS at `:197`) |
| `components/TrialBanner.tsx:180-183` | "**Subscribe** before it ends to keep Bella…" / "**Subscribe** before the trial ends…" | - | **VISIBLE - ungated body copy** |
| `components/TrialBanner.tsx:177` | " · Plus" / " · Pro" tier name | - | HIDDEN (CSS) |
| `app/inbox/documents/page.tsx:64-66` | **"Upgrade to Pro"** button | `/billing` | HIDDEN (CSS) |
| `app/inbox/documents/page.tsx:47`, `:52` | "Pro feature" / "With Advottic Pro, " | - | HIDDEN (CSS), `data-show-in-app` twins present |
| `app/cases/[id]/review-panel.tsx:173-179` | **"Unlock the full review"** button | `/billing` | HIDDEN (CSS at `:175`) |
| `app/cases/[id]/review-panel.tsx:535-537` | "N more - unlock with Personal Plus" | `/billing` | HIDDEN (CSS); `data-show-in-app` twin at `:532` |
| `app/cases/[id]/timeline/page.tsx:115-121` | **"See plans"** button | `/billing` | HIDDEN (CSS) |
| `app/cases/new/page.tsx:120`, `:137`, `:154` | "Compare tiers →" / "See if upgrading saves you money →" / "Tier comparison" | `/pricing` | HIDDEN (CSS) |
| `app/cases/new/page.tsx:116-117` | "**You're on Free with N item.** Creating another item requires a paid tier" | - | **VISIBLE - ungated** (only the trailing price clause is gated) |
| `app/page.tsx:762-780` | Home `PricingCta` section: "Three tiers, monthly billing, 7-day free trial." + "See pricing" → `/billing` | `/billing` | HIDDEN (CSS at `:762`) |
| `app/features/page.tsx:51-57` | "See pricing" | `/pricing` | HIDDEN (CSS) |
| `components/marketing/FeatureSheet.tsx:320-326` | "See pricing" | `/pricing` | HIDDEN (CSS) |
| `components/marketing/FeatureSheet.tsx:308-311` | "A 7-day free trial for your firm." | - | **VISIBLE - ungated** |
| `app/what-is-advottic/page.tsx:348-349`, `app/es/que-es-advottic/page.tsx:221-222` | "advottic.com/pricing" | `/pricing` | HIDDEN (CSS) |
| `app/affiliate/page.tsx:241` | "See pricing" | `/pricing` | HIDDEN (CSS) |
| `app/pricing/page.tsx:404` | Gift CTA | `/gift` | HIDDEN (CSS) - but unreachable anyway, the iOS branch returns early at `:295` |
| `app/gift/claim/[token]/page.tsx:133` | `/pricing` link | `/pricing` | **VISIBLE - ungated** |
| `app/gift/claim/[token]/page.tsx:165` | `/billing` link | `/billing` | **VISIBLE - ungated** |
| `app/layout.tsx:697` | Footer **"Billing"** link | `/billing` | **VISIBLE - ungated** (footer renders on all consumer routes; only the sibling "Pricing" link at `:680` carries `data-hide-in-app`) |
| `components/UserMenuClient.tsx:119-121` | Profile menu **"Billing & subscription"** | `/billing` | **VISIBLE - ungated**, with an explicit comment at `:116` saying "Billing is reachable on iOS" |
| `components/TokenBalanceGauge.tsx:80` | Header token gauge → opens `TopUpModal` | modal | HIDDEN (CSS) |
| `components/TopUpModal.tsx:106-110` | **"Buy {label}"** buttons | `/api/billing/topup-checkout` | HIDDEN (CSS) - modal itself is only opened from the hidden gauge |

### 2.4 Marketing pages - the largest ungated cluster

These are public routes served from the same origin, reachable inside the shell
by direct URL, in-app link, or deep link.

**`/compare/[slug]` - 9 live URLs, the worst offender.** The page has no iOS
branch and only one gated CTA.

| file:line | What | iOS today |
|---|---|---|
| `app/compare/[slug]/page.tsx:171-204` | Whole **"Pricing snapshot"** card: `{c.pricing.advottic}` (`:181`) and `{c.pricing.competitor}` (`:189`). Example value: `"$59 (Solo) / $99 (Small Firm) / $149 (Growing) per user / month"` | **VISIBLE - ungated** |
| `app/compare/[slug]/page.tsx:152-165` | Feature table rendering `f.advottic` / `f.competitor`, many of which are price strings | **VISIBLE - ungated** |
| `app/compare/[slug]/page.tsx:259-261` | "**7-day free trial. No credit card.** Migrate from {competitor} in one click." | **VISIBLE - ungated** |
| `app/compare/[slug]/page.tsx:262-266` | "Counsel Small Firm starts at **$99 per user per month**…" | **VISIBLE - ungated** |
| `app/compare/[slug]/page.tsx:268-270` | "Start 7-day trial" → `/sign-in?next=/counsel/onboarding` | HIDDEN (CSS) |
| `app/compare/[slug]/page.tsx:271-273` | **"See all pricing"** button → `/pricing` | **VISIBLE - ungated** |
| `app/compare/[slug]/page.tsx:282-306` | FAQ answers, several quoting prices | **VISIBLE - ungated** |

Slugs (`lib/comparisons.ts:68,156,234,304,373,447,516,585,673`): clio, spellbook,
mycase, smokeball, docusign, harvey, cocounsel, legalzoom, rocket-lawyer.
The price copy itself lives in `lib/comparisons.ts` at `:90`, `:93`, `:104`,
`:130`, `:185`, `:190`, `:212-213`, `:259`, `:282`, `:286-287`, `:328`, `:337`,
`:355-356`, `:397-398`, `:403`, `:411`, `:425-426`, `:465`, `:498-499`, `:534`,
`:549`, `:553`, `:567-568`, `:605`, `:614`, `:625`, `:639`, **`:647`** (`'Free
(templates + tools) / $19/mo (Personal Plus) / $39/mo (Personal Pro)'`), `:648`,
`:655`, `:693`, `:698`, `:709`, `:723`, `:735-736`.

**Other ungated marketing surfaces:**

| file:line | What | iOS today |
|---|---|---|
| `app/gift/page.tsx:44` | `<h1>` **"Buy Advottic for someone you care about."** - a literal purchase headline | **VISIBLE - ungated.** No `data-hide-on-ios` anywhere in the file. |
| `app/gift/page.tsx:46-51` | "You pay once… Subscription activates on their account… They can **upgrade or extend later from their billing page**." | **VISIBLE - ungated** |
| `app/gift/page.tsx:66-85` | "What the recipient receives" / "**Refunds:** full refund if requested before the recipient claims the gift…" | **VISIBLE - ungated** |
| `app/gift/gift-form.tsx:307-318` | "**Stripe handles the payment. We never see your card.** By continuing you agree to our Terms…" | **VISIBLE - ungated** third-party-processor reference |
| `app/what-is-advottic/page.tsx:344-353` | `<Section title="Pricing in one line">` - "Free tier ($0), personal plans from **$19/month**, law-firm plans from **$59/seat/month**, Enterprise from **$1,800/month**." Only the `/pricing` link at `:348-350` is gated, so on iOS the sentence renders with a dangling "See … for the full breakdown". | **VISIBLE - ungated** |
| `app/es/que-es-advottic/page.tsx:217-225` | Same bug in Spanish: "Plan gratuito ($0), planes personales desde **$19/mes**, planes para despachos desde **$59 por usuario al mes**." | **VISIBLE - ungated** |
| `app/press/page.tsx:36-39` (rendered `:110`) | FACTS row: `{ label: 'Pricing', value: 'Free tier; $19-$39/mo personal; $59-$149/user/mo for firms' }` | **VISIBLE - ungated** |
| `app/not-found.tsx:55` | Consumer 404 card: `{ href: '/pricing', title: 'Pricing', blurb: 'Consumer and firm tiers.' }` | **VISIBLE - ungated.** Any bad in-app URL surfaces a Pricing link. |
| `app/billing/page.tsx:133` | H1 **"Choose your tier"** (for non-subscribers) | **VISIBLE - ungated** |
| `app/billing/page.tsx:138` | "**Five plans, monthly billing, 7-day free trial** for first-time subscribers. Cancel any time." | **VISIBLE - ungated** |
| `app/review-my-document/review-client.tsx:50` | Error toast: "Your plan is out of review credits for this period. **Open Billing to add a top-up or upgrade.**" | **VISIBLE - ungated** |
| `app/enterprise/page.tsx:452`, `:570`, `:1036`, `:1121` | `tierHint="Counsel Solo and above"` / `"Counsel Small Firm and above"` - plan names | **VISIBLE - ungated** (no numeric price; `:173`, `:1483` say "Custom pricing, written agreement") |
| `app/invite/page.tsx:103`, `:199` | "Start a 7-day free trial" / "Start the free trial" → `/sign-in?next=/cases/new` | **VISIBLE - ungated** (trial offer, no price) |
| `components/marketing/FeatureSheet.tsx:311` | "A 7-day free trial for your firm." | **VISIBLE - ungated** |
| `app/affiliate/page.tsx:63`, `:80` | "$5,000 commission", "$50 payout threshold" | **VISIBLE - ungated** (affiliate payout copy, not a purchase path) |

**Structured data and crawler surfaces - present in the iOS DOM, not visually
rendered.** Apple does not read JSON-LD, so these are low review risk, but they
contradict "shows no pricing" if anyone inspects the page source:

| file:line | Content |
|---|---|
| `components/seo/JsonLd.tsx:162` | `priceRange: '$0 - $1,800 / month'` |
| `components/seo/JsonLd.tsx:198-252` | Four `Offer` objects - Personal Pro $19, Personal Plus $29, Counsel Solo $59, Counsel Small Firm $99, each `priceCurrency: USD`, `url: /pricing`. Mounted on the **home page** (the shell's start URL) via `AppJsonLd` at `app/page.tsx:215`, and on `/pricing` via `PricingProductJsonLd` (`app/pricing/page.tsx:331`, defined `JsonLd.tsx:407-440`). |
| `app/llms-full.txt/route.ts:67-77`, `:132`, `:156`, `:180-182` | Full price table ($0/$19/$29/$59/$99/$149/$1,800) + discounts; "Buy Advottic for someone else… pay Stripe once" |
| `app/llms.txt/route.ts:46` | "six subscription tiers from $0 (Free) through $1,800/mo (Enterprise)" |
| `app/pricing/opengraph-image.tsx:4`, `:12`; `app/pricing/page.tsx:22`, `:35-37` | OG alt/subtitle "$19/mo … $59/seat/mo" + page metadata |
| `app/enterprise/opengraph-image.tsx:12` | "…**From $59/seat/month**." |
| `app/enterprise/page.tsx:1555-1580` | Product/Offer JSON-LD, `priceCurrency: 'USD'`, no numeric price |
| `app/sitemap.ts:35` | Lists `/pricing` |

**Confirmed clean** (checked, no price and no purchase CTA):
`app/example/page.tsx` (the `$1,800` at `:423` is a fictional security deposit),
`app/compare/page.tsx` (index - "Real pricing. Real features." only, but links
into the 9 ungated detail pages), `app/resources/small-claims-rankings/**` and
`app/press/2026-07-03-small-claims-rankings/**` (jurisdictional limits, not
prices), `app/tools/**` (`price: '0'`), `app/security/disclosure/page.tsx:90-91`
(bug-bounty payouts), and `app/glossary`, `/guides`, `/templates`, `/welcome`,
`/join`, `/about`, `/safe`, `/decoder`, `/open-data`, `/developers`,
`/changelog`, `/status`, `/es/plantillas`.

### 2.5 Stripe checkout entry points (client → server)

| Caller | file:line | Endpoint |
|---|---|---|
| `TierCard.startCheckout` | `app/billing/tier-card.tsx:127-131` | `POST /api/stripe/checkout` |
| `PersonalTierCard` | `app/billing/personal-tier-card.tsx` (checkout handler) | `POST /api/stripe/checkout` |
| `TopUpButtons` | `app/billing/topup-buttons.tsx` | `POST /api/stripe/topup` |
| `TopUpModal.buy` | `components/TopUpModal.tsx:~35` | `POST /api/billing/topup-checkout` |
| `GiftForm` submit | `app/gift/gift-form.tsx:303` | `POST /api/gift/checkout` |
| `ManageButton` | `app/billing/billing-actions.tsx` | Stripe billing portal session |

There are exactly five server entry points that create a Stripe Checkout or
Billing Portal session. Three carry the `blockedIosAppPurchase` guard
(`lib/iap-guard.ts:23`); **two do not**.

| Route | Guard | Notes |
|---|---|---|
| `app/api/stripe/topup/route.ts` | **Yes** - import `:5`, call `:17-18` | `mode:'payment'` checkout at `:81` |
| `app/api/billing/topup-checkout/route.ts` | **Yes** - import `:5`, call `:30-31` | firm token-pool top-up; raw REST checkout at `:94` |
| `app/api/gift/checkout/route.ts` | **Yes** - import `:14`, call `:36-37` | `mode:'payment'` checkout at `:205` |
| `app/api/stripe/checkout/route.ts` | **NO GUARD** | **The primary subscription route.** Handles both the 5-rung personal ladder (`:48-60`) and legacy `basic/standard/pro` (`:62-71`); creates the session at `:133-148` with `trial_period_days: 7` at `:146`. An iOS client that POSTs `{"slug":"plus"}` gets a live Stripe subscription URL back. |
| `app/api/stripe/portal/route.ts` | **NO GUARD** | `billingPortal.sessions.create` at `:29-32`. The Stripe Customer Portal permits plan switching / upgrade / re-subscribe depending on portal config, so this is a purchase surface, not just "manage". |

Additional ungated money-movement path: **`lib/invoicing.ts:254` `sendInvoiceAction`
is a `'use server'` action** (not a route, so easy to miss) that creates a live
`https://api.stripe.com/v1/payment_links` at `:303` and persists
`stripe_payment_link` at `:325`. No iOS gating anywhere on it. Reachable from
`app/counsel/cases/[id]/draft-invoice-button.tsx`. This is firm→client
invoicing for professional services, arguably outside 3.1.1, but it is an
ungated Stripe entry point inside the app.

Webhook/entitlement routes (guard correctly N/A):
`app/api/stripe/webhook/route.ts` (tier writes `:298-307`, `:348-366`; token
grants `:315-326`; gift `:156-173`; top-up credits `:204`, `:274`),
`app/api/iap/revenuecat/route.ts`, `app/api/iap/sync/route.ts`,
`app/gift/claim/[token]/actions.ts`.

### 2.6 Firm / Counsel side (`/counsel/**`)

Counsel has **no plan ladder, no tier prices, and no upgrade CTA** - firm plans
are sold on the marketing site and contracted, not self-serve. But it has two
live Stripe surfaces and a set of ungated purchase-adjacent copy.

| file:line | What | iOS today |
|---|---|---|
| `app/counsel/billing/page.tsx:222-229` | **`<ExternalLink href={i.stripe_payment_link}>` - copy "Pay link".** A raw, live Stripe payment URL, rendered for every `sent` invoice. `ExternalLink` opens it in the in-app Capacitor browser. | **VISIBLE - completely ungated.** The only raw Stripe URL surfaced anywhere in Counsel. |
| `app/counsel/billing/tokens/topup-button.tsx:16-23` | "Top up the firm pool" → opens `TopUpModal` (firm pool) | HIDDEN - `data-hide-in-app` (hidden on Android too) |
| `app/counsel/billing/tokens/page.tsx:102-106` | "…**Top up here** when the pool runs low; charges go to the firm's payment method." | **VISIBLE - ungated.** Leaves orphaned "top up here" copy pointing at a button that is hidden. |
| `app/counsel/billing/tokens/page.tsx:113-120` | "Pool balance", "No active subscription", "Renews {date}" | VISIBLE - ungated |
| `app/counsel/billing/page.tsx:123-238` | Whole firm invoicing page: "Billing", "Outstanding"/"Collected"/"Unbilled time" dollar stats (`fmtCents`, `:25`), "Recent invoices" | VISIBLE - ungated (client invoicing, not app-plan purchase) |
| `app/counsel/billing/mark-paid-button.tsx:28` | Tooltip: "Mark invoice as paid manually (eg. wire received **outside Stripe**)" | VISIBLE - ungated. A named external-processor reference of exactly the kind hidden at `app/billing/page.tsx:382`. |
| `app/counsel/cases/[id]/evidence/evidence-intake.tsx:2178` | "Files are stored on the timeline. AI analysis and relevance scoring **need a firm plan**." | **VISIBLE - ungated.** Names a paid plan with no purchase path. |
| `lib/menu-config.ts:95`, `:28` | Counsel nav "Billing" (Finance group) | VISIBLE - the counsel sidebar (`components/counsel/CounselSidebar.tsx:43`) has **no iOS gating hook at all** |
| `components/counsel/CounselProfileMenuClient.tsx:199` | Renders `TokenBalanceGauge` in the counsel profile menu | HIDDEN - gauge button carries `data-hide-on-ios` (`components/TokenBalanceGauge.tsx:80`); note this is iOS-only, the Android app still shows it |
| `app/counsel/billing/tokens/**` | No nav entry anywhere; reachable only by direct URL, owner/admin only (`tokens/page.tsx:20-22`) | - |
| `app/counsel/trust/**` | IOLTA trust accounting | Zero plan/price/Stripe references - not a purchase surface |

**`TopUpModal` internal gating is partial** (`components/TopUpModal.tsx`):
the buy buttons carry `data-hide-on-ios` (`:106`), but the modal's **prices**
(`:93-98`, `$X.XX` per pack), the heading "Top up your balance" (`:58`), the
"Top-ups credit the firm-wide pool." copy (`:62-64`), and the footer "Tokens
never expire. **Prices in USD.** Tax (where applicable) added at checkout."
(`:124`) are all **ungated**. On iOS the modal is currently unreachable because
both of its openers are hidden - but any new opener would leak a full price
list.

Other ungated Stripe/plan references worth knowing about:

| file:line | Copy |
|---|---|
| `app/billing/page.tsx:137` | "Manage your billing, top up tokens, or **switch tiers from the customer portal**." - rendered whenever `status === 'active'`, including on iOS |
| `app/profile/account-actions.tsx:62` | "…**Stripe** billing history is retained as…" |
| `app/security/page.tsx:222` | Subprocessor table: "Subscription billing + customer portal" |
| `app/billing/billing-actions.tsx:37` | `ManageButton` copy "Manage subscription" - component itself ungated; only the call site at `app/billing/page.tsx:240` is |

**Admin console** (`app/admin/**`) has no `data-hide-*` anywhere and renders
plan/tier/subscription columns throughout (`users/page.tsx:40`, `:75-108`;
`firms/page.tsx:57`, `:135`, `:36`; `consumer/page.tsx:31`, `:39`, `:123`;
`counsel/page.tsx:24`, `:76`; `page.tsx:45`, `:73`, `:78`;
`enterprise-inquiries/page.tsx:109`, `inquiry-row.tsx:155` "$80/seat budget";
`health/page.tsx:12`). No checkout or portal button exists in admin. This is an
internal staff surface, but it is served from the same origin and is reachable
inside the shell by an admin account, so a reviewer signed in as staff would see
plan names.

### 2.7 IAP / StoreKit / RevenueCat remnants

IAP was removed from the **UI** in `4a2297b` ("billing: drop Apple IAP - reader
model"). It is **not** gone from the codebase or the binary.

| Remnant | file:line | Status |
|---|---|---|
| `lib/iap.ts` (336 lines: `purchaseTier`, `restorePurchases`, `IOS_PRODUCT_BY_TIER`, RevenueCat `configure`/`getOfferings`/`purchaseStoreProduct`) | `lib/iap.ts:1-336` | **Dead JS** - no importer anywhere in `app/`, `components/`, `lib/`. Tree-shaken out of the client bundle, but still in the repo. |
| `@revenuecat/purchases-capacitor: ^13.2.0` | `package.json:32` | **Still a runtime dependency.** |
| RevenueCat native plugin linked into the iOS binary | `ios/App/CapApp-SPM/Package.swift:22`, `:37` | **STILL LINKED.** The signed build 22 binary contains the RevenueCat/StoreKit framework. Apple's binary analysis sees StoreKit linkage in an app that claims to sell nothing. |
| `/api/iap/revenuecat` webhook | `app/api/iap/revenuecat/route.ts` | Live server route |
| `/api/iap/sync` | `app/api/iap/sync/route.ts` | Live server route |
| `lib/iap-server.ts` | whole file | Live; reads RevenueCat REST |
| Apple product ids referenced | `lib/entitlements.ts:104-108`, `lib/iap.ts:33-40` | Present |
| No External Purchase / External Link Account entitlement | `ios/App/App/App.entitlements` | **Absent** - only `com.apple.security.application-groups` |

`components/RestorePurchases.tsx` no longer calls StoreKit; it is now purely a
link-out card (see 2.1 #5). There is no "Restore Purchases" button anywhere.

### 2.8 Native shell assets

`capacitor-shell/index.html` and `capacitor-shell/offline.html` contain no
price, plan, subscribe or upgrade strings. Clean.

---

## 3. What paid features are gated, and how

The pattern is **hide the CTA, keep the feature copy, swap in a calm
`data-show-in-app` sentence**. iOS users are never hard-blocked and never see a
raw error. Actual copy:

| Feature | iOS copy (exact) | Source |
|---|---|---|
| Full Advottic Review | "The full breakdown - N more insights across the timeline, key facts, legal issues, evidence plan, and next steps - is **included with a subscription on your account**." | `app/cases/[id]/review-panel.tsx:169` |
| Locked review insights | "N more **included with a subscription on your account**" (plain text, not a link) | `app/cases/[id]/review-panel.tsx:531-534` |
| Case Timeline | "**Included with a subscription on your account.**" | `app/cases/[id]/timeline/page.tsx:113` |
| Document inbox | eyebrow "**Included with your account**"; body "**With your subscription,** every law firm using Advottic Counsel can send documents directly into your secure inbox here." | `app/inbox/documents/page.tsx:47`, `:52` |
| Gifting | "**Gifting is not available in the app.**" | `app/gift/gift-form.tsx:158-160` |
| Plan status | "Your subscription is managed from your Advottic account. Whatever plan you have unlocks here automatically." | `app/billing/page.tsx:314-317` |
| Plan status (Restore card) | "Your Advottic plan is tied to your account. When your account has an active subscription, all of your features unlock here automatically." | `components/RestorePurchases.tsx:32-35` |
| Tier card (iOS branch) | "Your access unlocks here automatically once your account is subscribed." | `app/billing/tier-card.tsx:210` |
| Server-side checkout refusal | "Purchases in the iOS app are handled through the App Store. Open advottic.com in a browser to buy here." (HTTP 403 JSON) | `lib/iap-guard.ts:27-29` |

Note the last one: the fail-closed API guard's own error string is itself a
call to action to purchase outside the app, and it also contradicts the reader
model (it says purchases go "through the App Store", which is false).

Item-cap enforcement is a **hard block on Free** (`app/cases/new/page.tsx:114`)
with an ungated "Creating another item requires a paid tier" message and a
CSS-hidden route to `/pricing`. On iOS that leaves a dead end: the user is told
they need a paid tier with no visible way to act.

---

## 4. The marketing site inside the shell

**Start URL is the marketing home.** `capacitor.config.ts:43` →
`https://advottic.com` → `app/page.tsx`. The app opens on the public marketing
page, not on an authenticated route.

**Yes, `/pricing` is reachable from inside the app.** Specifically:

| Path in | file:line | Gated? |
|---|---|---|
| Footer "Pricing" link | `app/layout.tsx:680` | `data-hide-in-app` - hidden |
| Footer "Billing" link | `app/layout.tsx:697` | **Ungated** → `/billing` |
| Profile menu "Billing & subscription" | `components/UserMenuClient.tsx:119` | **Ungated** → `/billing` |
| Sidebar "Billing" nav item | `components/Sidebar.tsx:45` | **Ungated.** The `hideOnIos` flag exists (`:26`, applied at `:296` and `:478`) but **no item in `ITEMS` ever sets it**, so the flag is dead code and Billing shows on iOS. |
| `/billing` ItemsGauge "Compare tiers" | `app/billing/page.tsx:498` | **Ungated** → `/pricing` |
| `/compare/[slug]` "See all pricing" | `app/compare/[slug]/page.tsx:271` | **Ungated** → `/pricing` |
| `/gift/claim/[token]` | `app/gift/claim/[token]/page.tsx:133`, `:165` | **Ungated** → `/pricing`, `/billing` |
| Consumer 404 page "Pricing" card | `app/not-found.tsx:55` | **Ungated** → `/pricing`. Any mistyped or dead in-app URL surfaces it. |
| Footer "Compare" / `/compare` index | `app/compare/page.tsx` | index is price-free but links into the 9 ungated detail pages |
| Direct URL entry / deep link | `components/NativeDeepLinkRouter.tsx` | any `advottic.com` path routes into the WebView |

`/pricing` on iOS renders the reader-model page (`app/pricing/page.tsx:295-315`)
- heading "Plans", explanatory copy, and a **prominent dark-filled button**
reading "View plans & subscribe at advottic.com".

**No navigation allowlist exists.** `capacitor.config.ts` sets no
`server.allowNavigation`, and there is no `WKAppBoundDomains` /
`limitsNavigationsToAppBoundDomains` in the iOS project. Same-origin navigation
inside the WebView is unrestricted, so every `advottic.com` route - including
the full `/pricing` ladder if the UA gate ever misses - is reachable in-app.

The `isShellMode` variable in `app/layout.tsx:210` is **route**-based
(`/counsel`, `/admin`, `/portal`, `/join`, `/embed`), not platform-based. It has
nothing to do with iOS.

---

## 5. External link handling - the in-app browser problem

`components/ExternalLink.tsx:23-36`:

```ts
if (!isNativeApp()) return;          // web: normal target="_blank"
e.preventDefault();
import('@capacitor/browser')
  .then(({ Browser }) => Browser.open({ url: href }))
  .catch(() => { window.location.href = href; });
```

`@capacitor/browser` (`package.json:25`) opens **`SFSafariViewController`** on
iOS - an **in-app** browser sheet, not the default system browser. All five
"subscribe at advottic.com" link-outs (§2.1) use `ExternalLink`, so tapping any
of them presents the Advottic web pricing page **inside the app**, where the
user can complete a Stripe purchase without ever leaving the app process.

This is the most severe finding. Apple's rules for external purchase links
require (a) the StoreKit External Link Account or External Purchase entitlement,
(b) a system-presented disclosure sheet, and (c) opening in the **default
browser**. None of the three is satisfied:

- No entitlement in `ios/App/App/App.entitlements`.
- No `StoreKit.ExternalLinkAccount` / `ExternalPurchaseLink` API call anywhere.
- `SFSafariViewController`, not the default browser.

Note also the fallback branch: on a `@capacitor/browser` import failure it does
`window.location.href = href`, which navigates the **main WebView** to the
pricing page - the purchase page becomes the app's own screen.

The only other native-browser use is the OAuth sign-in flow
(`app/sign-in/sign-in-buttons.tsx:276`), which is unrelated to purchases.

---

## 6. App Review Notes vs reality

The submitted notes (reproduced in `docs/IOS_APP_STORE.md:455-476` and
`:490-496`) claim:

> "Nothing is sold inside the iOS app, and the iOS app contains **no purchase
> buttons, price lists, or links to external purchase flows**."
> "The app itself sells nothing, shows no pricing, and **does not direct users
> to an external purchase mechanism**."
> "…removed **every** named plan (Plus / Pro / Ultra), price, trial offer, and
> subscribe control. The iOS app now contains **no purchase UI of any kind**."

Every one of those three sentences is contradicted by current code:

| Claim | Contradiction | file:line |
|---|---|---|
| "no links to external purchase flows" | Five explicit "subscribe at advottic.com" link-outs, styled as buttons/links | `app/pricing/page.tsx:304`, `app/billing/page.tsx:318`, `app/billing/tier-card.tsx:211`, `app/billing/personal-tier-card.tsx:145`, `components/RestorePurchases.tsx:38` |
| "does not direct users to an external purchase mechanism" | Same five, opened in an in-app SFSafariViewController where Stripe checkout completes | `components/ExternalLink.tsx:29-30` |
| "shows no pricing" / "no price lists" | `TierCard` and `PersonalTierCard` render a large `$N / month` block **above** the iOS branch | `app/billing/tier-card.tsx:166`, `app/billing/personal-tier-card.tsx:109` |
| "shows no pricing" | Gift order-summary total (`Total today $N`) is ungated | `app/gift/gift-form.tsx:276-298` |
| "shows no pricing" | Nine `/compare/[slug]` pages render an entire ungated "Pricing snapshot" card plus price-bearing feature rows and FAQ answers | `app/compare/[slug]/page.tsx:171-204`, `:152-165`, `:262-266`, `:282-306` |
| "shows no pricing" | Ungated marketing prose with prices | `app/what-is-advottic/page.tsx:344-353`, `app/es/que-es-advottic/page.tsx:217-225`, `app/press/page.tsx:36-39` |
| "no purchase buttons" | "Buy a Boost pack →" renders ungated on `/billing` for every signed-in user | `app/billing/page.tsx:495` |
| "nothing is sold inside the iOS app" | `/gift` headline reads literally **"Buy Advottic for someone you care about."** with the full gift flow beneath it | `app/gift/page.tsx:44-51` |
| "no links to external purchase flows" | `/counsel/billing` renders raw live Stripe payment-link URLs as "Pay link", opened in the in-app browser | `app/counsel/billing/page.tsx:222-229` |
| "no purchase buttons" | The consumer 404 page offers a "Pricing" card link | `app/not-found.tsx:55` |
| "removed every … price" | `/billing` H1 "Choose your tier" + "Five plans, monthly billing, 7-day free trial" render ungated for non-subscribers | `app/billing/page.tsx:133`, `:138` |
| "removed every named plan" | Ungated tier names in affiliate copy and compare pages | `app/affiliate/page.tsx:40`, `:50`, `:53`, `:58`; `app/compare/[slug]/page.tsx:263` |
| "removed every … trial offer" | "A 7-day free trial for your firm." ungated; "Your trial has ended. Subscribe below…" ungated | `components/marketing/FeatureSheet.tsx:310`; `app/billing/page.tsx:170`, `:187` |
| "no purchase UI of any kind" | Hidden ≠ absent. 38 `data-hide-on-ios` sites ship the full purchase markup in the HTML; `display:none` is one devtools toggle away | `app/globals.css:71-72` |
| implicit "no IAP capability" | RevenueCat/StoreKit framework still linked in the signed binary | `ios/App/CapApp-SPM/Package.swift:22`, `:37`; `package.json:32` |
| "Guideline 3.1.3(b) multiplatform" positioning | 3.1.3(b) still forbids in-app CTAs to the external purchase mechanism; the five link-outs are exactly that | `docs/IOS_APP_STORE.md:271`, `:289-325` |

`docs/IOS_APP_STORE.md:335` already notes the reader-model wording was tightened
"inside 3.1.3(b) anti-steering" - but commit `1168e61` then **added** the
link-outs back, on the (US-injunction) theory documented inline at
`app/billing/tier-card.tsx:208-209`. That theory is what build 22 was rejected
against.

---

## 7. Path to a zero-CTA, zero-purchase-surface iOS build

### 7.1 Must-change, file by file

**Tier A - remove the external purchase CTAs (the 3.1.3(d) blockers).**

| File | Line(s) | Change |
|---|---|---|
| `app/pricing/page.tsx` | 296-315 | Delete the `ExternalLink` button. Keep the plain status copy, or `notFound()` the whole route on iOS. |
| `app/billing/page.tsx` | 318-323 | Delete the `ExternalLink` paragraph. |
| `app/billing/tier-card.tsx` | 211-216 | Delete the `ExternalLink`; keep only the "unlocks automatically" sentence. |
| `app/billing/personal-tier-card.tsx` | 145-149 | Same. |
| `components/RestorePurchases.tsx` | 36-43 | Delete the `ExternalLink` paragraph. |
| `lib/iap-guard.ts` | 27-29 | Rewrite the 403 message to drop "Open advottic.com in a browser to buy here" and the false "through the App Store" claim. |

**Tier B - the ungated leaks (a reviewer can see these today).**

| File | Line(s) | Change |
|---|---|---|
| `app/billing/page.tsx` | 480-512 (`ItemsGauge` over/approaching blocks) | Gate "Buy a Boost pack →", "Compare tiers", "Consider upgrading", and the overage-charge sentence. |
| `app/billing/page.tsx` | 167-192 | Gate/reword both "Your trial has ended. Subscribe below…" notices. |
| `app/billing/page.tsx` | 142-160 | Gate the checkout/top-up query-param banners. |
| `app/billing/tier-card.tsx` | 165-168 | Move the `$N / month` block inside the non-iOS branch. |
| `app/billing/personal-tier-card.tsx` | 107-111 | Same. |
| `app/gift/page.tsx` | 44-85 | **Server-branch the whole `/gift` route on iOS.** The `<h1>` reads "Buy Advottic for someone you care about." Piecemeal attribute gating is not enough here. |
| `app/gift/gift-form.tsx` | 276-298, 307-318 | Covered by the route branch above; otherwise gate the total block and the "Stripe handles the payment" line. |
| `app/gift/claim/[token]/page.tsx` | 133, 165 | Gate the `/pricing` and `/billing` links. |
| `app/compare/[slug]/page.tsx` | 152-165, 171-204, 259-266, 271-273, 282-306 | **Server-branch on iOS**, or strip the pricing snapshot, the price-bearing feature rows, the trial line, the "$99 per user per month" prose, the "See all pricing" button, and the price-quoting FAQ. Nine live URLs. |
| `app/not-found.tsx` | 55 | Remove the Pricing card, or gate it. |
| `app/press/page.tsx` | 36-39 | Gate the Pricing FACTS row. |
| `app/review-my-document/review-client.tsx` | 50 | Reword the out-of-credits toast - it currently says "Open Billing to add a top-up or upgrade." |
| `app/invite/page.tsx` | 103, 199 | Decide on "Start a 7-day free trial" - a trial offer is a purchase CTA under a strict 3.1.3(d) reading. |
| `app/counsel/billing/page.tsx` | 222-229 | Gate the "Pay link" `ExternalLink` (raw Stripe URL). |
| `app/counsel/billing/tokens/page.tsx` | 102-106 | Gate "Top up here when the pool runs low; charges go to the firm's payment method." |
| `app/counsel/billing/mark-paid-button.tsx` | 28 | Reword the "outside Stripe" tooltip. |
| `app/counsel/cases/[id]/evidence/evidence-intake.tsx` | 2178 | Reword "AI analysis and relevance scoring need a firm plan." |
| `components/TopUpModal.tsx` | 58, 62-64, 93-98, 124 | Gate the heading, blurb, prices and "Prices in USD… added at checkout" footer - currently only the buttons are gated. |
| `app/enterprise/page.tsx` | 452, 570, 1036, 1121 | Decide on the `tierHint` plan names. |
| `components/seo/JsonLd.tsx` | 162, 198-252 | Suppress the `Offer` price objects on iOS requests. They ship on the **home page**, the shell's start URL. Low review risk, but required for the notes to be literally true. |
| `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts` | 46; 67-77, 132 | Crawler-only; suppress on iOS UA for completeness. |
| `app/layout.tsx` | 697 | Add `data-hide-in-app` to the footer "Billing" link. |
| `components/UserMenuClient.tsx` | 119-121 | Decide: hide, or keep (see §7.3). |
| `components/Sidebar.tsx` | 45 | Set `hideOnIos: true` on the Billing item - the flag exists and is wired but never set. |
| `components/TrialBanner.tsx` | 142, 180-183 | Reword the ungated body copy: it says "Subscribe" three times. |
| `app/cases/new/page.tsx` | 116-117 | Reword "Creating another item requires a paid tier". |
| `components/marketing/FeatureSheet.tsx` | 308-311 | Gate "A 7-day free trial for your firm." |
| `app/what-is-advottic/page.tsx` | 221, 347 | Gate the price prose (`$19/month`, `$59/seat/month`, `$1,800/month`). |
| `app/es/que-es-advottic/page.tsx` | 114, 221 | Same, Spanish. |
| `app/compare/[slug]/page.tsx` | 263, 271 | Gate the "$99 per user per month" prose and the ungated `/pricing` button. |
| `app/affiliate/page.tsx` | 40, 50, 53, 58 | Gate the tier-name commission copy - or server-branch `/affiliate` off on iOS entirely. |

**Tier C - stop shipping hidden purchase markup (defence in depth).**
Thirty-eight `data-hide-on-ios` sites currently ship the full purchase UI in the
HTML and hide it with `display:none`. For a 3.1.3(d) claim this is weak: the
markup, the prices, and the tier names are all present in view-source. Convert
the high-value ones (`/billing`, `/gift`, `/cases/new`, `review-panel`,
`timeline`) from CSS hiding to **server branches** on
`nativePlatformFromUserAgent(headers().get('user-agent'))`, matching the pattern
already used at `app/pricing/page.tsx:295`.

**Tier D - remove the StoreKit surface from the binary.**

| File | Change |
|---|---|
| `ios/App/CapApp-SPM/Package.swift` | 22, 37 - drop the `RevenuecatPurchasesCapacitor` package and product. Requires a new binary. |
| `package.json` | 32 - remove `@revenuecat/purchases-capacitor`. |
| `lib/iap.ts` | Delete (dead code, 336 lines). |
| `lib/iap-server.ts`, `app/api/iap/**` | Keep only if legacy RevenueCat subscribers still exist; otherwise delete. Check `subscriptions` rows sourced from IAP before removing. |
| `lib/entitlements.ts` | 104-108 - drop the Apple product-id mapping if the above are removed. |

**Tier E - close the server gap.**

| File | Change |
|---|---|
| `app/api/stripe/checkout/route.ts` | Add `blockedIosAppPurchase(req)` as the first statement in `POST`. This is the **primary subscription route** and currently has no guard. |
| `app/api/stripe/portal/route.ts` | Add the guard - the Customer Portal can switch/upgrade plans. |
| `lib/invoicing.ts:254` | Decide whether firm→client invoicing needs a guard. It is professional services, not digital goods, so 3.1.1 arguably does not apply - but document the reasoning in the review notes rather than leaving it undecided. |
| `app/counsel/billing/page.tsx:222-229` | Gate the "Pay link" `ExternalLink`, or render the invoice as read-only in-app. A raw live Stripe payment URL opening in an in-app browser is the single worst artifact in the repo for a 3.1.3(d) claim. |

### 7.2 Also fix regardless of 3.1.3(d)

- `app/pricing/page.tsx:295` and `app/billing/page.tsx:305` branch **only** on
  the UA token, with no CSS backstop. Add `data-hide-on-ios` to the web-branch
  ladder as a second line of defence, so a missing UA token degrades to a
  hidden-but-correct page rather than a full price list.
- `components/NativePlatformBoot.tsx:36` polls for 3 s. Consider tightening the
  interval, or accept it now that the UA token is the primary path.

### 7.3 What breaks for legitimate paying subscribers

Good news first: **an existing subscriber can still sign in and work.** Nothing
in the sign-in path (`app/sign-in/**`, `lib/landing.ts`, `middleware.ts`) is
gated on platform, and entitlement resolution
(`lib/entitlements.ts`, `getCurrentSubscription`) reads the account row -
platform-independent. All paid features (Review, Timeline, exports, e-sign,
counsel workspace) unlock from the account.

What a zero-CTA build costs:

1. **No in-app way to discover where to subscribe.** A free/expired iOS user
   hits "Creating another item requires a paid tier"
   (`app/cases/new/page.tsx:116`) and a trial-ended banner
   (`app/billing/page.tsx:170`) with no path forward. 3.1.3(d) forbids telling
   them. They must already know to go to advottic.com. Expect support volume
   and churn on the iOS cohort. The copy in Tier B must be reworded to something
   honest and non-directional ("This is included with a subscription on your
   account") rather than deleted, or the app reads as broken.

2. **No self-serve subscription management on iOS.** Hiding the Stripe
   `ManageButton` (already hidden, `app/billing/page.tsx:240`) plus removing the
   link-out means an iOS-only subscriber cannot cancel, change plan, or update a
   card from the app. Cancellation friction is itself a regulatory issue in some
   jurisdictions. Keeping `/billing` reachable as a **read-only status page** is
   the safest compromise - that is what `components/UserMenuClient.tsx:116`
   already reasons toward.

3. **Token top-ups become unreachable on iOS.** Pro users burn tokens in-app but
   can only refill on the web. Already the case (`app/billing/page.tsx` gates
   `<TopUpButtons />`), but a zero-CTA build removes even the hint. Consider a
   neutral balance display with no purchase language.

4. **Gifting is already disabled in-app** (`app/gift/gift-form.tsx:158`); no
   further regression.

5. **Removing the RevenueCat SPM package requires a new binary** and will break
   any legacy subscriber whose entitlement is still sourced from RevenueCat
   rather than Stripe. Audit the `subscriptions` table for IAP-sourced rows
   before deleting `lib/iap-server.ts` and `app/api/iap/**`.

### 7.4 Effort estimate

- **Tier A** (the five link-outs + the guard message): ~30 minutes, 6 files,
  purely deletions. This alone removes the direct 3.1.3(d) blocker and is the
  single highest-value change.
- **Tier E** (API guards on `stripe/checkout` and `stripe/portal`): ~10 minutes.
- **Tier B** (ungated leaks): ~1 day, ~30 files. Mostly attribute additions, but
  it includes route-level branches for `/gift` and `/compare/[slug]` and a set
  of copy rewrites that must stay within the calm-tone rule.
- **Tier C** (CSS → server branches for the high-value routes): ~half a day, and
  it is the change that makes the App Review Notes literally true rather than
  visually true.
- **Tier D** (drop the RevenueCat SPM package): requires an Xcode/SPM change and
  a fresh binary + submission. Do not attempt on the existing build.

Total for a defensible zero-CTA state: roughly **2 focused days**, plus one new
binary for Tier D. Tier A + Tier E alone is under an hour and removes the
findings most likely to have driven the 3.1.1 rejection.

---

## 8. Known internal inconsistencies (fix these to avoid contradicting yourself)

1. **The stated strategy differs across files.**
   `components/UserMenuClient.tsx:115-117` states "subscriptions are sold through
   Apple In-App Purchase there (Guideline 3.1.1)" - the opposite of what
   `app/billing/page.tsx:301-304` and `app/pricing/page.tsx:291-293` implement
   (reader model, no IAP). `lib/iap-guard.ts:14-15` likewise says purchases in
   the iOS app "are handled through the App Store". `docs/IOS_APP_STORE.md`
   argues 3.1.3(b) multiplatform. Four different stories in one codebase. If a
   reviewer reads any of the comments or the guard's error string, the notes
   look drafted rather than true.

2. **Stale price copy.** `app/page.tsx:770` describes "Basic / Standard / Pro"
   and `app/api/stripe/webhook/route.ts:331-333` maps
   `basic: 'Basic ($9/mo)'`, `standard: 'Standard ($19/mo)'`,
   `pro: 'Pro ($50/mo)'` - none of which match the current Free/Starter/Plus/
   Pro/Ultra ladder in `lib/personal-tiers.ts` ($0/$19/$29/$59/$99) or
   `/pricing`. The home CTA is iOS-gated, so this is a correctness issue rather
   than a review issue, but it means there is no single source of truth for
   prices to gate.

3. **`components/Sidebar.tsx` `hideOnIos` is dead.** Declared at `:26`, applied
   at `:296` and `:478`, never set by any item - including `/billing` at `:45`.
   Someone built the mechanism and never wired it.

4. **Gating granularity is inconsistent.** `data-hide-on-ios` hides on iOS only;
   `data-hide-in-app` hides on both shells. `components/TokenBalanceGauge.tsx:80`
   uses the iOS-only form while `app/counsel/billing/tokens/topup-button.tsx:16`
   uses the both-shells form for the same purchase flow. Pick one policy per
   surface and document it.

---

## Appendix - full `data-hide-on-ios` inventory (38 sites)

| file:line |
|---|
| `app/page.tsx:762` |
| `app/inbox/documents/page.tsx:47`, `:52`, `:64` |
| `app/features/page.tsx:53` |
| `app/cases/new/page.tsx:118`, `:120`, `:137`, `:155` |
| `app/cases/[id]/review-panel.tsx:170`, `:175`, `:535` |
| `app/cases/[id]/timeline/page.tsx:108`, `:117` |
| `app/gift/gift-form.tsx:162`, `:205`, `:303` |
| `app/what-is-advottic/page.tsx:348` |
| `app/compare/[slug]/page.tsx:268` |
| `app/affiliate/page.tsx:241` |
| `app/es/que-es-advottic/page.tsx:221` |
| `app/pricing/page.tsx:404` |
| `app/billing/topup-buttons.tsx:52` |
| `app/billing/page.tsx:240`, `:271`, `:382` |
| `components/TokenBalanceGauge.tsx:80` |
| `components/TopUpModal.tsx:106` |
| `components/AppExclusiveFeatures.tsx:105` (conditional) |
| `components/Sidebar.tsx:296`, `:478` (flag never set - dead) |
| `components/TrialBanner.tsx:147`, `:177`, `:197` |
| `components/marketing/FeatureSheet.tsx:322` |

`data-hide-in-app` (7 sites): `app/layout.tsx:644`, `:680`;
`components/GetTheApp.tsx:44`; `app/counsel/billing/tokens/topup-button.tsx:16`;
plus CSS/doc references.

`data-show-in-app` (6 sites): `app/inbox/documents/page.tsx:47`, `:52`;
`app/cases/[id]/review-panel.tsx:169`, `:532`;
`app/cases/[id]/timeline/page.tsx:114`; `app/gift/gift-form.tsx:158`.
