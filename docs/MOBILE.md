# Mobile builds: Advottic for iOS and Android

Two layers ship together. **The PWA layer is already live**: anyone with iOS 16+ Safari or Android Chrome can already install Advottic from `advottic.com` to their home screen. **The native layer (Capacitor)** wraps the live site in signed App Store / Play Store binaries.

---

## Layer 1: PWA (already deployed)

What's wired in the website itself:

- `public/manifest.webmanifest`: installable metadata, three home-screen shortcuts (New case · All cases · Find counsel)
- `public/sw.js`: minimal service worker; caches brand assets + Next.js immutable build chunks; never caches HTML or `/api`
- `app/layout.tsx`: Apple-touch-icon meta, `apple-mobile-web-app-capable`, `theme-color`, `viewport-fit=cover`, SW registration
- `app/globals.css`: `env(safe-area-inset-*)` padding so the layout respects iOS notch + home indicator
- `app/icon.png`, `app/apple-icon.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/apple-icon.png`: green-BG branded tiles
- `public/advottic-tile.png`: same artwork the iOS/Android home screen icon uses; also used in the website header

To install:
- **iOS Safari** → Share → "Add to Home Screen"
- **Android Chrome** → menu → "Install app" / "Add to home screen"

---

## Layer 2: Capacitor, App Store + Play Store

This requires a Mac (for iOS), Xcode 15+, and Android Studio. You can do Android-only on Windows/Linux.

### Version posture (verified 2026-05-14)

| Layer                       | Version       | Notes                                                                 |
| --------------------------- | ------------- | --------------------------------------------------------------------- |
| `@capacitor/core`           | **8.3.4**     | Latest stable Capacitor 8.x; `^8.3.4` pinned in `package.json`.     |
| `@capacitor/cli`            | **8.3.4**     | Matched to core. Runs `cap sync`, `cap add ios`, etc.                 |
| `@capacitor/android`        | **8.3.4**     | Android shell library; pulls AGP 8.13.0 + Gradle 8.x.                 |
| `@capacitor/ios`            | **8.3.4**     | iOS shell library; pulls Swift 5.9 toolchain.                         |
| `@capacitor/app`            | **8.1.0**     | Deep-link + lifecycle bridge.                                         |
| `@capacitor/browser`        | **8.0.3**     | In-app browser for OAuth redirect flow.                               |
| `@capacitor/device`         | **8.0.2**     | Stable device fingerprint helper.                                     |
| `@capacitor/preferences`    | **8.0.1**     | Native key-value storage backing the biometric refresh token.         |
| Android `compileSdkVersion` | **36**        | Android 16, the current Google Play maximum. Lives in `android/variables.gradle`. |
| Android `targetSdkVersion`  | **36**        | Same.                                                                  |
| Android `minSdkVersion`     | **24**        | Android 7.0, Capacitor 8's floor, covers ~99% of active devices.   |
| iOS deployment target       | **14.0**      | Set in `capacitor.config.ts` (`ios.minVersion`). Capacitor 8's floor; iPhone 6s and newer. |
| Android Gradle Plugin       | **8.13.0**    | Pinned in `android/build.gradle`. Matches the toolchain that ships with Capacitor 8.3.x. |

To re-verify after a dependency bump:

```sh
# Check published versions against package.json
for pkg in @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios \
          @capacitor/app @capacitor/browser @capacitor/device @capacitor/preferences; do
  printf "%-32s " "$pkg"
  npm view "$pkg" version
done
```

### What changed 2026-05-14

- Bumped `@capacitor/core / cli / android / ios` from `^8.3.1` to `^8.3.4` (patches only, no breaking changes).
- Bumped `@capacitor/app` to `^8.1.0`, `@capacitor/browser` to `^8.0.3` (also patches).
- Added an explicit `ios.minVersion: '14.0'` to `capacitor.config.ts` so a fresh `cap add ios` regenerates the Xcode project with the right deployment-target baseline. iOS 14 is Capacitor 8's published minimum.
- All Capacitor plugin imports in `lib/biometric.ts`, `lib/device-fingerprint.ts`, and `app/sign-in/sign-in-buttons.tsx` are loaded dynamically inside functions (not statically at module top). This protects the SSR pass from native-only module side effects. See React #419 fix in audit W20 V3.

### One-time setup

```sh
# From the repo root
npm install --save-dev @capacitor/cli
npm install --save @capacitor/core @capacitor/ios @capacitor/android

# capacitor.config.ts already exists in the repo - this picks it up
npx cap add ios       # creates ./ios native project (Mac only)
npx cap add android   # creates ./android native project
```

After `cap add`, two new directories appear (`ios/` and `android/`). Both are platform-specific Xcode/Gradle projects you commit to git, but they're large, so consider a separate branch or a `.gitignore` carve-out for build artifacts only.

### Each time you change `capacitor.config.ts`

```sh
npx cap sync
```

### Day-to-day: open the native project

```sh
npx cap open ios       # opens Xcode
npx cap open android   # opens Android Studio
```

Build / archive / sign / upload happens inside those IDEs.

### Why "remote-URL" instead of bundled?

`capacitor.config.ts` sets `server.url` to `https://advottic.com`. The Capacitor webview loads the live site, so:

- **No static export needed.** Next.js server components, server actions, AI routes and Stripe webhooks all keep working, because they run on the same Vercel deploy that the website uses.
- **No app-store submission for content updates.** Push to `main`, Vercel deploys, the in-app webview picks up the change on next load.
- **App Review only sees a thin shell.** We submit when the wrapper itself changes (new plugin, new permission, new icon).

### Native plugins worth adding later

| Plugin | Why |
|---|---|
| `@capacitor/camera` | Capture tickets/citations directly into a case (you already have auto-scan). |
| `@capacitor/filesystem` | Save the exported PDF case packet to Files / Downloads. |
| `@capacitor/push-notifications` | Hearing-day reminders from the server. |
| `@capacitor/local-notifications` | Hearing reminders without round-tripping to a server. |
| `@capacitor/share` | Native share sheet for the case packet PDF. |
| `@capacitor-community/biometric-auth` | Face ID / fingerprint to re-unlock the app between launches. |

Each plugin is `npm install` + `npx cap sync` + a small JS bridge in the website code (guarded by `Capacitor.isNativePlatform()`).

### App-store metadata

- **Bundle ID**: `com.advottic.app` (set in `capacitor.config.ts`)
- **App name**: `Advottic`
- **Splash screen + icons**: generated from `public/advottic-mark.png`. After `cap add`, run `npx capacitor-assets generate` to push them into the iOS / Android projects.
- **Privacy policy URL**: `https://advottic.com/privacy`. Apple and Google both require this.
- **Permissions you'll need to declare** (only when adding the corresponding plugin): camera, photo library, microphone (audio uploads), notifications, biometrics.

### Apple Developer Program

You need a paid Apple Developer account ($99/year). After enrollment, in Xcode:

1. Signing & Capabilities → select your team
2. Product → Archive → upload to App Store Connect
3. App Store Connect → fill out store listing → submit for review

### Google Play Console

Google Play Console requires a one-time $25 developer fee. From Android Studio:

1. Build → Generate Signed Bundle/APK → Android App Bundle → sign
2. Upload `.aab` to Play Console
3. Fill listing → submit for review

### Going further

If you ever want a thicker native experience (offline-first, deep platform integrations, native UI), the migration path from a Capacitor remote-URL wrapper to a Capacitor bundled app or a React Native rewrite is well-trodden, but most teams are happy stopping at the wrapper.
