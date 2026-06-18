'use client';

import type { ReactNode } from 'react';
import { useIsNativeApp } from '@/components/useIsNativeApp';

/**
 * Gate that renders its children ONLY inside the native app (iOS or
 * Android Capacitor shell). On the open web it renders `fallback`
 * (default: nothing). Use it to wrap controls that depend on device
 * hardware - biometrics, push, camera capture, background GPS, a
 * paired watch - so the website shows a "get the app" prompt instead
 * of a control that can't work there.
 *
 * Renders nothing until the platform resolves, so it never flashes a
 * native control on a web first paint or vice-versa.
 *
 * Pass `platform` to restrict further, e.g. `platform="android"` for
 * Wear OS affordances that don't exist on iOS.
 */
export function AppOnly({
  children,
  fallback = null,
  platform,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  platform?: 'ios' | 'android';
}) {
  const { ready, isNative, platform: current } = useIsNativeApp();
  if (!ready) return null;
  if (isNative && (!platform || platform === current)) return <>{children}</>;
  return <>{fallback}</>;
}
