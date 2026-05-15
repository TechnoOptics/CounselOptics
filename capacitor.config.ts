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
  // is set. Keep it pointing at .next/build artifacts so `npx cap sync`
  // doesn't complain.
  webDir: '.next',
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
  },
  android: {
    backgroundColor: '#0F2D24',
    allowMixedContent: false,
    // minSdkVersion + targetSdkVersion live in android/variables.gradle
    // (Capacitor reads them at native build time, not from this config).
    // Keep them at 24 / 36 respectively - documented above. Both align
    // with the current Google Play submission window.
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
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0F2D24',
    },
  },
};

export default config;
