'use client';

import {
  uploadFirmLetterheadAction,
  removeFirmLetterheadAction,
} from '@/lib/firm-actions';
import { FirmBrandingImageUploader } from '@/components/FirmBrandingImageUploader';
import { useT } from '@/components/i18n/LocaleProvider';

/**
 * Upload the firm's letterhead - the wide horizontal image that gets
 * painted across the top of any PDF Bella renders for the firm
 * (return address, partners, bar IDs, etc). Separate from the small
 * sidebar logo: that one's a square mark, this one is a full-width
 * stationery strip.
 *
 * Uploads land in the existing public firm-branding bucket. PDFs
 * fetch the URL from firms.letterhead_url at render time, so
 * changes show up on the very next document without a redeploy.
 */
export function LetterheadUploader({
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
      fieldName="letterhead"
      uploadAction={uploadFirmLetterheadAction}
      removeAction={removeFirmLetterheadAction}
      accept="image/png,image/jpeg,image/webp"
      sizeLabel={t(
        'PNG, JPG, or WebP - max 8 MB; painted across the top of PDFs Bella renders',
      )}
      label={t('Letterhead')}
      alt={t('Firm letterhead')}
      emptyLabel={t('No letterhead - PDFs will use a text-only banner')}
      variant="wide"
    />
  );
}
