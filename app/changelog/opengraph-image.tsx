import { renderOgImage } from '@/lib/og-image';
import { CHANGELOG } from '@/lib/changelog';

export const runtime = 'edge';
export const alt = 'Advottic changelog - what we have shipped, in chronological order';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  // Lead with the most-recent shipped headline so the OG image
  // refreshes itself every time a new changelog entry lands.
  const latest = CHANGELOG[0];
  return renderOgImage({
    title: "What we've shipped.",
    subtitle: latest
      ? `Latest: ${latest.title}. ${CHANGELOG.length} updates and counting. Subscribe via RSS or Atom.`
      : 'Personal-safety features, AI updates, firm-side launches. Subscribe via RSS or Atom.',
    eyebrow: 'ADVOTTIC CHANGELOG',
  });
}
