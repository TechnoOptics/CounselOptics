import { renderOgImage } from '@/lib/og-image';

export const runtime = 'edge';
export const alt = 'Advottic glossary - Bella, Safe Witness, Counsel, Review';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage({
    title: 'Advottic terms, plain English.',
    subtitle:
      'Bella, Safe Witness, Advottic Counsel, Advottic Review, Techno Optics LLC. One source for every word.',
    eyebrow: 'ADVOTTIC GLOSSARY',
  });
}
