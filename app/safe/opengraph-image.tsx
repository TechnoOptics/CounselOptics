import { renderOgImage } from '@/lib/og-image';

export const runtime = 'edge';
export const alt = 'Safe Witness - personal-safety alerting on Advottic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage({
    title: 'Press, hold, send.',
    subtitle:
      'Safe Witness fires a one-time SMS + email + live tracker to your trusted contacts when you hold the button for four seconds.',
    eyebrow: 'ADVOTTIC SAFE WITNESS',
  });
}
