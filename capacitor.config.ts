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
  },
  android: {
    backgroundColor: '#0F2D24',
    allowMixedContent: false,
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
