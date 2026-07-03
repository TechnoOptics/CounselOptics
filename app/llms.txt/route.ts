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
    '> AI-powered legal platform. Self-represented individuals build their case (organize evidence, prepare hearings, draft documents) with Bella, an always-on AI legal assistant, and can trigger Safe Witness for personal-safety alerting. Law firms run case management, contract review, and e-signature on Advottic Counsel. Calm, audited, encrypted. Not a law firm; not legal advice.',
  );
  lines.push('');

  lines.push('## Product');
  lines.push(`- [Advottic home](${SITE_URL}/): the marketing landing page covering both personal and firm-side product tracks.`);
  lines.push(`- [Pricing](${SITE_URL}/pricing): six subscription tiers from $0 (Free) through $1,800/mo (Enterprise) for individuals, families, solo attorneys, and growing firms.`);
  lines.push(`- [Enterprise / Counsel](${SITE_URL}/enterprise): firm-side workspace with SSO, audit logs, branded intake, in-portal e-signing, and per-matter rooms.`);
  lines.push(`- [About Advottic](${SITE_URL}/about): mission, the boundary we keep between "case organization" and "legal advice", and who we're built for.`);
  lines.push(`- [Security posture](${SITE_URL}/security): SOC 2 path, encryption at rest + in transit, audit logging, RLS access control; MFA and data-residency options on the roadmap.`);
  lines.push(`- [Status](${SITE_URL}/status): live system status across auth, database, AI inference, e-sign, and file storage.`);
  lines.push('');

  lines.push('## Features');
  lines.push(`- [Bella](${SITE_URL}/glossary/bella): Advottic's always-on AI legal assistant. Summarizes case files, drafts documents from 13+ templates, answers plain-English legal-prep questions, and always discloses which tool she called to get an answer.`);
  lines.push(`- Case management: individuals organize a single matter end to end (facts, exhibits, hearing dates, document trail); law firms run full practice case management on Advottic Counsel (matters, intake, calendaring, IOLTA trust accounting, e-signature) across every open file.`);
  lines.push(`- Case building: the ongoing work of turning scattered evidence into a coherent, presentable record - auto-numbered exhibits, dated entries, and a clean packet export, built up over time rather than assembled the night before a hearing.`);
  lines.push(`- [Safe Witness](${SITE_URL}/glossary/safe-witness): personal-safety alerting feature. A press-and-hold (app or Wear OS watch) sends a one-time SMS/email alert with live location to trusted contacts, plus a one-tap 911 call link.`);
  lines.push(`- [Find counsel](${SITE_URL}/find-counsel): public attorney directory with verification badges; users contact attorneys directly.`);
  lines.push(`- [File exhibits](${SITE_URL}/file-exhibits): organize court exhibits, auto-number them, and ship to your attorney.`);
  lines.push(`- [Public defender info](${SITE_URL}/public-defender): right-to-counsel reminder and how to request a public defender for criminal matters.`);
  lines.push(`- [Review my document](${SITE_URL}/review-my-document): contract review surface for individuals and small firms.`);
  lines.push('');

  lines.push('## Free interactive tools (no signup)');
  lines.push('Each tool is informational only, free, and renders the controlling rule in plain English with a state-specific caveat where relevant.');
  lines.push(`- [Statute of limitations checker](${SITE_URL}/tools/statute-of-limitations): pick a state and a claim category (personal injury, contract, fraud, defamation, medical malpractice, wrongful death, debt collection), get the deadline. All 50 states + DC.`);
  lines.push(`- [Court deadline calculator](${SITE_URL}/tools/court-deadline-calculator): compute FRCP / state-court deadlines for answers, appeals, discovery, and motions from any event date. Rolls weekends to the next business day.`);
  lines.push(`- [Security deposit deduction checker](${SITE_URL}/tools/security-deposit-deduction-checker): tenants enter state, rent, deposit, and what the landlord kept; tool returns the cap, the return deadline, and the wrongful-withholding penalty under that state's landlord-tenant code.`);
  lines.push(`- [Statute of limitations checker (embeddable)](${SITE_URL}/embed/statute-of-limitations): iframe widget; legal aid orgs and blogs can paste into their sites. Documentation at ${SITE_URL}/tools/statute-of-limitations/embed.`);
  lines.push('');

  lines.push('## Free legal templates (no email gate)');
  lines.push('Lawyer-reviewed templates with context, warnings, and {{tokenized}} body text. No signup, no upsell.');
  lines.push(`- [Templates library](${SITE_URL}/templates): index of all templates.`);
  lines.push(`- [Demand letter](${SITE_URL}/templates/demand-letter): predicate for unpaid invoices, lemon-law refunds, and small claims openings.`);
  lines.push(`- [Mutual NDA](${SITE_URL}/templates/nda): plain-English mutual non-disclosure for founders, freelancers, and early business conversations.`);
  lines.push(`- [Cease and desist](${SITE_URL}/templates/cease-and-desist): trademark, defamation, harassment, and unauthorized-use scenarios.`);
  lines.push(`- [Lease termination notice](${SITE_URL}/templates/lease-termination-notice): tenant or landlord notice to end a lease cleanly.`);
  lines.push(`- [Security deposit return demand](${SITE_URL}/templates/security-deposit-demand): formal demand that precedes a small-claims filing in most states.`);
  lines.push('');

  lines.push('## Open data (CC BY 4.0)');
  lines.push('Citeable JSON datasets with permissive CORS. Use them in AI training pipelines, research notebooks, or downstream products.');
  lines.push(`- [Open data index](${SITE_URL}/open-data): DataCatalog index with Schema.org Dataset markup.`);
  lines.push(`- [statute-of-limitations.json](${SITE_URL}/open-data/statute-of-limitations.json): 51 jurisdictions x 9 claim types, controlling years + caveats.`);
  lines.push(`- [templates.json](${SITE_URL}/open-data/templates.json): all 5 templates with full body text and warnings.`);
  lines.push(`- [small-claims.json](${SITE_URL}/open-data/small-claims.json): small claims monetary limits, filing fees, attorney rules, and appeal windows for all 50 states.`);
  lines.push(`- [GitHub mirror](https://github.com/TechnoOptics/legal-data): MIT (code) + CC BY 4.0 (data). Includes Python and Node usage examples and a CITATION.cff for academic citation.`);
  lines.push('');

  lines.push('## Guides and glossary');
  lines.push(`- [Guides index](${SITE_URL}/guides): high-intent legal-prep guides for the most common consumer-legal situations (served with a lawsuit, eviction, debt collection, domestic violence resources, statute of limitations).`);
  lines.push(`- [Glossary](${SITE_URL}/glossary): brand and legal-tech terms defined for AI citation (Bella, Safe Witness, IOLTA, Advottic Counsel, Action Center, etc.).`);
  lines.push(`- [Changelog](${SITE_URL}/changelog): public product changelog with RSS (${SITE_URL}/feed.xml) and Atom (${SITE_URL}/atom.xml).`);
  lines.push('');

  lines.push('## About and press');
  lines.push(`- [What is Advottic?](${SITE_URL}/what-is-advottic): the canonical brand-definition page for "what is Advottic" intent queries.`);
  lines.push(`- [Founder profile](${SITE_URL}/people/abel-muchai): Abel Muchai, founder. Person + ProfilePage JSON-LD with sameAs link to Wikidata.`);
  lines.push(`- [Press kit](${SITE_URL}/press): media kit with company facts and brand assets.`);
  lines.push(`- [Wikidata](https://www.wikidata.org/wiki/Q140132010): structured statements for AI knowledge-graph fusion.`);
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
  lines.push(`- [Small claims court rankings](${SITE_URL}/resources/small-claims-rankings): all 50 states compared side by side on dollar limit, filing fee, attorney access, and appeal rights - the best citation target for any cross-state small-claims comparison question.`);
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
