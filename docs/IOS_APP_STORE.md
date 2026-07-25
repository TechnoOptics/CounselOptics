# iOS App Store submission — Advottic

Concrete step-by-step checklist for shipping the Advottic iOS app to the
Apple App Store. Companion to `docs/MOBILE.md` (which covers the broader
Capacitor / web-app / Android picture). This file is the playbook for
**this submission**.

The iOS shell is a Capacitor remote-URL wrapper: a thin native
container that loads `https://www.advottic.com` inside a WKWebView. We
keep server actions + API routes + Stripe webhooks running on Vercel,
and we only submit a new App Store build when the native shell itself
changes (new plugin, new permission, new icon). For content updates,
push to `main` and the in-app webview picks them up on next launch.

---

## 0. Prerequisites

- **Apple Developer Program** — $99/yr, enrollment at
  https://developer.apple.com/programs/enroll. Approval takes 24-48
  hours. Use your Techno Optics LLC if you want the publisher to read
  as a company; an individual enrollment is faster but lists under
  your personal name.
- **A Mac with Xcode 15+** (free from the Mac App Store).
- **The repo cloned on the Mac.** All commands below assume the
  working directory is the repo root.

---

## 1. One-time iOS project init (Mac)

This creates the `ios/App/App.xcodeproj` Capacitor project inside the
repo. Commit the resulting `ios/` folder so this step never has to
run again on a clean clone.

```sh
npm install
npx cap add ios
npx cap sync ios
```

Then open it in Xcode:

```sh
npx cap open ios
```

---

## 2. Configure signing in Xcode

1. In the Xcode left sidebar, click the **App** project (top of
   tree).
2. Select the **App** target → **Signing & Capabilities** tab.
3. Check **Automatically manage signing**.
4. Pick your Apple Developer team from the dropdown. The Bundle ID
   should auto-populate from `com.advottic.app` (set in
   `capacitor.config.ts`); leave it as is.
5. Click **+ Capability** in the toolbar and add **Sign in with
   Apple**. (Required because the website now offers it; this
   capability lets the app participate in native Apple sign-in if
   we add a Capacitor plugin later, and prevents Apple from
   complaining that the Bundle ID's app-services don't match the
   web-side claims.)

---

## 3. Drop the App Icon into the asset catalog

The icon endpoint at `/ios-icon?size=N` serves the same forest +
gold-A monogram from the web favicon at any iOS-required size. From
the Mac, in Terminal at the repo root:

```sh
mkdir -p icons-tmp && cd icons-tmp
for SIZE in 20 29 40 58 60 76 80 87 120 152 167 180 1024; do
  curl -o icon-${SIZE}.png "https://www.advottic.com/ios-icon?size=${SIZE}"
done
cd ..
```

Then in Xcode:

1. Open `ios/App/App/Assets.xcassets/AppIcon.appiconset` from the
   navigator.
2. Drag each PNG to the corresponding empty slot in the icon
   matrix. Xcode names them by the size + scale shown on each box.
3. Save. The 1024 goes to **App Store** at the bottom.

(Alternative: install `npm i -D @capacitor/assets` and run
`npx capacitor-assets generate` if you want it fully automated, but
the curl loop above is faster for one shot.)

---

## 4. Sign in with Apple — Apple Developer + Supabase wiring

The button is already in the sign-in page. Server-side, you need to
hook the Supabase Apple OAuth provider to your Apple Developer account.

### In Apple Developer portal
1. Go to https://developer.apple.com/account/resources/identifiers/list
2. **+ → App IDs → App** → Bundle ID `com.advottic.app` → check
   **Sign in with Apple** → Continue → Register.
3. Back at Identifiers, **+ → Services IDs** → Identifier
   `com.advottic.web` (this represents your web service for OAuth) →
   Continue → Register.
4. Click your new Service ID → check **Sign in with Apple** →
   **Configure**:
   - Primary App ID: `com.advottic.app`.
   - Domains: `advottic.com`, `www.advottic.com`,
     `hpmtlhpyvbreyfimftgt.supabase.co`.
   - Return URLs: `https://hpmtlhpyvbreyfimftgt.supabase.co/auth/v1/callback`.
5. Go to **Keys** in the sidebar → **+** → name "Advottic Apple
   Sign-In Key" → check **Sign in with Apple** → Configure → pick
   the App ID `com.advottic.app` → Save → Continue → Register →
   download the `.p8` file. **You can only download it once.**
6. Note the **Key ID** (10-char string shown next to the new key)
   and your **Team ID** (top-right of the developer portal).

### In Supabase dashboard
1. Project → Authentication → Providers → **Apple** → enable.
2. **Services ID**: `com.advottic.web`
3. **Team ID**: from step 6 above.
4. **Key ID**: from step 6 above.
5. **Secret Key (.p8 contents)**: paste the contents of the .p8
   file (including BEGIN/END markers).
6. Save. Sign in with Apple now works on web AND inside the iOS shell.

---

## 5. App Store Connect — create the listing

At https://appstoreconnect.apple.com:

1. **My Apps → +** → New iOS App.
   - Platform: iOS.
   - Name: `Advottic`.
   - Primary language: English (U.S.).
   - Bundle ID: pick `com.advottic.app` from the dropdown (it
     appears here once Apple Developer registration is done).
   - SKU: `advottic-ios-001` (or anything unique).
2. **App Information** page:
   - Privacy Policy URL: `https://www.advottic.com/privacy`
   - Support URL: `https://www.advottic.com/feedback`
   - Subtitle (30 char): `Build your case file calmly`
   - Category: **Productivity** (primary), **Reference** (optional secondary).
3. **Pricing and Availability**:
   - Free with In-App Purchases (Stripe still handles billing on
     the web; Apple does NOT take a cut of services rendered on
     the web, only of digital goods). Important: **do NOT add an
     Apple In-App Purchase for the Pro subscription** — Apple's
     guideline 3.1.3(b) ("Multiplatform Services") explicitly
     allows web-purchased subscriptions to be used inside the app
     so long as you don't link to a payment page from inside the
     app or use anti-steering language. The /billing page works
     when opened in the in-app webview because the user is paying
     for an ongoing service that's also accessible on the web.
4. **App Privacy** (the nutrition label):
   - Tap **Get Started** → answer the questionnaire honestly. For
     Advottic the answers are:
     - Contact Info → Email Address: **Yes** → Linked to user →
       Used for App Functionality + Account Management.
     - User Content → Other User Content: **Yes** → Linked to user
       → Used for App Functionality. (This covers case content +
       exhibits.)
     - Identifiers → User ID: **Yes** → Linked to user → Used for
       App Functionality.
     - Purchases → Purchase History: **Yes** → Linked to user →
       Used for App Functionality.
     - Diagnostics → Crash Data + Performance Data: **Yes** →
       Linked to user → Used for App Functionality. (We capture
       client errors via crash_reports.)
     - Tracking: **No.** We don't request the IDFA.
5. **Age Rating**: take the questionnaire. With user-generated
   content + unrestricted web access (Bella renders external
   links), expect 17+.

---

## 6. Screenshots

Required sizes for App Store submission (you only need one device
class, but Apple uses the largest you upload as the fallback for
smaller devices):

| Size | Resolution | Required? |
|---|---|---|
| 6.9" iPhone (iPhone 16 Pro Max) | 1320 x 2868 | recommended |
| 6.7" iPhone (iPhone 15 Pro Max) | 1290 x 2796 | required |
| iPad 13" | 2064 x 2752 | required if iPad-compatible |

**Easiest source:** open the built iOS app on the iPhone 15 Pro Max
simulator in Xcode (Cmd+R, pick simulator from device list), then
press **Cmd+S** in the simulator to save a PNG to your desktop. Do
this from `/cases`, `/cases/[id]`, `/example`, `/find-counsel`,
`/billing`. Trim to 5 screenshots, drop into App Store Connect.

If iPhone 16 Pro Max + iPad screenshots are missing, App Store
Connect won't block the submission as long as the 6.7" set is
provided.

---

## 7. Build + archive + upload (Xcode)

1. In Xcode, top device dropdown → switch to **Any iOS Device
   (arm64)**. (Archive can't run against a simulator.)
2. Product → **Archive**. Takes 2-5 min.
3. Xcode Organizer opens automatically. Click your archive →
   **Distribute App** → **App Store Connect** → **Upload**.
4. Wait 5-15 min. The build will appear in App Store Connect under
   **TestFlight** with status "Processing". When that flips to
   "Ready to Submit" (~10-30 min), it's available to attach to the
   live submission.

---

## 8. TestFlight (recommended — catch issues before review)

1. App Store Connect → your app → **TestFlight** tab.
2. Add yourself as an internal tester. You'll get an email + the
   TestFlight app on your phone within minutes.
3. Install. Use the app for 5-10 minutes: sign in via each
   provider (Google, Microsoft, Apple), create a case, run Legal
   Eye, open `/billing`, force airplane mode to confirm the
   `offline.html` fallback shows.
4. Catch any issues (sign-in failures, blank screens, crashes)
   before submitting to review — fixes after rejection cost a
   round-trip of 1-2 days.

---

## 9. Submit for review

1. App Store Connect → your app → **+** next to "iOS App" → fill
   the version form (1.0.0).
2. **Build**: pick the build that just uploaded.
3. **What to test (review notes)** — this is the box where you
   tell the Apple reviewer how to use your app. Suggested copy:

   > Advottic helps users organize legal case files. The app is a
   > native shell around https://www.advottic.com.
   >
   > Test account:
   >   email: appreview@advottic.com
   >   password: provided via App Review Notes shared file
   >   (or: Sign in with Apple works for any Apple ID)
   >
   > Suggested test flow: sign in → create a case (Smart Assist
   > wizard) → upload an exhibit → run Advottic Review → check /billing.
   >
   > Subscriptions: Pro tier is a multiplatform subscription
   > offered on the web at https://www.advottic.com/billing. Per
   > guideline 3.1.3(b), we do not offer Apple In-App Purchase
   > for it; the in-app /billing page reflects the same web
   > subscription that customers manage from any browser.
4. **Submit for Review.** Apple usually responds within 24-48
   hours.

---

## 10. Common rejection reasons (and how we've already addressed them)

| Reason | Status |
|---|---|
| Missing Sign in with Apple when other social logins offered (4.8) | Already shipped — black "Sign in with Apple" button on /sign-in. |
| Blank screen / app freeze when offline | `public/offline.html` is the Capacitor fallback. |
| Privacy policy URL missing or 404 | `/privacy` returns 200, has iOS-specific clauses. |
| Privacy nutrition label mismatch with privacy policy | Nutrition label questionnaire above is aligned with the policy. |
| In-App Purchase missing for digital goods (3.1.1) | We're using the multiplatform-services exemption (3.1.3(b)), explicit in review notes. |
| App is a "thin web wrapper" with no native value (4.2) | Capacitor adds offline detection, native splash, status bar tinting, plus we'll add camera/file picker plugins on iteration 2. Cite these in review notes if challenged. |
| Account deletion not in-app | Add a /profile → "Delete account" flow before v1.1. **Required for new apps as of 2022.** Not blocking v1 if you're updating an existing app, but for a NEW submission, this is a likely rejection. We have `app/api/account/delete` already; just confirm the /profile UI exposes it. |

---

## 11. After approval

- App goes live on the App Store within ~1 hour of approval.
- Future content updates: push to `main` → Vercel deploys → in-app
  webview picks them up on next launch. **No new App Store
  submission needed for content.**
- Native shell updates (new plugin, new permission, new icon, new
  splash) require a re-archive + new App Store submission. Bump
  the version in `Info.plist` first.

---

## 12. Resolution Center reply — subscription / IAP (3.1.3(b))

Ready-to-paste reply for an App Review rejection questioning the
subscription model / missing In-App Purchase. It restates the
multiplatform-services position (section 9). Keep the App Review
Notes field saying the same thing.

> Hello, and thank you for the review.
>
> Advottic is a genuine multiplatform legal case-organization
> service. The same account, cases, and subscription are available
> on the web (advottic.com) and on Android, and the iOS app is a
> native client for that same service.
>
> Regarding the subscription concern: Advottic does not offer any
> in-app purchase and does not process any payment inside the iOS
> app. Consistent with App Store Review Guideline 3.1.3(b)
> (Multiplatform Services), paid plans are account-based
> subscriptions that customers purchase and manage on the web. The
> in-app Billing screen does not sell anything or start a checkout;
> it simply reflects the customer's existing subscription status and
> current plan. There is no Apple In-App Purchase product, no
> third-party payment SDK, and no purchase button in the app.
>
> When a signed-in user is not yet subscribed, the app only displays
> their status; access to any paid feature unlocks automatically once
> the account is subscribed, on whichever platform they signed up.
> Users are never blocked from the free functionality of the app.
>
> To help testing:
> - Test account: appreview@advottic.com (password in App Review
>   Notes). Sign in with Apple also works with any Apple ID.
> - Suggested flow: sign in -> create a case with the Smart Assist
>   wizard -> upload an exhibit -> run Advottic Review -> open Billing
>   to see the account's plan status.
>
> We believe the app fully complies with 3.1.3(b). If any specific
> screen still needs adjustment, we're glad to make it right away;
> please let us know the exact screen and we'll turn a build around
> quickly.
>
> Thank you for your time.

**Copy posture (anti-steering):** the in-app iOS billing surfaces
describe subscription STATUS only and do NOT name an external website
or say "subscribe on the web" (that wording was removed to stay clearly
inside 3.1.3(b) anti-steering). The reader-model note now reads: "Your
access unlocks here automatically once your account is subscribed."
Web + Android keep the real Stripe checkout button.

## 13. Resolution Center reply — rejection of 2026-07-09 (2.1(b) + 4.2 + 5.1.2(i))

Submission `864667fd-c47b-4005-8434-4ce3860062f6`, reviewed 2026-07-09 on
iPhone 17 Pro Max / iPad Air (M3), iOS/iPadOS 26.5.2. Four issues:
2.1(b) "purchase button missing", 2.1(b) "Plus/Pro/Ultra IAP not submitted",
4.2 minimum functionality, 5.1.2(i) privacy/ATT (cookies).

**Code/config already shipped for this round (web = live in the existing
remote-URL binary immediately on deploy):**
- Cookie-consent prompt is now suppressed inside the native apps
  (`components/CookieBanner.tsx` → `isNativeApp()` short-circuit). Essential
  first-party cookies only; no tracking. Directly follows Apple's 5.1.2(i)
  "remove the cookie prompts" path.
- iOS Billing no longer renders the purchasable Plus/Pro/Ultra ladder or the
  token top-up buttons (`app/billing/page.tsx`, server UA gate
  `serverPlatform === 'ios'`). iOS shows current-plan STATUS only + a neutral
  "nothing to buy in the app" note. Removes Apple's basis for "IAP products
  not submitted / purchase button missing".

**⚠️ Widget claim removed from the reply (2026-07-19):** the WidgetKit source
files exist (`ios/App/AdvotticWidget/`) but the widget target was NEVER added to
`App.xcodeproj` — `project.pbxproj` has zero references to it — so the reviewed
binary 1.0.16 (20) contains no widget. Do not claim widgets to App Review until
the one-time Xcode target setup in docs/WIDGETS.md is done AND a new build is
uploaded. Every other 4.2 claim in the reply is verified in-repo: Sign in with
Apple (sign-in page), Face ID/Touch ID app lock (@aparajita/capacitor-biometric-auth
+ BiometricUnlockGate/BiometricSettings), Safe Alert (Core Location + SMS),
camera capture, offline (cache-first service worker). Optional stronger path:
do the widget setup first, upload build (21), and restore the widget claim.

**App Store Connect actions the Account Holder must do before resubmit:**
1. App Privacy → confirm "Data is Not Used to Track You" (no tracking declared).
2. Do NOT create/submit any In-App Purchase products (reader model — none exist).
3. Confirm the App Review Notes describe the multiplatform/reader model + test
   account, then Resubmit to App Review (no new binary strictly required — the
   remote-URL shell picks up the deployed web fixes; a version/build bump is
   optional but fine).

**Ready-to-paste reply:**

> Hello, and thank you for the detailed review.
>
> We've made changes and would like to clarify how Advottic works. Advottic is a
> legal case-management service; the iOS app is the native client for accounts
> people create on our multiplatform service (web + Android + iOS).
>
> **Guideline 2.1(b) — In-App Purchase / purchase button.** Advottic does not
> sell any digital goods or subscriptions inside the iOS app, and by design there
> is no in-app purchase button. Subscriptions (and token top-ups) are purchased
> and managed by the account holder on our service; the paid entitlement then
> unlocks automatically for that same account on iOS, Android, or the web. This
> is the multiplatform / reader model of Guidelines 3.1.3(a)–(b). There are
> therefore no In-App Purchase products to submit for this app. To remove any
> ambiguity, we've updated the iOS Billing screen so it no longer displays a list
> of named, purchasable plans (Plus / Pro / Ultra); on iOS it now shows only the
> account's current plan status and a neutral note that the subscription is
> managed from the user's account, with nothing to buy in the app. No purchase
> button is missing — there is intentionally none.
>
> **Guideline 5.1.2(i) — Privacy / tracking.** Advottic does not track users. We
> use only strictly-necessary, first-party cookies to keep the user signed in and
> the session secure. We use no advertising SDKs, share no data with data
> brokers, and never link user data with third-party data for advertising.
> Because there is no tracking, we have removed the cookie-consent prompt inside
> the iOS app, per your guidance, and our App Privacy information reflects "Data
> Not Used to Track You."
>
> **Guideline 4.2 — Minimum Functionality.** Advottic is a full legal
> case-management application, not a repackaged website. Native, device-level
> functionality in this build includes: Sign in with Apple; Face ID / Touch ID
> app lock; "Safe Alert" — background Core Location with one-tap emergency SMS to
> the user's trusted contacts; native camera capture for adding evidence to a
> matter; and offline access to previously loaded case content. These sit on top
> of the substantive product itself: guided case building, an evidentiary
> timeline, document/evidence management, e-signature, and court-packet export.
> We'd welcome the chance to walk a reviewer through any of these — a test
> account and a step-by-step flow are in the App Review Notes.
>
> If any specific screen still needs adjustment, tell us exactly which and we'll
> turn around a change quickly. Thank you for your time.

## 14. Resolution Center reply — rejection of 2026-07-21 (2.1(b) info needed + 4.2)

Round 3 on submission `864667fd`. 5.1.2(i) CLEARED (cookie fix accepted).
Remaining: 2.1(b) downgraded to "Information Needed" (4 business-model
questions — Apple is evaluating the reader-model claim), and 4.2 still
standing (reviewer: push/location/sharing "not robust enough"; the
reply-only defense failed — real native functionality must be IN the
binary).

**Shipped for this round:** the AdvotticWidget WidgetKit extension is now
wired into the Xcode project (`ios/App/add_widget_target.rb`, idempotent)
and verified embedded in the built app (`App.app/PlugIns/AdvotticWidget.appex`).
Versions set to 1.0.16 (22) on both targets.

**Account-holder steps before replying (Xcode, one-time):**
1. Open `ios/App/App.xcodeproj` → App target → Signing & Capabilities:
   with automatic signing signed in as the Account Holder, Xcode
   registers `group.com.advottic.app` on the App ID (or register it at
   developer.apple.com → Identifiers → App Groups first).
2. Repeat for the AdvotticWidget target (same App Group).
3. Product → Archive → Distribute → App Store Connect (build 1.0.16 (22)).
4. In the submission, swap the rejected build 20 for build 22.
5. Post the reply below, then Resubmit.

**Ready-to-paste reply:**

> Hello, and thank you for the follow-up questions — answers below.
>
> **1. Who are the users that will use the paid content, subscriptions,
> features, and services in the app?**
> Advottic's customers: individual consumers documenting a legal matter
> (Personal plans) and law firms (Firm plans). They create an Advottic
> account on our website, advottic.com, and can then use that same account
> on the web, on Android, or in this iOS app.
>
> **2. Where can users purchase the content, subscriptions, features, and
> services that can be accessed in the app?**
> Exclusively on our website, advottic.com, via our web checkout. Nothing
> is sold inside the iOS app, and the iOS app contains no purchase
> buttons, price lists, or links to external purchase flows.
>
> **3. What specific types of previously purchased content, subscriptions,
> features, and services can a user access in the app?**
> The features of their existing account subscription: AI-assisted case
> review and analysis, the evidentiary timeline builder, document and
> evidence storage, court-packet PDF exports, e-signature, and (for firm
> accounts) the firm's case-management workspace. Entitlements attach to
> the account and unlock automatically wherever the user signs in.
>
> **4. What paid content, subscriptions, or features are unlocked within
> the app that do not use In-App Purchase?**
> The account subscriptions described above (Personal and Firm plans,
> purchased on our website). These are multiplatform services within the
> meaning of Guideline 3.1.3(b): purchases made outside the app are
> accessible in the app because they are accessible on the other
> platforms too. The app itself sells nothing, shows no pricing, and does
> not direct users to an external purchase mechanism.
>
> **Guideline 4.2 — Minimum Functionality.** We've taken this feedback
> seriously and build 1.0.16 (22) adds a native WidgetKit Home Screen and
> Lock Screen widget ("Open cases"): small and medium home-screen
> families plus inline/circular/rectangular lock-screen accessories,
> showing the user's open matters, the next hearing as a countdown, and
> the latest case activity — rendered natively from an App Group snapshot,
> visible without opening the app. This joins the existing native
> functionality: Sign in with Apple, Face ID / Touch ID biometric sign-in lock, Safe
> Alert (background Core Location with one-tap emergency SMS to trusted
> contacts), native camera capture for evidence, and offline access to
> previously loaded case content. To try the widget: sign in with the
> review account, open the Cases list once, then long-press the Home
> Screen → + → Advottic → "Open cases."
>
> Separately, we have re-audited every screen reachable inside the iOS app —
> the pricing page, promotional banners, gifting, and feature pages — and
> removed every named plan (Plus / Pro / Ultra), price, trial offer, and
> subscribe control. The iOS app now contains no purchase UI of any kind;
> entitlements simply follow the account. Build 22 also adds the standard
> iOS privacy purpose strings for the camera, location, microphone, photo
> library, and Face ID features described above.
>
> A demo account is provided in the App Review Notes with data already
> populated, so each feature can be exercised immediately.
>
> Thank you again — if anything else needs adjustment we will turn it
> around quickly.
