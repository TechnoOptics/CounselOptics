# Publishing Advottic to the App Store + Play Store

This is the runbook for the first release. Everything that could be done from this Windows machine has been done; this doc covers what's left for **you** to do (developer accounts, signing, store listings, IDE-level builds and submission).

---

## What's already done in this repo

- Capacitor 8 installed (`@capacitor/core`, `@capacitor/ios`, `@capacitor/android`, `@capacitor/cli`). The icon generator, `@capacitor/assets`, is deliberately not installed; run it through `npx` when needed (it pins an old sharp and an old Capacitor CLI).
- `capacitor.config.ts` configured: bundle id `com.advottic.app`, app name `Advottic`, remote-URL server pointing at `https://advottic.com`, dark splash + status bar
- `android/` native project scaffolded with `npx cap add android`
- Android icons + splash generated for every density (74 files, ~1.5 MB)
- ✅ Adaptive-icon background (forest gradient) + foreground (gold pillar) sources committed at `assets/icon-only.png`, `assets/icon-foreground.png`, `assets/icon-background.png`, `assets/splash.png`, `assets/splash-dark.png`
- ✅ `.gitignore` carve-outs so native build artifacts and signing material never get committed
- ✅ `tsconfig.json` excludes `android/` and `ios/` so the Next.js build doesn't trip over native trees

## What you need to do

You need **two paid accounts**, **one Mac with Xcode** for iOS, and **Android Studio** for Android (works on Windows).

---

## Step 1 - Create developer accounts

| Platform | URL | Cost |
|---|---|---|
| Apple Developer Program | https://developer.apple.com/programs/enroll | $99 / year |
| Google Play Console | https://play.google.com/console/signup | $25 one-time |

Both ask for legal entity info: use **Techno Optics LLC**, EIN, Minnesota address. Apple may take 24-48 hours to approve; Google is usually same-day.

---

## Step 2 - Android: build the signed bundle

You can do this on the Windows machine. **Install Android Studio first**: https://developer.android.com/studio

### 2a. Generate the upload keystore (one-time)

This is the key Google uses to verify all future updates. **Lose it and you can never update the app again** (without Play App Signing reset). Back it up.

Run from the repo root:

```sh
keytool -genkey -v \
  -keystore android/app/advottic-upload.keystore \
  -alias advottic-upload \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

It'll prompt for:
- Keystore password (memorize, save in a password manager)
- Your name + organization (Techno Optics LLC, Minnesota, US)
- Key password (use the same as the keystore password to keep it simple)

The `.gitignore` already excludes `*.keystore` so this file stays local.

### 2b. Wire the keystore into Gradle

Create `android/key.properties` (already gitignored):

```properties
storePassword=<your keystore password>
keyPassword=<your key password>
keyAlias=advottic-upload
storeFile=advottic-upload.keystore
```

Then edit `android/app/build.gradle`. Add this **above** the `android {` block:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
  keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

Inside the `android {` block, add:

```gradle
signingConfigs {
  release {
    keyAlias keystoreProperties['keyAlias']
    keyPassword keystoreProperties['keyPassword']
    storeFile file(keystoreProperties['storeFile'])
    storePassword keystoreProperties['storePassword']
  }
}
buildTypes {
  release {
    signingConfig signingConfigs.release
    minifyEnabled false
  }
}
```

### 2c. Build the App Bundle

```sh
npx cap sync android
npx cap open android
```

In Android Studio:
1. Wait for Gradle sync to finish (first run downloads ~300 MB of dependencies, so be patient)
2. Build → **Generate Signed Bundle / APK** → *Android App Bundle*
3. Pick your keystore, enter passwords
4. Choose **release** build variant
5. The output `.aab` lands at `android/app/release/app-release.aab`

### 2d. Submit to Play Console

1. https://play.google.com/console → **Create app** → fill the basics from the listing template below
2. **Internal testing** track → Create release → Upload the `.aab`
3. Add yourself as a tester, install on your phone via the Play Store invite link
4. Once it works, promote to **Production** track and submit for review (1-3 days)

---

## Step 3 - iOS: build the signed archive

This step **requires a Mac** with Xcode 15+. There's no workaround.

### 3a. On the Mac, clone the repo

```sh
git clone https://github.com/TechnoOptics/CounselOptics.git advottic
cd advottic
npm install
npx cap add ios
npx --yes @capacitor/assets@3 generate --ios
npx cap sync ios
npx cap open ios
```

`npx cap add ios` creates the `ios/` directory (don't worry about it not being in the repo; it generates fresh from `capacitor.config.ts`).

### 3b. In Xcode

1. Sign in with your Apple ID (Xcode → Settings → Accounts)
2. Project navigator → **App** → Signing & Capabilities
3. Team: select your Apple Developer team
4. Bundle Identifier: `com.advottic.app` (already set)
5. Product → Archive → wait for build
6. Window → Organizer → select the archive → **Distribute App** → App Store Connect → **Upload**

### 3c. Submit on App Store Connect

1. https://appstoreconnect.apple.com → **My Apps** → **+** → **New App**
2. Bundle ID: `com.advottic.app`, SKU: `advottic-001`, Primary language: English (U.S.)
3. Fill the listing using the template below
4. **TestFlight** tab → wait for the upload to process (~10 min) → install on your iPhone
5. Once verified, **App Store** tab → **Submit for Review** (1-7 days, usually 24-48 hours)

---

## Step 4 - Store listing copy

Use this verbatim. Both stores accept the same descriptions; keep word counts within their limits.

### App name
**Advottic**

### Subtitle / short description (30 chars Apple / 80 chars Google)
- Apple: `Strategic advocacy. Trusted.`
- Google: `Build the case. Walk into court ready. Advottic Review spots issues, Bella explains.`

### Full description (4000 chars max)

> Advottic turns scattered evidence into an organized case packet your attorney can read in five minutes. Built for individuals, businesses, and self-represented litigants navigating a real-life legal matter.
>
> CAPTURE
> Open one case file per matter. Capture parties, jurisdiction, posture (claimant or defendant), and a description of what happened. Subject profile collects address, contact info, and identifying details so you don't have to chase them later.
>
> ATTACH EVIDENCE
> Photos, PDFs, audio, video, screenshots, communications. Each upload becomes an auto-numbered exhibit (Exhibit A, B, C…) with category, source, and incident date captured. Up to 50 MB per file, every common format.
>
> AUTO-SCAN
> Upload a parking ticket, traffic citation, court summons, or eviction notice and Advottic's document scanner pulls out case numbers, ticket numbers, parties, dates, statute references, and amounts due automatically. Audio and video uploads can be transcribed.
>
> ADVOTTIC REVIEW
> Run a Claude-backed review of the matter. It surfaces possible legal issues grounded in your jurisdiction, evidence gaps, and concrete subpoena targets - all in plain English with hedged language. Never legal advice.
>
> HEARING PREP
> Set a hearing date and Advottic shows a countdown card plus a prioritized to-do list keyed to your case state: missing exhibits, missing review, defendant procedural reminders, courtroom confirmation, PDF export, attorney share. Items reorder by urgency as the date approaches.
>
> COLLABORATE
> Invite your attorney by email - they get read access plus the ability to add exhibits, but cannot edit case metadata or invite others. (Pro plan)
>
> EXPORT
> One PDF case packet with a cover, case info, exhibits index, and Advottic Review - ready to email or print.
>
> ASK BELLA
> An on-demand virtual assistant explains legal doctrines in plain English, walks you through the app, and never crosses the line into legal advice. For criminal matters, Bella will always remind you that you have a constitutional right to a public defender.
>
> NOT LEGAL ADVICE
> Advottic is not a law firm and does not create an attorney-client relationship. Information only. For legal advice, consult a licensed attorney in your jurisdiction.
>
> PRICING
> 7-day free trial. Basic $9/month, Standard $19/month (adds Advottic Review + Bella), Pro $50/month (adds collaborator sharing, court e-filing directory, public-defender directory). Cancel any time.

### Keywords (Apple, 100 chars total)
`legal,case,attorney,evidence,hearing,exhibit,pro se,court,citation,ticket,defendant,advocacy`

### Promotional text (Apple, 170 chars - shown on the listing)
`Walk into court prepared. Capture every piece of evidence, surface jurisdiction-aware issues, and ship a packet your attorney can read in five minutes.`

### Category
- Apple Primary: **Productivity** · Secondary: **Business**
- Google: **Productivity** (with "Business" sub-category)

### Age rating
- 17+ on Apple (legal/professional content)
- Mature 17+ on Google

### Required URLs (Apple + Google both)
- Privacy policy: `https://advottic.com/privacy`
- Terms of service: `https://advottic.com/terms`
- Marketing URL: `https://advottic.com`
- Support URL: `https://advottic.com/find-counsel` (or a `mailto:contact@advottic.com`)

### Contact info
- Email: `contact@advottic.com`
- Phone: `+1 (925) 300-1600` (only Google requires this)

---

## Step 5 - Screenshots

Both stores require screenshots. **Take them on a real device after installing your TestFlight / Internal-Test build**, not on a simulator.

### Required sizes

| Device | Size (px) | Count |
|---|---|---|
| iPhone 6.7" (iPhone 15 Pro Max etc.) | 1290 × 2796 | 3-10 |
| iPhone 6.5" (iPhone 11 Pro Max) | 1242 × 2688 | 3-10 (optional if 6.7" provided) |
| iPad Pro 12.9" | 2048 × 2732 | 3-10 (optional unless an iPad-only feature) |
| Android phone | 1080 × 1920 minimum | 2-8 |
| Android 7" tablet | optional | 1-8 |
| Android 10" tablet | optional | 1-8 |

### Screenshot script - what to capture (in order)

1. **Hero / sign-in**: open landing page, scroll to "Your case, ready to be heard." Capture the full hero with the gold-shine title.
2. **Cases dashboard**: sign in, capture the KPI tiles + "Your cases" section with at least 2 example cases.
3. **Case detail header**: open one case, capture the dark forest hero with the gold-shine title + KPI strip (Exhibits / Hearing / Advottic Review / Sharing).
4. **Hearing tab**: capture the countdown card + prioritized checklist with mixed urgency (some items completed).
5. **Exhibits tab with auto-scan**: capture an exhibit row showing the auto-detected ticket type, identifiers, parties, and dates accordion expanded.
6. **Advottic Review**: capture the AI review tab with summary + possible issues + evidence-to-strengthen lists visible.
7. **Bella in action**: open Bella, capture a conversation with at least 2 exchanges showing markdown rendering.
8. **Find counsel**: capture the find-counsel page with the embedded Google Maps result + practice-area filter.

---

## Step 6 - Privacy data collection (App Privacy / Data Safety)

Both stores ask you to declare what data you collect. **Be honest**: these answers must match your `/privacy` page.

| Data type | Collected? | Linked to user? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Email address | Yes | Yes | No | Account creation, sign-in, billing |
| Name | Yes (optional) | Yes | No | Display in app, on case packets |
| Phone | No | - | - | - |
| Photos / videos | Yes (user uploads) | Yes | No | Case exhibits, processed by AI per /privacy |
| Audio | Yes (user uploads) | Yes | No | Case exhibits, transcribed via OpenAI Whisper |
| Files & docs | Yes (user uploads) | Yes | No | Case exhibits, PDF export |
| Payment info | Handled by Stripe | No | No | We never see card data |
| Identifiers (user ID) | Yes | Yes | No | Auth |
| IP address | Yes (logs) | Yes | No | Rate limiting, security |
| Usage data | No | - | - | - |
| Diagnostics | Yes (Vercel) | No | No | Crash & latency monitoring |

Tracking declaration: **No**. We do not run third-party trackers and do not sell data.

---

## Step 7 - Update flow

Once both apps are live, content updates ship **automatically**: push to `main`, Vercel deploys, the in-app webview picks up the change on next load. App Store / Play Store submission is **only** required when:

- A native plugin is added (camera, push, biometrics, etc.)
- Permission set changes
- Icons / splash change
- The bundle ID or signing changes

For "shell-only" updates, bump `versionCode` (Android) and `version`/`build` (iOS) in the native projects, archive, and upload. No review is re-required if no permission/plugin changes.

---

## Things that block submission and how to dodge them

| Issue | Fix |
|---|---|
| Apple rejects "minimum functionality" because the app is just a webview | Add at least one native plugin (camera or biometric) and exercise it on at least one screen. The "Capture from camera" button on the new-case form is the most obvious one to add. |
| Apple rejects for using Stripe outside their IAP system | Stripe in-app purchases for digital goods are NOT allowed inside iOS apps. Either: keep payment on the web only, or migrate Pro tier to use Apple In-App Purchase. **For first launch: keep all subscription flows web-only.** Hide the `/billing` page inside the iOS shell, or open it in an external Safari window. |
| Google rejects for missing Privacy Policy | Make sure `https://advottic.com/privacy` returns 200 from outside your network. Already done. |
| iOS rejects for "Sign in with Apple" missing | If you offer Google or Microsoft sign-in, you **must** also offer Sign in with Apple. Currently the app has Google + Microsoft + magic link. Either: add Sign in with Apple to Supabase Auth before submitting iOS, OR remove Google + Microsoft from the iOS build and only show magic link. |
| App Tracking Transparency missing on iOS | Not required, we don't track. Declare "No" in the privacy questionnaire. |

---

## When something goes wrong

- **Android build error**: usually a Gradle cache problem. `cd android && ./gradlew clean && ./gradlew bundleRelease`
- **iOS code-signing error**: Xcode → Settings → Accounts → "Download Manual Profiles", or toggle "Automatically manage signing" off and on
- **App appears blank in TestFlight**: confirm `https://advottic.com` is reachable (try in mobile Safari first); the webview is loading the live site, so a DNS or cert issue at advottic.com cascades into the app.

When you're ready or stuck, paste the error here and I'll work through it with you.
