import { renderOgImage } from '@/lib/og-image';

export const runtime = 'edge';
export const alt = 'Advottic pricing - Free, $19/mo personal, $59/seat/mo firms';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage({
    title: 'Built on a foundation lawyers can defend.',
    subtitle:
      'Free tier. Personal plans from $19/mo. Firm plans from $59/seat/mo. 20% annual prepay discount. Cancel any time.',
    eyebrow: 'ADVOTTIC PRICING',
  });
}
