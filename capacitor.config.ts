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
    //
    // -------------------------------------------------------------
    // Info.plist privacy strings for native plugin usage.
    //
    // iOS enforces NSXxxUsageDescription strings at first call into
    // each protected API. If a string is missing when the plugin
    // first runs, the app crashes silently with a hidden
    // EXC_BAD_ACCESS in the system console - reviewer will catch
    // this on first launch and reject the submission.
    //
    // Capacitor copies the strings below into the generated
    // ios/App/App/Info.plist on `npx cap sync ios`. They must be
    // first-person, action-oriented, and explain WHY in a sentence
    // a reviewer reading App Review Guideline 5.1.1 (Data
    // Collection and Storage) would not flag for over-collection.
    //
    // The four plugins below are the ones actually used in the
    // current build:
    //   - @aparajita/capacitor-biometric-auth (lib/biometric.ts)
    //   - @capacitor/camera + @capacitor/filesystem (planned)
    //   - @capacitor-community/speech-recognition
    //     (components/VoiceDictateButton.tsx)
    //   - @capacitor/device (lib/device-fingerprint.ts)
    //
    // If we add @capacitor/push-notifications, @capacitor/geolocation,
    // or @capacitor/local-notifications later, add the matching
    // entries here and bump the App Store submission with the
    // updated privacy disclosures.
    // -------------------------------------------------------------
    infoPlist: {
      // Face ID / Touch ID (biometric sign-in)
      NSFaceIDUsageDescription:
        "Use Face ID to sign in to Advottic without typing your email each time. Your biometric data never leaves this device.",
      // Microphone (voice dictation when composing a case)
      NSMicrophoneUsageDescription:
        "Use the microphone to dictate case notes. Audio is transcribed on-device by iOS and never uploaded.",
      // Speech recognition (paired with microphone; iOS treats it as a separate disclosure)
      NSSpeechRecognitionUsageDescription:
        "Convert your spoken notes to text so you can add them to a case file. Recognition runs on-device when possible.",
      // Camera (capture documents, citations, exhibits)
      NSCameraUsageDescription:
        "Photograph documents, citations, and exhibits to add them directly to your case file. Photos stay private to your account.",
      // Photo library read (pick existing exhibits from camera roll)
      NSPhotoLibraryUsageDescription:
        "Attach existing photos as case exhibits. Advottic only reads the photos you explicitly choose.",
      // Photo library write (save the executed PDF packet back to camera roll)
      NSPhotoLibraryAddUsageDescription:
        "Save your case packet PDF to your photo library so you can share or print it.",
      // App Tracking Transparency: we do NOT track. Apple still
      // wants a string in case a future plugin ever asks.
      NSUserTrackingUsageDescription:
        "Advottic does not track you across other apps and websites and never will. This permission is reserved for future use.",
    },
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
