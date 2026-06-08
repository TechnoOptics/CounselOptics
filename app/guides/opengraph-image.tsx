import { renderOgImage } from '@/lib/og-image';

export const runtime = 'edge';
export const alt = 'Advottic legal-prep guides - plain-English answers';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage({
    title: 'Specific questions, plain-English answers.',
    subtitle:
      "What to do when you're served, evicted, sued for debt, or in danger. Calm checklists with the right hotlines.",
    eyebrow: 'ADVOTTIC GUIDES',
  });
}
