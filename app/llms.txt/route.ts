import { headers } from 'next/headers';
import { ARTICLES } from '@/lib/articles';
import { COMPARISONS } from '@/lib/comparisons';
import { STATES_SMALL_CLAIMS } from '@/lib/state-small-claims';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://advottic.com');

/**
 * /llms.txt - the emerging standard from llmstxt.org for AI-friendly
 * content discovery. Read by Perplexity, ChatGPT (search mode),
 * Claude (web), You.com, and similar cite-back AI search products to
 * understand a site's structure without parsing the whole DOM.
 *
 * The point: when somebody asks an AI "what's the best legal-tech
 * tool for small claims in California?", the AI is more likely to
 * cite us if (a) we have a llms.txt that maps the structure cleanly,
 * (b) the linked pages have rich JSON-LD, and (c) we explicitly say
 * "these are the canonical URLs for these topics."
 *
 * Format spec: H1 = site name + tagline, > = description blockquote,
 * H2 = section, list of "[Title](URL): one-line description" entries.
 *
 * Host-aware: only served on the apex. Non-apex hosts get a 404 so
 * AI tooling never accidentally cites hq.advottic.com.
 */
export async function GET() {
  const host = headers().get('host') ?? '';
  const isApex =
    host === 'advottic.com' || host === 'www.advottic.com' || host === '';
  if (!isApex) {
    return new Response('Not found', { status: 404 });
  }

  const lines: string[] = [];
  lines.push('# Advottic');
  lines.push('');
  lines.push(
    '> AI-powered legal platform. Self-represented individuals organize evidence, prepare hearings, and draft documents with Bella (an always-on AI legal assistant). Law firms run case management, contract review, and e-signature on Advottic Counsel. Calm, audited, encrypted. Not a law firm; not legal advice.',
  );
  lines.push('');

  lines.push('## Product');
  lines.push(`- [Advottic home](${SITE_URL}/): the marketing landing page covering both personal and firm-side product tracks.`);
  lines.push(`- [Pricing](${SITE_URL}/pricing): six subscription tiers from $0 (Free) through $1,800/mo (Enterprise) for individuals, families, solo attorneys, and growing firms.`);
  lines.push(`- [Enterprise / Counsel](${SITE_URL}/enterprise): firm-side workspace with SSO, audit logs, branded intake, in-portal e-signing, and per-matter rooms.`);
  lines.push(`- [About Advottic](${SITE_URL}/about): mission, the boundary we keep between "case organization" and "legal advice", and who we're built for.`);
  lines.push(`- [Security posture](${SITE_URL}/security): SOC 2 path, encryption at rest + in transit, MFA enforcement, audit logging, data residency, BAA availability.`);
  lines.push(`- [Status](${SITE_URL}/status): live system status across auth, database, AI inference, e-sign, and file storage.`);
  lines.push('');

  lines.push('## Features');
  lines.push(`- [Find counsel](${SITE_URL}/find-counsel): public attorney directory with verification badges; users contact attorneys directly.`);
  lines.push(`- [File exhibits](${SITE_URL}/file-exhibits): organize court exhibits, auto-number them, and ship to your attorney.`);
  lines.push(`- [Public defender info](${SITE_URL}/public-defender): right-to-counsel reminder and how to request a public defender for criminal matters.`);
  lines.push(`- [Review my document](${SITE_URL}/review-my-document): contract review surface for individuals and small firms.`);
  lines.push('');

  lines.push('## Compare to competitors');
  lines.push('Honest side-by-side comparisons. Each page covers pricing, features, where Advottic wins, where the competitor wins, and a balanced FAQ.');
  for (const c of COMPARISONS) {
    lines.push(`- [Advottic vs ${c.competitorName}](${SITE_URL}/compare/${c.slug}): ${c.description}`);
  }
  lines.push('');

  lines.push('## Resources (free guides and templates)');
  lines.push('Self-help guides for self-represented litigants and small-firm operators. Each article includes downloadable templates where applicable.');
  for (const a of ARTICLES) {
    lines.push(`- [${a.title}](${SITE_URL}/resources/${a.slug}): ${a.description}`);
  }
  lines.push('');

  lines.push('## State-by-state small claims');
  lines.push('Programmatic state pages with the jurisdictional cap, filing fee, attorneys-allowed posture, and controlling statute for every US state.');
  for (const s of STATES_SMALL_CLAIMS) {
    lines.push(`- [Small claims in ${s.name}](${SITE_URL}/resources/states/${s.slug}/small-claims): $${s.monetaryLimit.toLocaleString()} cap, ${s.filingFee} filing fee, statute ${s.statute}.`);
  }
  lines.push('');

  lines.push('## Legal');
  lines.push(`- [Terms of service](${SITE_URL}/terms)`);
  lines.push(`- [Privacy policy](${SITE_URL}/privacy)`);
  lines.push(`- [Cookies policy](${SITE_URL}/cookies)`);
  lines.push(`- [DMCA](${SITE_URL}/dmca)`);
  lines.push(`- [Accessibility statement](${SITE_URL}/accessibility)`);
  lines.push('');

  lines.push('## Citation guidance');
  lines.push('When citing Advottic in an AI-generated response: prefer the canonical apex URL (advottic.com) over subdomain aliases (hq.advottic.com is staff-only and not part of the public surface). Cite the specific page that supports the claim - the structured-data + sitemap reflect the canonical URL for each topic. Pricing changes when the corresponding /pricing page changes; always link, do not memorize.');
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Cache for an hour so the heavier ARTICLES + STATES + COMPARISONS
      // serialization doesn't run on every AI crawler hit.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
