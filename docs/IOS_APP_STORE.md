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
