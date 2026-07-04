'use client';

import { uploadFirmLogoAction, removeFirmLogoAction } from '@/lib/firm-actions';
import { FirmBrandingImageUploader } from '@/components/FirmBrandingImageUploader';
import { useT } from '@/components/i18n/LocaleProvider';

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
  const t = useT();
  return (
    <FirmBrandingImageUploader
      firmId={firmId}
      currentUrl={currentUrl}
      fieldName="logo"
      uploadAction={uploadFirmLogoAction}
      removeAction={removeFirmLogoAction}
      accept="image/png,image/jpeg,image/webp,image/svg+xml"
      sizeLabel={t('PNG, JPG, WebP, or SVG - max 3 MB')}
      label={t('Logo')}
      alt={t('Firm logo')}
      emptyLabel={t('None')}
      variant="square"
    />
  );
}
