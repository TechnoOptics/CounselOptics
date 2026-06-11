import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor configuration for the Advottic native shells (iOS + Android).
 *
 * The app is a "remote-URL" Capacitor wrapper: instead of bundling a
 * statically-exported copy of the Next.js site (which we can't, since the
 * app uses server components, server actions, and dynamic API routes),
 * the native shell loads the live website inside a webview. The shell
 * itself remains tiny - we ship signed app-store binaries that wrap
 * advottic.com with native-only sugar (camera plugin, push notifications,
 * biometrics, file picker).
 *
 * Version posture (2026-05-14):
 *
 *   - Capacitor 8.3.4 across core / cli / android / ios (latest stable)
 *   - Android compileSdkVersion + targetSdkVersion = 36 (Android 16,
 *     the current Google Play maximum) - see android/variables.gradle
 *   - Android minSdkVersion = 24 (Android 7.0) - matches Capacitor 8's
 *     official floor and covers ~99% of active Android devices
 *   - iOS deployment target = 14.0 (Capacitor 8's official floor;
 *     iOS 14 covers every iPhone shipped since iPhone 6s, ~99% of
 *     active iOS devices)
 *   - Android Gradle Plugin = 8.13.0 - matches the toolchain that
 *     ships with Capacitor 8.3.x
 *
 * Build prerequisites are documented in docs/MOBILE.md.
 */
const config: CapacitorConfig = {
  appId: 'com.advottic.app',
  appName: 'Advottic',
  // webDir is required by the CLI but unused at runtime when server.url
  // is set. It used to point at '.next', which made `cap sync` copy the
  // ENTIRE Next.js build output (~589 MB raw, ~130 MB compressed) into
  // every APK/AAB/IPA as dead weight the remote-URL WebView never reads.
  // capacitor-shell/ is a single branded fallback page instead; shipping
  // only it cuts the Android app from ~137 MB to single-digit MB.
  webDir: 'capacitor-shell',
  server: {
    url: 'https://advottic.com',
    cleartext: false,
    androidScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0F2D24',
    // iOS deployment target = 14.0 (Capacitor 8's published minimum).
    // Not a CapacitorConfig field - it's set inside the generated
    // Xcode project:
    //   - Podfile:        `platform :ios, '14.0'`
    //   - project.pbxproj `IPHONEOS_DEPLOYMENT_TARGET = 14.0`
    // Both default to 14.0 when `cap add ios` runs against Capacitor
    // 8.3.x, so a fresh shell gets the right floor automatically.
    // After regeneration, verify the two lines above match and bump
    // the App Store submission's "minimum OS" field to match.
    // iOS 14 covers every iPhone 6s and newer (shipped since 2015),
    // which is the right floor for a legal-tech app: older devices
    // are out of their security-patch window anyway.
    //
    // -------------------------------------------------------------
    // Info.plist privacy strings (NSFaceIDUsageDescription,
    // NSMicrophoneUsageDescription, NSSpeechRecognitionUsageDescription,
    // NSCameraUsageDescription, NSPhotoLibraryUsageDescription,
    // NSPhotoLibraryAddUsageDescription, NSUserTrackingUsageDescription)
    // are intentionally NOT set here.
    //
    // `infoPlist` is NOT a CapacitorConfig field. Capacitor 8's typed
    // config has no such key, so putting it here did two bad things:
    //   (a) it was silently ignored by `cap sync` - the strings never
    //       reached the signed binary, so builds 6/7 shipped to
    //       TestFlight WITHOUT them (latent App Review 5.1.1 reject +
    //       runtime crash on first camera/mic/Face ID call), and
    //   (b) it failed `next build` type-checking
    //       ("'infoPlist' does not exist in type ..."), which silently
    //       broke EVERY Vercel deploy from commit 8da8b43 onward -
    //       the audit fixes at 1f4590f were the last thing actually
    //       live in production.
    //
    // The strings are now injected straight into
    // ios/App/App/Info.plist by the "Patch Info.plist" step in
    // .github/workflows/ios-release.yml (PlistBuddy) - the only place
    // they take effect in the signed binary. Add new plugin
    // disclosures there, not here.
    // -------------------------------------------------------------
  },
  android: {
    backgroundColor: '#0F2D24',
    allowMixedContent: false,
    // minSdkVersion + targetSdkVersion live in android/variables.gradle
    // (Capacitor reads them at native build time, not from this config).
    // Keep them at 24 / 36 respectively - documented above. Both align
    // with the current Google Play submission window.
    //
    // Edge-to-edge note (v1.0.14). targetSdk 36 means Android 15+
    // FORCES edge-to-edge: the WebView draws behind the status bar.
    // Capacitor 8's built-in SystemBars plugin (auto-registered in
    // Bridge.java) handles the insets - it either passes window
    // insets through so env(safe-area-inset-*) resolves, or injects
    // --safe-area-inset-* CSS variables onto <html>. The web app
    // consumes BOTH via the --safe-* tokens in app/globals.css, so
    // the header starts below the status bar on every combination
    // of OS + WebView version. Do not add adjustMarginsForEdgeToEdge
    // here - that was the Capacitor 7.1 mechanism and does not exist
    // in Capacitor 8.
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#0F2D24',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    // Capacitor 8 replaced the standalone @capacitor/status-bar
    // plugin with a built-in SystemBars core plugin (the old
    // `StatusBar` config key here was dead - the plugin was never
    // installed). style DARK = dark bars = WHITE status-bar icons,
    // which is what the forest-950 header needs; the default
    // (DEFAULT) follows the SYSTEM light/dark theme, so a light-mode
    // phone got near-invisible dark icons on our dark green strip.
    SystemBars: {
      style: 'DARK',
    },
  },
};

export default config;
