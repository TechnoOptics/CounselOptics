'use client';

/**
 * Listens for Supabase token rotations and keeps the biometric
 * -gated refresh token in sync. Without this, the first time
 * Supabase rotates the refresh token (which it does on every
 * refresh), our stored copy goes stale and the next biometric
 * unlock fails with "invalid refresh token."
 *
 * No-op on web. Mounted once high in the tree (root layout) so
 * it stays alive across navigation but doesn't double-register
 * its listener.
 */

import { useEffect } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
import {
  enrollBiometric,
  isBiometricEnrolled,
  isNativeShell,
} from '@/lib/biometric';

export function BiometricSessionSync() {
  useEffect(() => {
    if (!isNativeShell()) return;
    const supabase = createBrowserSupabase();
    const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event !== 'TOKEN_REFRESHED' && event !== 'SIGNED_IN') return;
      if (!session?.refresh_token || !session.user.email) return;
      // Only update storage if the user has already opted in to
      // biometric sign-in. We don't want this listener to silently
      // enroll someone who never asked - the dedicated enroll prompt
      // handles first-time consent.
      const enrolled = await isBiometricEnrolled();
      if (!enrolled) return;
      await enrollBiometric({
        refreshToken: session.refresh_token,
        email: session.user.email,
      });
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
