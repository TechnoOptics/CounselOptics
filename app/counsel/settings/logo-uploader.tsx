'use client';

import { uploadFirmLogoAction, removeFirmLogoAction } from '@/lib/firm-actions';
import { FirmBrandingImageUploader } from '@/components/FirmBrandingImageUploader';

/**
 * Upload the firm's logo (PNG/JPG/WebP/SVG, <=3MB) to the public
 * firm-branding bucket and store the URL on firms.logo_url. Replaces
 * the old paste-a-URL field - admins shouldn't need a CDN.
 */
export function LogoUploader({
  firmId,
  currentUrl,
}: {
  firmId: string;
  currentUrl: string;
}) {
  return (
    <FirmBrandingImageUploader
      firmId={firmId}
      currentUrl={currentUrl}
      fieldName="logo"
      uploadAction={uploadFirmLogoAction}
      removeAction={removeFirmLogoAction}
      accept="image/png,image/jpeg,image/webp,image/svg+xml"
      sizeLabel="PNG, JPG, WebP, or SVG - max 3 MB"
      label="Logo"
      alt="Firm logo"
      emptyLabel="None"
      variant="square"
    />
  );
}
