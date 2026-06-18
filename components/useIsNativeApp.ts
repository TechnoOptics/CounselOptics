'use client';

import { useEffect, useState } from 'react';
import { getNativePlatform, type NativePlatform } from '@/lib/platform';

export type NativeAppState = {
  /** False on the server + first client paint, true once resolved. */
  ready: boolean;
  platform: NativePlatform;
  isNative: boolean;
};

/**
 * Hydration-safe "am I in the native app" hook. Always reports web on
 * the first render (so SSR and the initial client render match), then
 * resolves the real platform in an effect. Gate native-only UI on
 * `ready && isNative`, and show a web fallback on `ready && !isNative`.
 */
export function useIsNativeApp(): NativeAppState {
  const [state, setState] = useState<NativeAppState>({
    ready: false,
    platform: 'web',
    isNative: false,
  });

  useEffect(() => {
    const platform = getNativePlatform();
    setState({ ready: true, platform, isNative: platform !== 'web' });
  }, []);

  return state;
}
