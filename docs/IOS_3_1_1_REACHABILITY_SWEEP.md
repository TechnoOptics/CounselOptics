# iOS purchase-surface reachability sweep

Date: 2026-08-24. Base commit: 1ef41bf0.

Scope: every surface a person can reach inside the iOS app, looking for a
purchase call to action, a price, or a steering message that names where to
buy. This records what the code does and what is reachable. It does not
assert what App Review will accept, and it does not quote guideline text
from memory.

The product model this measures against is the one already shipped: Advottic
on iOS sells nothing. No In-App Purchase, no StoreKit, no RevenueCat, no
restore-purchases control. The app is a free client for a service bought and
administered outside it. Nothing in this document proposes changing that.

## 1. The user-agent token is set by the build

Every server-side gate keys on the string `AdvotticApp/ios`. If the shipped
binary did not send it, all of them would fail open silently. It is set, and
here is the chain, each link verified in this worktree:

| Link | Evidence |
| --- | --- |
| Config declares it | `capacitor.config.ts` `ios.appendUserAgent: 'AdvotticApp/ios'` |
| Release build regenerates the native project from that config | `.github/workflows/ios-release.yml:238-241` runs `rm -rf ios`, `npx cap add ios`, `npx cap sync ios` |
| Sync writes it into the file the binary reads | ran `npx cap copy ios` here; generated `ios/App/App/capacitor.config.json` contains `"ios": { ..., "appendUserAgent": "AdvotticApp/ios" }` |
| Capacitor reads that key | `node_modules/@capacitor/ios/Capacitor/Capacitor/CAPInstanceDescriptor.swift:77` reads `ios.appendUserAgent` |
| Capacitor applies it to the WebView | `CAPBridgeViewController.swift:130-135` sets `webViewConfiguration.applicationNameForUserAgent` |
| The app actually uses that view controller | `ios/App/App/Base.lproj/Main.storyboard` roots the only scene on `CAPBridgeViewController` |
| Web code expects the same string | `lib/platform.ts` `NATIVE_UA_TOKEN.ios = 'AdvotticApp/ios'` |

`ios/App/App/capacitor.config.json` is gitignored, so it does not appear in
the repository; it is produced at build time. `git status` stayed clean after
the `cap copy` above.

What is NOT verified: no `.ipa` was inspected. The chain proves the token for
any build produced by `ios-release.yml` at this commit. A binary already
installed from an older commit is outside what can be checked from source.

Related, and worth an owner decision: the generated `capacitor.config.json`
lists `PurchasesPlugin` in `packageClassList`, because
`@revenuecat/purchases-capacitor` is still a dependency in `package.json`.
The signed binary therefore still links RevenueCat and StoreKit native code
even though no JavaScript calls it.

## 2. Purchase calls to action still reachable inside the iOS app

These carry no platform gate of any kind. Every one of them is generated
server-side as plain text, so the `data-hide-on-ios` CSS layer cannot reach
them either.

| # | File and line | Text |
| --- | --- | --- |
| 1 | `lib/ai.ts:206` | "Your Pro token balance is empty. Top up from /billing to run a fresh review on this case." |
| 2 | `lib/bella.ts:3411` | "Bella is part of the Standard and Pro plans. Upgrade from your /billing page to chat with her." |
| 3 | `lib/bella.ts:3429` | "You've used up your Pro tokens for this billing period. Top up from your /billing page and I'll be right back." |
| 4 | `lib/bella.ts:3454` | "Your firm has used up its Bella tokens for this billing period. Top up from your firm's billing page and I'll be right back." |
| 5 | `lib/actions.ts:172` | "Your free trial has ended. Open /billing to subscribe, then create your case." |
| 6 | `lib/actions.ts:212` | "You've reached your plan's limit of N cases. Upgrade from /billing, or archive an existing case to make room." |
| 7 | `lib/actions.ts:1599` | "Inviting collaborators requires the Pro plan. Upgrade from /billing." |
| 8 | `lib/item-limits.ts:174` | "Consider upgrading or buying a Boost pack." |
| 9 | `lib/item-limits.ts:158` | "Free includes 1 item. Upgrade to Personal Pro for 20 items, or delete an existing item to make room." |
| 10 | `app/review-my-document/review-client.tsx:51` | "Your plan is out of review credits for this period. Open Billing to add a top-up or upgrade." |

These are rendered markup that is reachable because the gate around them
stops short of the sentence:

| # | File and line | What is reachable |
| --- | --- | --- |
| 11 | `app/counsel/billing/tokens/page.tsx:102-104` | Page subtitle "Top up here when the pool runs low; charges go to the firm's payment method." The button it points at is hidden on iOS by `TokenTopUpButton`, so the sentence also instructs the reader to press a control that is not on the page. |
| 12 | `app/billing/page.tsx:606-607` | Token gauge helper text "Heavy users can top up below at any time." `TopUpButtons` below it is iOS-hidden (`app/billing/page.tsx:397`), so again the sentence points at nothing. |
| 13 | `components/TrialBanner.tsx:140` | "Subscribe to keep using Bella, Advottic Review, and create new cases." Only the Subscribe link (line 145) carries `data-hide-on-ios`. |
| 14 | `components/TrialBanner.tsx:179-180` | "Subscribe before it ends to keep Bella, Advottic Review, and case creation." / "Subscribe before the trial ends to keep your access." Same shape: the link is gated, the sentence is not. The comment at line 126 says the Subscribe CTA is hidden on iOS, which is true only of the link. |

Marketing and editorial routes that the app can reach. `middleware.ts`
redirects `/pricing`, `/compare`, `/affiliate` and `/gift` on iOS. It does not
redirect `/resources` or `/changelog`, and neither page gates its purchase
links:

| # | File and line | What is reachable |
| --- | --- | --- |
| 15 | `app/resources/[slug]/page.tsx:161-175` | Article CTA card rendering `article.cta`. Three articles point it at `/pricing`: `lib/articles.ts:192` "Try Advottic free for 14 days", `lib/articles.ts:260` "See Advottic's IOLTA features", `lib/articles.ts:469` "Try Advottic Counsel free for 14 days". |
| 16 | `lib/articles.ts:176`, `lib/articles.ts:245` | In-body markdown links to `/pricing`, one of them labelled with our own price ("Advottic Solo at $59/user/mo"). |
| 17 | `lib/articles.ts:168, 176, 177, 991` | Our own prices in article body text ($59 per user per month, $99/user/mo, $19/mo). |
| 18 | `lib/changelog.ts:77` and `lib/changelog.ts:68` | Changelog entries whose `link` is `/pricing` and `/gift`; rendered as a link at `app/changelog/page.tsx:142-144`. `/changelog` is linked from the app footer (`app/layout.tsx:811`). |

Machine-readable only, not visible to a reader, listed for completeness:

| # | File and line | What is in the HTML |
| --- | --- | --- |
| 19 | `app/what-is-advottic/page.tsx:222` | JSON-LD FAQ answer carrying prices and "See advottic.com/pricing". The visible section with the same content is correctly gated at lines 351-365. |
| 20 | `app/es/que-es-advottic/page.tsx:115` | The Spanish equivalent of the same JSON-LD entry. Its visible section is gated at lines 222-234. |

One stale comment that asserts the opposite of the shipped model:

| # | File and line | Problem |
| --- | --- | --- |
| 21 | `components/UserMenuClient.tsx:117-119` | "Billing is reachable on iOS: subscriptions are sold through Apple In-App Purchase there (Guideline 3.1.1), so this row is no longer gated." There is no In-App Purchase in this app. The conclusion (do not gate the Billing row) happens to be right, but the stated reason is false and is exactly the kind of comment that has previously been trusted instead of the code. |

## 3. Surfaces checked and found already gated

Recorded so the next sweep does not redo them.

- `middleware.ts:22-30` redirects `/pricing`, `/compare`, `/affiliate`, and
  `/gift` (except `/gift/claim`) to `/` on iOS.
- `lib/iap-guard.ts` `blockedIosAppPurchase` is called first in all five
  session-creating routes: `app/api/stripe/checkout/route.ts:22`,
  `app/api/stripe/portal/route.ts:15`, `app/api/stripe/topup/route.ts:17`,
  `app/api/gift/checkout/route.ts:40`,
  `app/api/billing/topup-checkout/route.ts:30`. Because the guard runs before
  the tier check, the steering string at `app/api/stripe/topup/route.ts:51`
  ("Upgrade your subscription first") cannot be produced for an iOS request.
- `app/billing/page.tsx`: subhead, checkout and top-up result banners, trial
  copy, the top-up navigation row, the plan ladder, the Boost pack row and
  `TopUpButtons` are each behind both `!isIos` and `data-hide-on-ios`.
- `app/billing/tier-card.tsx:217` and `app/billing/personal-tier-card.tsx:148`
  render the reader-model sentence, with no price and no destination.
- `components/RestorePurchases.tsx` is a status card only. It contains no
  StoreKit call, no restore control, no price and no destination.
- `components/TokenBalanceGauge.tsx:82` carries `data-hide-on-ios` on the
  button, which is the only path to `components/TopUpModal.tsx`.
- `app/counsel/billing/tokens/topup-button.tsx:16` hides the firm top-up
  button in both native shells (`data-hide-in-app`).
- `app/counsel/billing/page.tsx:303` removes the Stripe "Pay link" on iOS on
  the server and marks it `data-hide-on-ios`.
- `app/cases/new/page.tsx:117-160`, `app/cases/[id]/review-panel.tsx:216-224`
  and `:596-602`, `app/cases/[id]/timeline/page.tsx:110-124`, and
  `app/inbox/documents/page.tsx:48-67` all use the paired
  `data-show-in-app` / `data-hide-on-ios` copy, so the iOS sentence stands on
  its own instead of dangling.
- `app/features/page.tsx:53`, `components/marketing/FeatureSheet.tsx:320`,
  `app/not-found.tsx:99-118`, `app/press/page.tsx:119`,
  `app/gift/claim/[token]/page.tsx:140-145`, and `app/layout.tsx:796` gate
  their `/pricing` links.
- `components/counsel/CounselTrialBanner.tsx` and
  `app/counsel/access-ended/page.tsx` contain no purchase CTA. The firm trial
  and suspension notices offer a data download, not a plan.
- `lib/ai-errors.ts` never mentions billing to the user; provider credit
  failures resolve to the same neutral "unavailable" copy as everything else.

## 4. Which way each gate fails

"Fails open" means an unrecognised request gets the web behaviour, which
inside the app is the purchase surface.

| Gate | Signal | Unknown or missing UA | Correct? |
| --- | --- | --- | --- |
| `lib/platform.ts` `nativePlatformFromUserAgent` | UA token | returns `web` | Yes for the web, and it is the root of every fail-open below. A browser sends no token and must keep the full site. |
| `lib/ios-gate.ts` `isIosAppRequest` | same UA token | `false`, so the purchase markup renders | Fails open. Accepted by design, and compensated by the CSS layer below. |
| `lib/iap-guard.ts` `blockedIosAppPurchase` | same UA token | returns `null`, so the Stripe session is created | Fails open. This is the money path, and it is the single most consequential fail-open in the set. |
| `middleware.ts` sell-route redirect | same UA token | no redirect, `/pricing` renders | Fails open. |
| `globals.css` `.is-ios-app [data-hide-on-ios]` | `<html>` class | class comes from the server UA (`app/layout.tsx:518`) OR from `components/NativePlatformBoot.tsx` reading `window.Capacitor` | The only layer with a signal that does not depend on the UA token. If the token is absent but the bridge is present, this still hides the control. |
| `lib/platform.ts` `isPhoneUserAgent` | device tokens | `false`, "not a phone" | Correct, and documented as deliberate: callers use it to withdraw a handoff, never to refuse. |

The honest summary: four of the six layers key on the same string, and they
all fail open together. The CSS layer is the only independent one, and it
does not cover plain server-generated text such as the Bella and server
action strings in section 2. That is why those strings are worth fixing at
the source rather than gating.

## 5. Not verified

- No `.ipa` or TestFlight binary was inspected. The UA token is proven from
  config through framework source, not from a shipped artifact.
- No device or simulator run. Nothing here was observed on screen.
- The Apple review correspondence was not available, so no claim is made
  about which of these a reviewer saw or cited.
