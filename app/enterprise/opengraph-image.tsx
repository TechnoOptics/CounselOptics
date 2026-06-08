import { renderOgImage } from '@/lib/og-image';

export const runtime = 'edge';
export const alt = 'Advottic Counsel - practice management for law firms';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage({
    title: 'Run your firm on Advottic.',
    subtitle:
      'Matter management, IOLTA trust accounting, contract review, e-signature, custom firm subdomain, SAML SSO. From $59/seat/month.',
    eyebrow: 'ADVOTTIC COUNSEL',
  });
}
