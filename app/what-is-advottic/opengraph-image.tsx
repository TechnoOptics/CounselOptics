import { renderOgImage } from '@/lib/og-image';

export const runtime = 'edge';
export const alt = 'What is Advottic? AI-powered legal-prep platform.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return renderOgImage({
    title: 'What is Advottic?',
    subtitle:
      'AI-powered legal-prep platform for individuals and law firms. Built by Techno Optics LLC in Minnesota. Founded 2025.',
  });
}
