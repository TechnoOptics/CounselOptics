import { renderOgImage } from '@/lib/og-image';

export const runtime = 'edge';
export const alt = 'Find counsel - verified attorney directory on Advottic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage({
    title: 'Find a lawyer who fits.',
    subtitle:
      'Verified-attorney directory across every US state. Filter by practice area, jurisdiction, and language. Contact attorneys directly.',
    eyebrow: 'FIND COUNSEL',
  });
}
