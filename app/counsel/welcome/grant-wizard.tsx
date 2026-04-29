'use client';

import type { FirmType } from '@/lib/firm-types';
import { OnboardingWizard } from '../onboarding/onboarding-wizard';

/**
 * Thin client wrapper that hands the grant token + grant-derived
 * pre-fills to the shared OnboardingWizard. Keeps the welcome page
 * a server component while letting the wizard remain a client one.
 */
export function GrantOnboardingWizard({
  grantToken,
  defaultName,
  defaultEmail,
  defaultFirmType,
}: {
  grantToken: string;
  defaultName: string;
  defaultEmail: string | null;
  defaultFirmType: FirmType;
}) {
  return (
    <OnboardingWizard
      defaultName={defaultName}
      defaultEmail={defaultEmail}
      defaultFirmType={defaultFirmType}
      grantToken={grantToken}
    />
  );
}
