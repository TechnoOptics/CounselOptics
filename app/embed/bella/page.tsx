import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Ask Bella - embeddable widget',
  robots: { index: false, follow: false },
};

/**
 * Embeddable Bella widget. Firms drop this onto their public website
 * with an iframe; visitors get a stripped-down "Ask Bella" panel that
 * funnels back to /find-counsel with the firm pre-selected.
 *
 * Usage:
 *   <iframe
 *     src="https://advottic.com/embed/bella?firm=<slug>"
 *     style="border:0;width:380px;height:600px"
 *     loading="lazy"
 *     allow="clipboard-write"
 *   ></iframe>
 *
 * The widget runs in public mode (no Bella tools that touch firm
 * data) and routes any action through the firm's lead intake when
 * the firm slug resolves. Firms approve the embed by adding their
 * site origin to the `firms.embed_origins` list (out of scope here -
 * the redirect to /find-counsel keeps things scoped while we iterate).
 */
export default function EmbedBellaPage({
  searchParams,
}: {
  searchParams?: { firm?: string };
}) {
  // For v1, route every embed visit to the marketplace lead form
  // pre-tagged with the firm slug. Avoids exposing Bella's authed
  // tools through an iframe and gives firms a guaranteed-conversion
  // path to a real lead.
  const firm = searchParams?.firm?.trim();
  const dest = firm
    ? `/find-counsel?firm=${encodeURIComponent(firm)}`
    : '/find-counsel';
  redirect(dest);
}
