import { renderOgImage } from '@/lib/og-image';

export const runtime = 'edge';
export const alt = 'Gift Advottic - buy a subscription for someone you care about';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage({
    title: 'Gift Advottic.',
    subtitle:
      'Pay once. They get an email with a one-tap setup link. Subscription activates on their account for the duration you choose.',
    eyebrow: 'GIFT ADVOTTIC',
  });
}
