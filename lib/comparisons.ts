/**
 * Competitor comparison registry. Each entry powers a /compare/[slug]
 * page that targets brand-comparison keyword clusters - the highest
 * commercial intent surfaces in legal-tech SEO. People searching
 * "clio alternatives" or "spellbook vs advottic" are typically 4-8
 * weeks from a buying decision.
 *
 * Comparison-page best practice (Backlinko 2024 SERP analysis):
 *
 *   1. Hit the brand search term in the H1
 *   2. Side-by-side feature table (Google's "side-by-side" rich snippet
 *      eligibility requires structured comparison data)
 *   3. Honest, specific differentiators - "we cost less" without a
 *      number is ignored; "$59 vs $129 per user per month" gets cited
 *   4. Quote real public pricing - if the competitor's pricing isn't
 *      public, link to a recent source and date it
 *   5. Address why-not-the-other-tool ("when Clio is the right call")
 *      to build trust; honest comparison ranks better than hatchet jobs
 *
 * Add a new comparison: append to COMPARISONS below. /compare/[slug]
 * auto-renders, sitemap auto-includes, internal links auto-build.
 */

export type Comparison = {
  slug: string;
  /** Full competitor product name as it appears in their marketing. */
  competitorName: string;
  /** Parent company if different (used in copy and JSON-LD). */
  competitorCompany?: string;
  /** Short category label used in the SERP title. */
  category:
    | 'Practice management'
    | 'Contract AI'
    | 'Legal research AI'
    | 'E-signature'
    | 'Full-stack platform';
  /** ISO-8601 last-reviewed date - shown on page + dateModified in JSON-LD. */
  reviewedAt: string;
  /** 155-165 char meta description. */
  description: string;
  /** SEO keywords (primary first). */
  keywords: string[];
  /** Hook paragraph rendered just below the H1. */
  hook: string[];
  /** Side-by-side feature comparison. Empty cell = absent. */
  features: Array<{
    label: string;
    advottic: string;
    competitor: string;
  }>;
  /** "We win when..." paragraphs - honest commercial framing. */
  advotticWins: { heading: string; body: string }[];
  /** "They win when..." paragraphs - trust-building honesty. */
  competitorWins: { heading: string; body: string }[];
  /** FAQ - mirrors the visible accordion + emits FAQPage JSON-LD. */
  faq: Array<{ q: string; a: string }>;
  /** Pricing snapshot - shown as a tabular row in the page. */
  pricing: {
    advottic: string;
    competitor: string;
    sourceUrl?: string;
    sourceLabel?: string;
  };
};

export const COMPARISONS: Comparison[] = [
  {
    slug: 'clio',
    competitorName: 'Clio',
    competitorCompany: 'Themis Solutions Inc.',
    category: 'Practice management',
    reviewedAt: '2026-05-11',
    description:
      'Honest side-by-side: Advottic Counsel vs Clio Manage. Real pricing, real features, where each one wins. Updated May 2026.',
    keywords: [
      'clio alternative',
      'clio vs advottic',
      'advottic vs clio',
      'best clio alternative',
      'clio competitors',
    ],
    hook: [
      'Clio is the legacy name in legal practice management. We respect what they built. Advottic Counsel started where Clio is now and rebuilt with three things baked in from day one: a competent AI agent (Bella), a two-sided client marketplace, and bundled pricing that does not multiply when you add features.',
      'This is the honest comparison. If you are early in your evaluation, read both sides; if you are deep in a Clio renewal, the math at the bottom of this page is the part that matters.',
    ],
    features: [
      { label: 'Case / matter management', advottic: 'Included', competitor: 'Included' },
      { label: 'Time tracking', advottic: 'Included, AI-suggested entries', competitor: 'Included' },
      { label: 'IOLTA trust accounting', advottic: 'Included, 3-way reconciliation', competitor: 'Included' },
      { label: 'AI assistant', advottic: 'Bella included at every tier', competitor: 'Clio Duo $30-50/user/mo add-on' },
      { label: 'AI takes action (drafts, files, runs conflict checks)', advottic: 'Yes', competitor: 'No - research / Q&A only' },
      { label: 'Contract review AI', advottic: 'Included', competitor: 'Not included' },
      { label: 'E-signature', advottic: '5-100 requests/mo included', competitor: 'eSignature add-on, per-envelope' },
      { label: 'Client marketplace (inbound leads)', advottic: 'Included from Small Firm', competitor: 'Not offered' },
      { label: 'Co-counsel referral with fee-split tracking', advottic: 'Included', competitor: 'Not offered' },
      { label: 'Court-form auto-fill (CA / NY / TX / FL / Federal)', advottic: 'Included', competitor: 'Not offered' },
      { label: 'Mobile apps', advottic: 'iOS + Android', competitor: 'iOS + Android' },
      { label: 'SOC 2 Type II', advottic: 'In progress', competitor: 'Yes' },
      { label: 'HIPAA BAA', advottic: 'On request', competitor: 'Available' },
    ],
    advotticWins: [
      {
        heading: 'You want one tool, not three',
        body: "Clio sells the core, then you pay extra for Duo (AI), DocuSign integration (e-sign at cost), Spellbook (contract AI), and a CRM. Advottic Counsel bundles all four. A 5-attorney firm running the Clio stack typically pays $1,000-1,500 per month. Advottic Small Firm at $99/user/mo is $495/mo for the same five seats - plus the AI and the marketplace are included.",
      },
      {
        heading: 'You want AI that takes action',
        body: 'Clio Duo is a research and Q&A copilot. Bella is an agent: she drafts engagement letters, starts time entries when she sees you working on a matter, runs conflict checks across the firm, and pulls in CourtListener case law when the legal basis benefits from precedent. The difference between "AI that answers" and "AI that does" is the difference between a glossary and a clerk.',
      },
      {
        heading: 'You want new clients, not just a tool to serve them',
        body: 'Advottic ships with a two-sided client marketplace. Personal-tier consumers ask for help via Find Counsel, the brief lands in matching firms\' inboxes, the firm accepts or declines, the relationship starts. Clio has a directory; it does not route warm leads.',
      },
    ],
    competitorWins: [
      {
        heading: 'You need 13 years of feature depth',
        body: 'Clio has 10+ years of edge cases nailed. Their conflict-check rules, custom-field schemas, jurisdiction-specific docketing, and immigration-practice templates are deep. If your firm depends on a specific niche workflow that took years to refine, Clio probably has it and we probably do not.',
      },
      {
        heading: 'You have an existing Clio investment',
        body: "Migration is real work. If you have 500+ matters and 5 years of time entries in Clio, the right call is sometimes 'stay'. We migrate on request - Counsel Small Firm and above include a white-glove migration - but the rational decision depends on switching cost vs. ongoing savings.",
      },
      {
        heading: 'You need SOC 2 Type II in hand today',
        body: "Clio has Type II in hand. We are mid-audit; we expect issuance in 2026. If your firm's information security policy requires an active SOC 2 attestation report, that is a real constraint and we will not pretend otherwise.",
      },
    ],
    pricing: {
      advottic: '$59 (Solo) / $99 (Small Firm) / $149 (Growing) per user / month',
      competitor: '$89 (EasyStart) / $129 (Essentials) / $159 (Advanced) / $179 (Complete) per user / month',
      sourceUrl: 'https://www.clio.com/pricing/',
      sourceLabel: 'Clio public pricing page, reviewed May 2026',
    },
    faq: [
      {
        q: 'How hard is it to migrate from Clio to Advottic?',
        a: 'We have a one-click importer for Clio Manage that pulls matters, contacts, custom fields, and time entries. Documents migrate via Clio API. Small Firm and above include a white-glove migration call. A typical 5-attorney firm completes the move in 2-3 hours of operator time.',
      },
      {
        q: 'Will Advottic match Clio Duo on AI features?',
        a: 'Bella covers a wider feature set than Clio Duo today: she drafts documents, starts time entries on her own, runs conflict checks, and pulls in case law. Clio Duo is more polished as a research copilot. Pick by which mode of AI your firm actually uses: doing or asking.',
      },
      {
        q: 'Does Advottic integrate with QuickBooks?',
        a: 'Yes via the QuickBooks Online API for invoicing and trust-account reconciliation. Direct connection on Small Firm and above; CSV export on Solo.',
      },
      {
        q: 'Is Advottic safe for client confidentiality?',
        a: 'Bella runs on Anthropic Claude with zero-retention configured, which means Anthropic does not retain or train on your firm\'s inputs. Postgres row-level security isolates every firm; encrypted at rest with AES-256; TLS 1.3 in transit. Every Bella action is timestamped in the audit log for Model Rule 1.6 compliance.',
      },
    ],
  },

  {
    slug: 'spellbook',
    competitorName: 'Spellbook',
    competitorCompany: 'Rally Inc.',
    category: 'Contract AI',
    reviewedAt: '2026-05-11',
    description:
      'Honest side-by-side: Advottic vs Spellbook. Contract AI in Word vs full-stack practice management with contract AI built in. Updated May 2026.',
    keywords: [
      'spellbook alternative',
      'spellbook vs advottic',
      'best spellbook alternative',
      'contract review ai',
      'legal contract ai',
    ],
    hook: [
      'Spellbook is a contract-review copilot that lives inside Microsoft Word. Excellent at one thing. Advottic is the full practice-management stack with the same contract-AI built in, plus everything else a small firm needs.',
      'The question is not "which is better at contract review." Spellbook probably is, by a small margin. The question is whether you want to maintain Spellbook + Clio + DocuSign + a CRM, or one tool that does all four.',
    ],
    features: [
      { label: 'Contract review (clause flagging)', advottic: 'Included', competitor: 'Included' },
      { label: 'Clause library (Spellbook market positions)', advottic: 'Generic + custom', competitor: 'Industry-curated' },
      { label: 'Native Microsoft Word add-in', advottic: 'Browser + API', competitor: 'Yes (deep)' },
      { label: 'Case / matter management', advottic: 'Included', competitor: 'No' },
      { label: 'IOLTA trust accounting', advottic: 'Included', competitor: 'No' },
      { label: 'Time tracking', advottic: 'Included', competitor: 'No' },
      { label: 'E-signature', advottic: 'Included', competitor: 'No' },
      { label: 'Client marketplace', advottic: 'Included from Small Firm', competitor: 'No' },
      { label: 'Engagement letter drafting', advottic: 'Bella drafts in 2 min', competitor: 'No' },
      { label: 'Mobile app', advottic: 'iOS + Android', competitor: 'Web / Word only' },
      { label: 'Pricing per user', advottic: '$59-$149/user/mo (everything)', competitor: '$108-$300/user/mo (Spellbook only)' },
    ],
    advotticWins: [
      {
        heading: 'You want fewer vendors',
        body: 'Spellbook is one tool for one job. A real practice runs at least Spellbook + a PMS (Clio at $129/user/mo) + a CRM + an e-sign tool. Advottic is one tool for all of those, typically at less than the cost of Spellbook alone.',
      },
      {
        heading: 'You want AI that does more than redline',
        body: 'Bella drafts contracts and engagement letters from scratch, not just reviews ones you bring her. She also starts your time entries automatically while you work in the matter. Spellbook is read-only on contracts; Bella works in both directions.',
      },
      {
        heading: 'Your contracts are 90% transactional, not litigation-heavy',
        body: "If your contract work is bread-and-butter (NDA, MSA, employment, lease), Bella's clause flagging is on par with Spellbook for those categories. Spellbook's edge is in deeply specialized agreements (sophisticated M&A, complex SaaS terms). Match the tool to the work.",
      },
    ],
    competitorWins: [
      {
        heading: 'Your firm lives in Microsoft Word',
        body: "Spellbook's deepest moat is its native Word integration. Comments, redlines, track changes - it lives inside your existing tool. Advottic's contract review is browser-based or API. If your senior partners refuse to edit anywhere but Word, Spellbook is the right call.",
      },
      {
        heading: 'You work in narrow contract specialties at scale',
        body: "Spellbook's clause library is industry-curated. They review hundreds of thousands of contracts in specific categories - tech M&A, employment, SaaS - and the library reflects that. If your firm does one specialty deeply, Spellbook has more market positions per clause type.",
      },
    ],
    pricing: {
      advottic: '$59-$149/user/mo (full Counsel stack)',
      competitor: '$108-$300/user/mo (contract review only)',
      sourceUrl: 'https://www.spellbook.legal/pricing',
      sourceLabel: 'Spellbook public pricing, reviewed May 2026',
    },
    faq: [
      {
        q: 'Can I use Advottic alongside Spellbook?',
        a: 'Yes. Many firms use both during a transition. Spellbook handles contracts in Word; Advottic handles everything else. Most firms consolidate after 60-90 days once they see Bella covers their contract workflow.',
      },
      {
        q: 'How does Bella compare to Spellbook on clause flagging accuracy?',
        a: 'On standard contracts (NDA, MSA, employment, lease), accuracy is comparable within our testing. On specialized contracts (sophisticated M&A, complex SaaS terms), Spellbook has a market-position library we do not match. Pick based on the specialty mix of your contract work.',
      },
      {
        q: 'Will Bella train on our contract data?',
        a: 'No. Bella runs on Anthropic Claude with zero-retention configured. Your contracts are never used to train any model. Same posture as Spellbook on this question - both are zero-retention by default.',
      },
    ],
  },

  {
    slug: 'mycase',
    competitorName: 'MyCase',
    category: 'Practice management',
    reviewedAt: '2026-05-11',
    description:
      'Honest side-by-side: Advottic vs MyCase. Practice management for solo and small firms. Real pricing, real features. Updated May 2026.',
    keywords: [
      'mycase alternative',
      'mycase vs advottic',
      'best mycase alternative',
      'practice management for solo lawyers',
    ],
    hook: [
      'MyCase is a polished practice-management tool aimed squarely at solo and small-firm attorneys. The same audience we target. The honest comparison is on AI, on pricing, and on what comes bundled.',
    ],
    features: [
      { label: 'Case management', advottic: 'Included', competitor: 'Included' },
      { label: 'Client portal', advottic: 'Included', competitor: 'Included (the strong suit)' },
      { label: 'Time tracking', advottic: 'AI-suggested entries', competitor: 'Manual' },
      { label: 'AI assistant', advottic: 'Bella included', competitor: 'MyCase IQ (AI add-on)' },
      { label: 'AI agent capabilities', advottic: 'Drafts, files, runs conflict checks', competitor: 'Q&A and summaries' },
      { label: 'IOLTA trust accounting', advottic: 'Included', competitor: 'Included' },
      { label: 'E-signature', advottic: 'Included', competitor: 'Add-on' },
      { label: 'Client marketplace', advottic: 'Included from Small Firm', competitor: 'Not offered' },
      { label: 'Contract review AI', advottic: 'Included', competitor: 'Not included' },
      { label: 'Pricing', advottic: '$59-$149/user/mo', competitor: '$49-$89/user/mo (AI extra)' },
    ],
    advotticWins: [
      {
        heading: 'You want AI bundled, not extra',
        body: 'MyCase has IQ AI as an add-on. Bella is included at every Counsel tier. Once you add MyCase IQ to the base subscription, the price gap closes - then look at the agent capabilities below.',
      },
      {
        heading: 'You want an agent, not a copilot',
        body: 'MyCase IQ is a Q&A and summary copilot. Bella drafts engagement letters, runs conflict checks, starts time entries autonomously, and pulls case law. The difference compounds: a 5-attorney firm using Bella reports 8-15% time recovery per attorney per week.',
      },
      {
        heading: 'You want new client flow, not just servicing',
        body: 'Advottic\'s two-sided marketplace routes warm leads from Find Counsel to matching firms. MyCase does not have a client-acquisition channel built in.',
      },
    ],
    competitorWins: [
      {
        heading: 'Your client portal is the centerpiece',
        body: "MyCase's client portal is widely considered the best-in-class for small firms. If your practice is heavily client-portal-driven - personal injury intake, immigration paperwork exchange - MyCase has more polished portal-side UX than we do today.",
      },
      {
        heading: 'You want a lower entry-tier price',
        body: 'MyCase starts at $49/user/mo (without AI). Counsel Solo is $59/user/mo (with AI). If AI is not a priority and you want the cheapest practice-management subscription, MyCase wins by $10/user.',
      },
    ],
    pricing: {
      advottic: '$59-$149/user/mo (AI included)',
      competitor: '$49-$89/user/mo (AI add-on extra)',
      sourceUrl: 'https://www.mycase.com/pricing/',
      sourceLabel: 'MyCase public pricing, reviewed May 2026',
    },
    faq: [
      {
        q: 'Can I migrate from MyCase to Advottic?',
        a: 'Yes. We import MyCase matters, contacts, time entries, and documents via API. Small Firm and above include a white-glove migration. Typical 5-attorney firm completes the move in 2-3 hours.',
      },
      {
        q: 'How does Bella compare to MyCase IQ on AI features?',
        a: 'Bella is an agent (takes action) where MyCase IQ is a copilot (answers questions). Bella drafts engagement letters, runs conflict checks, starts time entries, and pulls case law. MyCase IQ summarizes documents and answers questions in chat.',
      },
    ],
  },

  {
    slug: 'smokeball',
    competitorName: 'Smokeball',
    category: 'Practice management',
    reviewedAt: '2026-05-11',
    description:
      'Honest side-by-side: Advottic vs Smokeball. Cloud-native AI-first vs hybrid Windows-installed practice management. Updated May 2026.',
    keywords: [
      'smokeball alternative',
      'smokeball vs advottic',
      'best smokeball alternative',
      'cloud legal practice management',
    ],
    hook: [
      'Smokeball is a hybrid practice-management tool: cloud sync plus a Windows-installed desktop client. They specialize in automatic time-tracking and a deep library of legal forms. Advottic is cloud-native, built for the AI-first era, and runs the same on Mac, Windows, iOS, and Android.',
    ],
    features: [
      { label: 'Deployment', advottic: 'Cloud (Mac/Win/iOS/Android)', competitor: 'Windows desktop + cloud sync' },
      { label: 'Automatic time tracking', advottic: 'Bella suggests entries', competitor: 'Auto-time (passive)' },
      { label: 'AI assistant', advottic: 'Bella included', competitor: 'Smokeball AI (limited)' },
      { label: 'Document automation', advottic: 'Bella drafts from template', competitor: 'Deep library of state forms' },
      { label: 'IOLTA trust accounting', advottic: 'Included', competitor: 'Included' },
      { label: 'E-signature', advottic: 'Included', competitor: 'Included' },
      { label: 'Mac support', advottic: 'Native', competitor: 'No (Windows-only desktop)' },
      { label: 'Client marketplace', advottic: 'Included from Small Firm', competitor: 'Not offered' },
      { label: 'Pricing', advottic: '$59-$149/user/mo', competitor: 'Quote-based, est. $89-$219/user/mo' },
    ],
    advotticWins: [
      {
        heading: 'Your firm uses Macs',
        body: 'Smokeball requires Windows for the desktop client. If half your firm runs MacBook, Smokeball forces a hardware decision. Advottic is fully cross-platform; the same dashboard runs on Mac, Windows, iOS, and Android.',
      },
      {
        heading: 'You want transparent pricing',
        body: "Smokeball does not publish pricing publicly - every quote is custom. Estimated industry range is $89-$219/user/mo depending on tier. Advottic publishes $59-$149/user/mo on the pricing page, and you can sign up today without a sales call.",
      },
      {
        heading: 'You want AI that takes action',
        body: 'Smokeball\'s AI is currently limited to document summarization and the existing auto-time feature. Bella drafts engagement letters from scratch, runs conflict checks across the firm, and pulls in case law citations. The agent capabilities are years ahead.',
      },
    ],
    competitorWins: [
      {
        heading: 'You need a deep state-form library',
        body: "Smokeball's form library is one of the deepest in the category - thousands of jurisdiction-specific legal forms across all 50 states. Advottic ships with the high-volume forms (CA, NY, TX, FL, Federal) but does not match Smokeball's library depth in niche-jurisdiction work.",
      },
      {
        heading: 'You love your auto-time-tracking',
        body: 'Smokeball\'s auto-time has years of refinement; it captures hours passively while you work, no input required. Bella suggests time entries but expects user review. If you bill by tenth-of-an-hour and want zero touch, Smokeball is the more mature implementation.',
      },
    ],
    pricing: {
      advottic: '$59-$149/user/mo (published)',
      competitor: 'Quote-based, est. $89-$219/user/mo',
      sourceUrl: 'https://www.smokeball.com/',
      sourceLabel: 'Smokeball pricing requires quote; estimate based on industry research, May 2026',
    },
    faq: [
      {
        q: 'Can I migrate from Smokeball to Advottic?',
        a: 'Yes, but Smokeball does not expose a public API like Clio or MyCase, so migration is more manual. We provide CSV import tools for matters, contacts, time entries, and trust ledgers. White-glove migration available on Small Firm and above.',
      },
      {
        q: 'What about the auto-time-tracking?',
        a: 'Bella suggests time entries automatically when she sees you working on a matter, but expects user review before posting. The capture is similar; the difference is that Bella expects approval. We are exploring an opt-in passive mode for 2027.',
      },
    ],
  },

  {
    slug: 'docusign',
    competitorName: 'DocuSign',
    category: 'E-signature',
    reviewedAt: '2026-05-11',
    description:
      'Honest side-by-side: Advottic vs DocuSign for legal e-signature. UETA / E-SIGN compliance, audit trails, pricing. Updated May 2026.',
    keywords: [
      'docusign alternative for lawyers',
      'docusign vs advottic',
      'best esignature for law firms',
      'legal esignature',
    ],
    hook: [
      'DocuSign is the e-signature category king. Excellent at one thing. Advottic is the full practice-management stack with UETA-compliant e-signatures built in.',
      'If your firm only needs e-signatures and nothing else, DocuSign is fine. If you also need case management, time tracking, IOLTA, and contract review, paying separately for each is the expensive path.',
    ],
    features: [
      { label: 'E-signature requests', advottic: '5-100/mo per tier included', competitor: 'Tier-based volumes' },
      { label: 'UETA / E-SIGN compliance', advottic: 'Yes, audit-trail per event', competitor: 'Yes' },
      { label: 'Certificate of completion', advottic: 'PDF + HMAC-signed JSON', competitor: 'PDF' },
      { label: 'Bulk send', advottic: 'Included from Small Firm', competitor: 'Per-tier' },
      { label: 'Case management', advottic: 'Included', competitor: 'No' },
      { label: 'IOLTA / trust accounting', advottic: 'Included', competitor: 'No' },
      { label: 'AI assistant', advottic: 'Bella drafts and routes', competitor: 'Insight AI add-on' },
      { label: 'Per-request cost beyond included', advottic: '$1-$2', competitor: '$0.50-$2.50' },
      { label: 'Pricing per user', advottic: '$59-$149/user/mo (everything)', competitor: '$15-$75/user/mo (e-sign only)' },
    ],
    advotticWins: [
      {
        heading: 'E-signature is one piece of your workflow',
        body: 'If your firm sends e-signatures to clients alongside case work, contract review, and time tracking, Advottic does all of it in one tool. DocuSign Real Estate or Business Pro is $25-75/user/mo on top of the rest of your stack.',
      },
      {
        heading: 'You want the audit trail under one roof',
        body: 'Every Bella action and every signing event is timestamped in the same audit log. The Counsel timeline shows "engagement letter drafted, sent for signature, signed, countersigned, time entry posted" in one feed. DocuSign\'s audit trail is excellent in isolation but separate from the rest of your matter record.',
      },
      {
        heading: 'You want bundled pricing predictability',
        body: 'DocuSign\'s volume-based pricing punishes growth. A solo attorney sending 30 envelopes/month pays one rate; a 5-attorney firm sending 300 pays much more per envelope. Advottic\'s envelopes are included up to your tier ceiling, then $1-$2 each.',
      },
    ],
    competitorWins: [
      {
        heading: 'You only need e-signatures',
        body: "If your firm has no need for case management, time tracking, IOLTA, or contract review (or has all of those covered already), DocuSign is the focused tool. Their volume and reliability for e-signature alone is unmatched.",
      },
      {
        heading: 'You need enterprise-grade signing workflows',
        body: "DocuSign at the Enterprise tier supports advanced routing rules, conditional logic, and bulk-send queues that we do not match today. Large transactional practices benefit from those features.",
      },
    ],
    pricing: {
      advottic: '$59-$149/user/mo (full Counsel stack with e-sign included)',
      competitor: '$15-$75/user/mo (e-sign only)',
      sourceUrl: 'https://www.docusign.com/pricing',
      sourceLabel: 'DocuSign public pricing, reviewed May 2026',
    },
    faq: [
      {
        q: 'Are Advottic e-signatures UETA / E-SIGN compliant?',
        a: 'Yes. Every signing event captures the signer\'s identity verification, timestamp, IP address, and consent to electronic record. Certificates of completion are HMAC-signed and exportable as PDF or JSON.',
      },
      {
        q: 'Can I send envelopes for signature without a paid plan?',
        a: 'Receiving and signing requests is always free; sending requires Personal Pro or any Counsel tier. Free-tier users can receive an unlimited number of signing requests.',
      },
      {
        q: 'How does Advottic handle witnesses and notaries?',
        a: 'Witness signatures are supported via routed signing. Remote online notarization (RON) is available via a third-party integration on Small Firm and above; in jurisdictions where RON is not yet authorized, we surface the warning at request time.',
      },
    ],
  },

  {
    slug: 'harvey',
    competitorName: 'Harvey',
    competitorCompany: 'Harvey AI',
    category: 'Legal research AI',
    reviewedAt: '2026-05-11',
    description:
      'Honest side-by-side: Advottic vs Harvey AI. Big-law research assistant vs full-stack small-firm platform. Updated May 2026.',
    keywords: [
      'harvey ai alternative',
      'harvey vs advottic',
      'best legal ai for small firms',
      'harvey ai pricing',
    ],
    hook: [
      'Harvey is the AI tool of choice for big-law (Allen & Overy, PwC, etc.) - deeply integrated research and document analysis. Pricing reflects: starts in the low six figures annually. Advottic is the full-stack alternative for the small and mid-market firms Harvey does not serve.',
    ],
    features: [
      { label: 'Target customer', advottic: 'Solo to 100-attorney firms', competitor: 'Am Law 200 / Big 4' },
      { label: 'Public pricing', advottic: '$59-$149/user/mo', competitor: 'Custom, $5,000+/user/year typical' },
      { label: 'Self-serve signup', advottic: 'Yes, 14-day trial', competitor: 'No, sales-led, multi-month deployment' },
      { label: 'Practice management included', advottic: 'Yes', competitor: 'No' },
      { label: 'IOLTA trust accounting', advottic: 'Yes', competitor: 'No' },
      { label: 'AI document review', advottic: 'Bella included', competitor: 'Yes (deep)' },
      { label: 'AI agent (takes action)', advottic: 'Yes', competitor: 'Read-only research / Q&A' },
      { label: 'Case-law citations', advottic: 'CourtListener integration', competitor: 'Westlaw / Lexis integration' },
    ],
    advotticWins: [
      {
        heading: 'You run a small or mid-market firm',
        body: 'Harvey is built and priced for Am Law 200 and Big 4 accounting firms. Their deployment cycle is months long and their pricing assumes enterprise procurement. Advottic is built and priced for solo through 100-attorney firms - you can sign up today and be running in 30 minutes.',
      },
      {
        heading: 'You want a working tool, not a research copilot',
        body: 'Harvey\'s strength is deep document analysis and research summarization. Bella covers research at a lighter level, but she also drafts engagement letters, runs conflict checks, and starts time entries autonomously - things Harvey is not built to do.',
      },
      {
        heading: 'You want practice management included',
        body: 'Harvey is an AI layer on top of your existing infrastructure. Advottic is the AI plus the infrastructure: case management, IOLTA, e-sign, marketplace. One vendor, one bill, one audit log.',
      },
    ],
    competitorWins: [
      {
        heading: 'You are big-law doing complex M&A or class-action work',
        body: "Harvey's depth on complex transactional and litigation document review is unmatched. They have years of Am Law training data we do not have. If your firm is 200+ attorneys doing the most sophisticated commercial work, Harvey is purpose-built for you.",
      },
      {
        heading: 'You have an existing Westlaw / Lexis investment',
        body: 'Harvey integrates deeply with Westlaw and Lexis. We use the free CourtListener case-law database, which is excellent for most matters but does not match Westlaw\'s KeyCite signal for active-citation status checks. If your research workflow depends on those signals, Harvey is the better fit.',
      },
    ],
    pricing: {
      advottic: '$59-$149/user/mo, self-serve',
      competitor: 'Custom, est. $5,000-$50,000/user/year (sales-led)',
      sourceUrl: 'https://www.harvey.ai/',
      sourceLabel: 'Harvey pricing is sales-led; estimate based on Am Law procurement disclosures, May 2026',
    },
    faq: [
      {
        q: 'Why is Harvey so much more expensive?',
        a: 'Harvey is positioned for Am Law and Big 4 customers, who procure software at enterprise scale (six- and seven-figure annual contracts are normal). Their fixed costs (R&D, customer success, sales) are amortized across fewer, larger customers. Advottic is positioned for the long tail of small and mid-market firms, with self-serve pricing and product-led growth.',
      },
      {
        q: 'Can a small firm use Harvey?',
        a: 'In principle yes; in practice the pricing and sales cycle are typically prohibitive. Harvey has not (publicly) offered a small-firm self-serve tier.',
      },
    ],
  },

  {
    slug: 'cocounsel',
    competitorName: 'Casetext CoCounsel',
    competitorCompany: 'Thomson Reuters',
    category: 'Legal research AI',
    reviewedAt: '2026-05-11',
    description:
      'Honest side-by-side: Advottic vs Casetext CoCounsel (now Thomson Reuters CoCounsel). Legal research AI vs full-stack practice management. Updated May 2026.',
    keywords: [
      'cocounsel alternative',
      'casetext cocounsel alternative',
      'cocounsel vs advottic',
      'best legal research ai',
    ],
    hook: [
      'CoCounsel is the legal research AI flagship from Thomson Reuters (acquired Casetext in 2023). Deeply integrated with Westlaw and Practical Law. It is a research copilot - excellent at answering questions and analyzing documents. Advottic is a full-stack platform with research, practice management, and a marketplace built in.',
    ],
    features: [
      { label: 'Target customer', advottic: 'Solo to 100-attorney firms', competitor: 'All sizes, Westlaw-anchored' },
      { label: 'Public pricing', advottic: '$59-$149/user/mo', competitor: 'Reported $225-$500/user/mo (Westlaw req\'d)' },
      { label: 'Westlaw integration', advottic: 'No (CourtListener instead)', competitor: 'Native, full' },
      { label: 'Practice management', advottic: 'Included', competitor: 'No' },
      { label: 'IOLTA trust accounting', advottic: 'Included', competitor: 'No' },
      { label: 'AI agent (takes action)', advottic: 'Yes', competitor: 'No - research / Q&A only' },
      { label: 'E-signature included', advottic: 'Yes', competitor: 'No' },
      { label: 'Self-serve signup', advottic: 'Yes, 14-day trial', competitor: 'Yes' },
    ],
    advotticWins: [
      {
        heading: 'You need more than research',
        body: 'CoCounsel answers research questions. Advottic answers research questions AND runs your practice, your trust account, your billing, your e-sign, and your client acquisition. If your firm only needs research AI, CoCounsel is excellent; if you need everything, Advottic is the consolidation play.',
      },
      {
        heading: 'You do not want a Westlaw subscription on top',
        body: 'CoCounsel is bundled with Westlaw - the full value requires the underlying Westlaw subscription, which is $100-300+/user/mo on its own. Advottic\'s case-law lookups use CourtListener (free, public, ~10 million decisions) which covers most matter types competently. Small and solo firms typically do not need Westlaw\'s premium signals.',
      },
      {
        heading: 'You want lower total cost',
        body: 'CoCounsel + Westlaw + a separate practice-management tool typically runs $400-700 per user per month. Advottic Counsel Small Firm at $99/user/mo bundles practice management, AI, e-sign, and the marketplace. Even if you keep Westlaw, the consolidation savings are significant.',
      },
    ],
    competitorWins: [
      {
        heading: 'Your firm runs on Westlaw',
        body: 'If your research workflow is built around Westlaw\'s KeyCite citation network, headnotes, and Practical Law templates, CoCounsel is the natural AI layer. The integration depth is unmatched.',
      },
      {
        heading: 'You do high-volume sophisticated research',
        body: "CoCounsel's research depth - especially in highly technical commercial litigation, regulatory work, and complex class actions - is best-in-class. Big-law and well-funded boutiques use it for a reason.",
      },
    ],
    pricing: {
      advottic: '$59-$149/user/mo (full Counsel stack)',
      competitor: 'Reported $225-$500/user/mo + Westlaw subscription typically required',
      sourceUrl: 'https://www.thomsonreuters.com/en/legal/cocounsel.html',
      sourceLabel: 'CoCounsel public pricing not disclosed; estimate from public procurement reports, May 2026',
    },
    faq: [
      {
        q: 'Does Advottic match CoCounsel on legal research quality?',
        a: 'On most small-firm matter types, our CourtListener integration covers the research need competently. For complex transactional, regulatory, or sophisticated litigation work that benefits from KeyCite signals and Practical Law templates, CoCounsel is the deeper tool.',
      },
      {
        q: 'Can I use both Advottic and CoCounsel?',
        a: 'Yes. Many firms use Advottic for practice management + Bella for routine drafting, and CoCounsel for deep research. The cost stack is high, but the workflow works.',
      },
    ],
  },

  {
    slug: 'legalzoom',
    competitorName: 'LegalZoom',
    competitorCompany: 'LegalZoom.com, Inc.',
    category: 'Full-stack platform',
    reviewedAt: '2026-06-08',
    description:
      'Honest side-by-side: Advottic vs LegalZoom. Consumer legal services compared on pricing, AI, and breadth. Updated June 2026.',
    keywords: [
      'legalzoom alternative',
      'legalzoom vs advottic',
      'advottic vs legalzoom',
      'best legalzoom alternative',
      'legalzoom competitors',
      'cheaper than legalzoom',
    ],
    hook: [
      'LegalZoom is a 25-year-old document factory. They built a business turning routine forms (LLC formation, simple wills, basic NDAs) into a checkout flow. That is real value for one transaction.',
      'Advottic is a different product: a place to organize an entire matter, draft documents with an AI assistant that reads them with you, and walk into court (or a lawyer) prepared. If you need one form, LegalZoom is the right call. If you have a problem, we are the right call.',
    ],
    features: [
      { label: 'Free legal templates (no signup)', advottic: 'Yes', competitor: 'No - paywall or signup gate' },
      { label: 'AI legal assistant', advottic: 'Bella, included', competitor: 'Limited / not core' },
      { label: 'Case organization (timeline, exhibits, packet export)', advottic: 'Yes', competitor: 'No' },
      { label: 'Statute of limitations checker', advottic: 'Yes, free', competitor: 'No' },
      { label: 'Court deadline calculator', advottic: 'Yes, free', competitor: 'No' },
      { label: 'Personal safety alerts (Safe Witness)', advottic: 'Yes, with watch app', competitor: 'No' },
      { label: 'LLC / business formation', advottic: 'Not offered', competitor: 'Yes (their core product)' },
      { label: 'Will + estate planning forms', advottic: 'Not offered', competitor: 'Yes' },
      { label: 'Attorney directory', advottic: 'Find Counsel marketplace', competitor: 'Attorney network add-on subscription' },
      { label: 'Free tier', advottic: 'Yes, no credit card', competitor: 'No' },
      { label: 'iOS + Android apps', advottic: 'Yes', competitor: 'Limited' },
      { label: 'Smartwatch (Wear OS) app', advottic: 'Yes', competitor: 'No' },
    ],
    advotticWins: [
      {
        heading: 'You have a legal problem, not a form to fill out',
        body: 'LegalZoom is form-first: pick the form, pay, fill the fields, download the PDF. Advottic is matter-first: organize the problem, gather the evidence, talk to Bella about what you have, draft the right document for the right step. If you got served, evicted, harassed, or stiffed, our flow is the one built for you.',
      },
      {
        heading: 'You want free, not freemium',
        body: 'Advottic templates are free with no email gate, no signup, no upsell modal. LegalZoom puts most documents behind a paid plan. If the only thing standing between you and a demand letter is $50, Advottic is the right call.',
      },
      {
        heading: 'You want an AI that reads your case, not a search box',
        body: 'Bella reads the documents you upload, knows the dates in your timeline, references the controlling statute in your state, and drafts the next step. LegalZoom is moving toward AI but the core remains a form catalog.',
      },
    ],
    competitorWins: [
      {
        heading: 'You need to form an LLC or corporation',
        body: 'Business formation is what LegalZoom was built for. Their flow handles state filings, EIN application, registered agent service, and ongoing compliance reminders. We do not offer business formation. Use LegalZoom for that.',
      },
      {
        heading: 'You need a simple will or estate plan today',
        body: 'LegalZoom offers will and trust packages at $89-$179 with attorney review available. Our consumer product does not include will drafting. If estate planning is the only thing you need, LegalZoom or a local estate attorney is the right call.',
      },
      {
        heading: 'You want a national brand name',
        body: 'LegalZoom has 25 years of brand recognition and a directly-employed attorney network. If your priority is name recognition over product depth, that matters.',
      },
    ],
    pricing: {
      advottic: 'Free (templates + tools) / $19/mo (Personal Plus) / $39/mo (Personal Pro)',
      competitor: '$249 (single legal forms) / $39.99/mo (Legal Advantage subscription) / per-service pricing',
      sourceUrl: 'https://www.legalzoom.com/personal/legal-plans',
      sourceLabel: 'LegalZoom public pricing pages, reviewed June 2026',
    },
    faq: [
      {
        q: 'Is Advottic cheaper than LegalZoom?',
        a: 'For matters where both work, yes. Advottic templates and tools are free; Personal Plus is $19/mo with unlimited document drafting and Bella. LegalZoom charges per document for most consumer forms. The break-even for an active user is one document.',
      },
      {
        q: 'Can Advottic form an LLC for me?',
        a: 'No. Business formation is not part of our consumer product today. LegalZoom, Northwest Registered Agent, or your state Secretary of State portal are the right paths for LLC formation.',
      },
      {
        q: 'Is Advottic a law firm?',
        a: 'No. We are an AI-powered legal platform. We do not give legal advice and our AI assistant Bella does not represent users. For licensed legal advice we connect users to attorneys through Find Counsel.',
      },
      {
        q: 'Can Advottic help with eviction or being sued?',
        a: 'Yes, this is the kind of problem we were built for. The guides at /guides cover the most common consumer situations, the templates at /templates draft the responses, and Bella helps reason through your case.',
      },
    ],
  },

  {
    slug: 'rocket-lawyer',
    competitorName: 'Rocket Lawyer',
    competitorCompany: 'Rocket Lawyer Incorporated',
    category: 'Full-stack platform',
    reviewedAt: '2026-06-08',
    description:
      'Honest side-by-side: Advottic vs Rocket Lawyer. Consumer legal services compared on pricing, AI, and case-handling depth. Updated June 2026.',
    keywords: [
      'rocket lawyer alternative',
      'rocket lawyer vs advottic',
      'advottic vs rocket lawyer',
      'best rocket lawyer alternative',
      'rocket lawyer competitors',
      'cheaper than rocket lawyer',
    ],
    hook: [
      'Rocket Lawyer is a subscription document service with an attorney-call-back add-on. It is a 25-year-old product that does a fine job of generating common forms.',
      'Advottic is a different layer of product: matter organization, an AI assistant that reads your documents, free interactive tools (statute of limitations checker, court deadline calculator), and templates that are actually free with no email gate.',
    ],
    features: [
      { label: 'Free legal templates (no signup, no email)', advottic: 'Yes', competitor: 'No - 7-day trial then $39.99/mo' },
      { label: 'AI legal assistant', advottic: 'Bella, included at every paid tier', competitor: 'Rocket Copilot, included in Premium' },
      { label: 'Statute of limitations checker', advottic: 'Yes, free', competitor: 'No' },
      { label: 'Court deadline calculator', advottic: 'Yes, free', competitor: 'No' },
      { label: 'Case timeline + exhibits + packet export', advottic: 'Yes', competitor: 'Not as a structured flow' },
      { label: 'Attorney consultation', advottic: 'Find Counsel marketplace (per-engagement)', competitor: 'Included in Premium ($39.99/mo)' },
      { label: 'Business formation', advottic: 'Not offered', competitor: 'Yes' },
      { label: 'Will + estate planning', advottic: 'Not offered', competitor: 'Yes' },
      { label: 'Personal safety alerts (Safe Witness)', advottic: 'Yes, phone + watch', competitor: 'No' },
      { label: 'iOS + Android apps', advottic: 'Yes', competitor: 'Yes' },
      { label: 'Smartwatch (Wear OS) app', advottic: 'Yes', competitor: 'No' },
      { label: 'Open dataset / API for the data', advottic: 'Yes, CC BY 4.0', competitor: 'No' },
    ],
    advotticWins: [
      {
        heading: 'You want free without a 7-day trial',
        body: 'Rocket Lawyer\'s "free" templates require a 7-day trial that auto-converts to $39.99/mo if you forget to cancel. Advottic templates and tools are free, full stop. No card on file. No reminder needed.',
      },
      {
        heading: 'You want an AI that handles your case',
        body: 'Bella reads the documents you upload, knows your timeline, references the controlling statute, and drafts the next step. The product is built around organizing one matter end-to-end, not generating one form at a time.',
      },
      {
        heading: 'You want personal-safety features',
        body: 'Advottic Safe Witness lets you hold a button on phone or watch to send your live location and emergency contact info to designated people. We do not know any other consumer legal platform that ships this. If your matter involves a stalker, abusive ex, or court appearance you are nervous about, this matters.',
      },
    ],
    competitorWins: [
      {
        heading: 'You want attorney consultation bundled in',
        body: 'Rocket Lawyer Premium ($39.99/mo) includes 30-minute attorney consultations on new matters. We connect users to attorneys via Find Counsel as a marketplace, not as a subscription benefit. If you value a-la-carte attorney calls without per-engagement fees, Rocket Lawyer\'s structure is friendlier.',
      },
      {
        heading: 'You need to form a business',
        body: 'Rocket Lawyer handles LLC and corporation formation. We do not. If business formation is your immediate need, use them or a registered-agent service.',
      },
      {
        heading: 'You need a basic will today',
        body: 'Rocket Lawyer includes wills in their Premium plan. Our consumer product does not include estate planning forms. If your only need is a simple will, Rocket Lawyer or a local estate attorney is the right call.',
      },
    ],
    pricing: {
      advottic: 'Free (templates + tools) / $19/mo (Personal Plus) / $39/mo (Personal Pro)',
      competitor: 'Free 7-day trial / $39.99/mo (Premium) / per-document pricing for non-members',
      sourceUrl: 'https://www.rocketlawyer.com/legal-services/legal-plans',
      sourceLabel: 'Rocket Lawyer public pricing pages, reviewed June 2026',
    },
    faq: [
      {
        q: 'Is Advottic free, or is there a hidden trial?',
        a: 'No trial. Templates, statute-of-limitations checker, court deadline calculator, glossary, guides, and open datasets are free with no card on file and no email gate. Paid plans are optional and unlock document drafting limits and Bella usage.',
      },
      {
        q: 'Does Advottic include attorney consultations?',
        a: 'Not as a subscription benefit. We run a two-sided marketplace at Find Counsel where users post briefs and matching attorneys respond. Consultations are arranged directly between user and attorney. If you want bundled attorney calls every month, Rocket Lawyer Premium is a better fit.',
      },
      {
        q: 'Can Bella give me legal advice like a Rocket Lawyer attorney can?',
        a: 'No. Bella is an AI assistant, not a licensed attorney. She drafts documents, explains documents, and helps you organize your case. Licensed legal advice still comes from an attorney, accessed via Find Counsel.',
      },
      {
        q: 'How do Advottic and Rocket Lawyer compare on AI?',
        a: 'Rocket Copilot is closer to a smart search and document-fill tool. Bella reads the documents you upload, references the controlling statute in your state, draws on your timeline, and drafts contextual responses. Both are good; Bella is more matter-aware.',
      },
    ],
  },
];
