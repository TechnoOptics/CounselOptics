# Mobile build handoff: Advottic v1.0.4

Single-session playbook for producing the **signed Android AAB** and the
**signed iOS IPA** for Play Store Internal Testing + App Store Connect
TestFlight. Written for someone who has never built an Advottic mobile
shell before; assumes you are sitting at a Mac with Xcode 15+ and
Android Studio installed, signed in to your Apple Developer + Google
Play accounts.

Companion to:
- `docs/MOBILE.md`: long-form architecture (why we chose remote-URL
  Capacitor, what the native shell does and doesn't do).
- `docs/IOS_APP_STORE.md`: detailed iOS App Store Connect listing copy.
- `docs/PLAY_STORE_LISTING.md`: copy-paste listing copy.
- `docs/PLAY_STORE_DATA_SAFETY.md`: Play Console Data Safety form
  answers.

Read each of those before clicking Publish in either portal. This file
is the *build-and-upload* playbook.

---

## 0. Pre-flight (Mac, 5 min)

```sh
# 1. Clone or pull
git clone git@github.com:TechnoOptics/CounselOptics.git
cd CounselOptics
# OR if already cloned:
git pull origin main

# 2. Install dependencies (npm 10+, node 20+ required)
npm install

# 3. Confirm the keystore + Apple credentials are in place
ls android/app/advottic-release.keystore        # signing key
cat android/keystore.properties                  # passwords (gitignored)
# Apple: you'll need to sign in to Xcode -> Settings -> Accounts
# with the Apple ID that owns the Advottic team.
```

The Android keystore is NOT in git. You either:
- have a backup copy from a prior build session, OR
- need to copy it from the Windows machine where it was originally
  generated (`android/app/advottic-release.keystore` + `android/
  keystore.properties`), OR
- accept that you have to generate a new one (which means uninstalling
  any prior Internal Testing release; the new keystore makes the new
  upload look like a different app to Play).

---

## 1. Android build (Mac or Windows with Android Studio)

```sh
# Sync Capacitor config (capacitor.config.ts) into android/
npx cap sync android

# Build the signed App Bundle
cd android
./gradlew bundleRelease
cd ..

# Produced artifact:
ls -lh android/app/build/outputs/bundle/release/app-release.aab
# Typical size: 4-8 MB
```

That `.aab` is what Google Play wants. If the build fails:

- `SDK location not found` → install Android Studio (it bundles the
  SDK); first launch will set `ANDROID_HOME` for you. On macOS:
  `brew install --cask android-studio`. On Windows: download from
  developer.android.com.
- `keystore was tampered with, or password was incorrect` → the
  `keystore.properties` file has the wrong password or alias. Re-check
  the file matches the keystore.
- `Could not resolve com.google.gms` → only fires when `android/app/
  google-services.json` exists; if you haven't set up Firebase yet,
  that file should NOT exist. Delete it and re-run.

### Upload to Play Console (Internal Testing track)

1. Open https://play.google.com/console and pick the existing Advottic
   app entry.
2. Left sidebar → **Testing** → **Internal testing**.
3. **Create new release** button on the right.
4. **App bundles** card → **Upload** → drop in `app-release.aab`.
5. Release name auto-fills to `7 (1.0.4)`. Leave as is.
6. **Release notes** (paste verbatim, English (US)):

   ```
   Audit V9 closure: faster sign-in (no more hydration flashes on the
   auth screen), tighter title bar across the app, and a smarter
   consent dialog that doesn't re-prompt staff. New: signature box
   auto-appends to documents that lack a signing line. Cookie consent
   is now shared across advottic.com, hq.advottic.com, and the
   per-firm subdomains. Trial reminder now shows how long you've
   been in the trial and lets you defer it 24 hours.
   ```

7. **Next** → review the **Pre-launch report** warnings. The Capacitor
   stack always shows a few "deprecated API" warnings; they're noise.
8. **Save** → **Review release** → **Start rollout to Internal testing**.
9. Add testers under **Testers** tab → email list. Maximum 100. Use
   the **Opt-in URL** to share access.

Available in the Play Store app on the tester's device within ~1 hour
(usually 10-15 minutes). Listed as "Internal testing - Beta".

When you're confident: **Internal testing → Promote release → Production**.
Production rolls out after Google's review (usually 2-3 days for a
Capacitor wrapper that's already known to them; up to 7 for a first
submission).

---

## 2. iOS build (Mac only)

```sh
# One-time: create the Xcode project. SAFE to run multiple times -
# it preserves manual edits to Info.plist. Adds the ios/ directory
# which should be committed to git.
npx cap add ios

# Push the latest capacitor.config.ts -> Info.plist + Podfile
npx cap sync ios

# Open in Xcode
npx cap open ios
```

### Xcode signing (one-time per developer machine)

1. Top of file tree: click the **App** project.
2. Select the **App** target → **Signing & Capabilities** tab.
3. Check **Automatically manage signing**.
4. **Team** dropdown → pick your Apple Developer team.
5. Bundle Identifier should auto-populate to `com.advottic.app`.
6. **+ Capability** → **Sign in with Apple**.
   - Required because the website offers third-party login (Google,
     Microsoft). Apple App Review will reject without it.
7. **+ Capability** → **Push Notifications** *(only when we ship the
   `@capacitor/push-notifications` plugin; skip for v1.0.4)*.

### Archive + upload

1. Product menu → **Destination** → **Any iOS Device (arm64)**.
2. Product menu → **Archive**. Build takes ~3-5 min.
3. When Organizer pops up: select the new archive → **Distribute App**.
4. **App Store Connect** → **Upload** → defaults are correct
   (automatic signing, strip Swift symbols, upload symbols).
5. **Distribute**. Upload takes ~2-5 min depending on bandwidth.
6. Wait for the Apple email: *"Your delivery was successful"* (~10
   min after upload). Then in App Store Connect → **TestFlight**, the
   new build appears as "Processing" → becomes available ~30 min.

### App Store Connect: first TestFlight setup

(Skip if you've done this for a prior build.)

1. https://appstoreconnect.apple.com → **My Apps** → **Advottic**
   (or create with **+** → **New App** if missing; Bundle ID is
   `com.advottic.app`).
2. **TestFlight** tab → wait for the build to finish processing.
3. **Encryption compliance** prompt → answer:
   - *Does your app use encryption?* → **Yes**
   - *Does your encryption qualify for exemption?* → **Yes** (HTTPS +
     auth-token encryption only, no proprietary crypto)
   - Save.
4. **Internal Testing** group → add yourself + up to 100 internal
   testers (must be on your team). They get a TestFlight invite email
   immediately, available to install in ~5 min.

### Promoting TestFlight → App Store production

1. Get at least 1-2 weeks of TestFlight usage. Watch for crashes in
   the Crashes tab.
2. Once stable: App Store Connect → **App Store** tab → **+ Version
   or Platform** → **iOS** → version 1.0.4.
3. Fill out the listing using `docs/IOS_APP_STORE.md` as the source.
4. Upload screenshots (sizes documented in IOS_APP_STORE.md; we have
   none yet, so capture from the TestFlight build).
5. **Add for Review** → answer the App Review questions:
   - *Sign-in required?* → Yes → provide a demo account (create a
     dedicated `appreview+ios@advottic.com` account; Apple needs to
     reach all gated surfaces).
   - *Contact info* → your phone + email.
   - *Notes for reviewer* → paste verbatim:

     ```
     Advottic is a remote-URL Capacitor wrapper around advottic.com.
     The app loads our website inside a WKWebView; native plugins
     handle Face ID sign-in (biometric), camera capture for exhibits,
     and document signing via the in-portal e-signature flow.

     Demo account: appreview+ios@advottic.com / [the password you set]
     - On first launch, tap "Continue with email" -> use the magic
       link sent to that mailbox. We've configured the demo mailbox
       so Apple can reach it.
     - After sign-in, the dashboard shows three example cases. Tap
       any case -> Exhibits tab -> "+ Add exhibit" exercises the
       Camera native plugin.
     - Profile -> "Enable Face ID" exercises the biometric plugin.

     Privacy policy: https://advottic.com/privacy
     Support: contact@advottic.com
     ```

6. **Submit for Review**. Apple usually returns within 24-48 hours.

---

## 3. What to watch for in review

### Apple App Review will check

1. **Minimum functionality (Guideline 4.2)**. The remote-URL wrapper
   risks rejection if reviewers feel the app is "just a website". Our
   defense is the native plugins: Face ID, camera, biometric, push.
   Make sure each works on the demo account before submitting.

2. **Sign in with Apple (Guideline 4.8)**. We MUST offer it because we
   also offer Google + Microsoft OAuth. The sign-in screen already
   does, but verify visually on the TestFlight build.

3. **Privacy manifest (`PrivacyInfo.xcprivacy`)**. iOS 17+ requires
   declaring which "required reason APIs" the app uses
   (UserDefaults, file timestamp, etc.). Capacitor 8 ships a default
   manifest, but verify in Xcode: target → Build Phases → Copy
   Bundle Resources → `PrivacyInfo.xcprivacy` should be listed.

4. **Privacy policy URL**. Must be live, public, and match what the
   app actually does. https://advottic.com/privacy is already live.

5. **Demo account credentials**. Apple will not approve an app they
   can't sign into. The credentials we paste in "Notes for reviewer"
   above must work, so test them yourself on the TestFlight build
   from a clean device first.

### Google Play Review will check

1. **Data Safety form** (Play Console → App content → Data safety).
   The answers are pre-drafted in `docs/PLAY_STORE_DATA_SAFETY.md`.
   Paste them in.

2. **Privacy policy URL**. Same one as Apple.

3. **App access** (Play Console → App content → App access). Mark as
   "All or some functionality is restricted." Provide the same demo
   account credentials.

4. **Target audience** → "18+" (legal content is adult by default).

5. **News app declaration** → "Not a news app".

6. **Ads declaration** → "No, my app does not contain ads".

7. **Government app declaration** → "No".

8. **COVID-19 contact tracing** → "No".

---

## 4. If something goes wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| `cap add ios` fails with CocoaPods error | Old CocoaPods version | `sudo gem install cocoapods` |
| Xcode "Failed to register bundle ID" | Bundle ID already registered to a different team | Apple Developer Portal -> Certificates, IDs & Profiles -> Identifiers -> verify `com.advottic.app` belongs to your team |
| Apple rejects: "minimum functionality" | Demo account can't show native plugin use | Re-record a screen capture of Face ID enrollment + camera capture; reply via Resolution Center with the screen recording attached |
| Apple rejects: "no privacy manifest" | `PrivacyInfo.xcprivacy` missing from bundle | Xcode -> Build Phases -> Copy Bundle Resources -> add it from `node_modules/@capacitor/ios/Capacitor/Capacitor/PrivacyInfo.xcprivacy` |
| Play Console: "AAB uses debuggable manifest" | `android:debuggable="true"` in AndroidManifest.xml | `android/app/src/main/AndroidManifest.xml` -> ensure no `android:debuggable` attribute. Capacitor's release variant strips it automatically; if it persists, set `buildTypes.release.debuggable = false` in build.gradle. |
| Play Console: "Missing default language" | Listing not finished | Play Console -> Main store listing -> set Default language = English (US) and fill all required fields |
| TestFlight build never appears | Processing > 24h | App Store Connect -> Activity -> click the failing build for the actual rejection reason (usually a missing entitlement or rejected binary) |

---

## 5. After both stores accept

1. Update `capacitor.config.ts` if any submission-driven changes were
   needed (Info.plist strings, etc.). Commit + push.
2. Bump `versionCode` (Android) and `CFBundleVersion` (iOS) for the
   NEXT release. Convention: versionCode increments by 1; versionName
   = semver of the website at deploy time.
3. Tag the release: `git tag v1.0.4 && git push --tags`.
4. Update `docs/MOBILE.md` "Version posture" table with the
   submission date + store URLs.

---

## Quick reference

| Artifact | Path |
|---|---|
| Android signed AAB | `android/app/build/outputs/bundle/release/app-release.aab` |
| iOS archive | Xcode → Window → Organizer → Archives |
| Android keystore | `android/app/advottic-release.keystore` (gitignored) |
| Android keystore passwords | `android/keystore.properties` (gitignored) |
| iOS signing | Apple ID account in Xcode → Settings → Accounts |
| Privacy strings | `capacitor.config.ts` → `ios.infoPlist` |
| Android version | `android/app/build.gradle` → `versionCode`, `versionName` |
| iOS version | Xcode → App target → General → Version + Build |
