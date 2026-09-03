/**
 * Cornerstone SEO articles for /resources/[slug].
 *
 * Each article targets a real high-intent keyword cluster identified
 * via competitor SERP analysis. The structure is intentional:
 *
 *   - Title hits the primary keyword first, modifier second
 *   - Description is the meta-description Google shows on SERPs
 *     (155-165 chars, action-oriented)
 *   - The body is plain prose with intentionally embedded internal
 *     links and CTAs to product surfaces
 *   - publishedAt is the date we want Google to show in the SERP
 *
 * Adding more articles: append to ARTICLES below. The /resources
 * hub auto-discovers them; sitemap.ts auto-includes them; the
 * /resources/[slug] page auto-renders.
 *
 * What NOT to do: don't keyword-stuff. Google's algorithm has been
 * training on natural language for a decade. Write for a human,
 * answer the question, link out to the product.
 */

/**
 * One body paragraph. The plain string is the norm.
 *
 * The paired form is for a paragraph that names one of OUR prices or links to
 * /pricing. `web` is the paragraph exactly as a browser reader sees it. `app`
 * is the same paragraph with the price and the purchase link taken out, for
 * the iOS app, which sells nothing and names no place to buy; middleware.ts
 * redirects /pricing there, so the link would have landed on the home screen.
 * The [slug] route renders both and the platform CSS shows one
 * (app/resources/[slug]/page.tsx). Other vendors' prices stay in the plain
 * form: they are reporting, not an offer. Note the reason once, here, rather
 * than at each paragraph.
 */
export type ArticleParagraph = string | { web: string; app: string };

export type Article = {
  slug: string;
  title: string;
  description: string;
  /** ISO-8601. */
  publishedAt: string;
  /** Optional last-update timestamp. */
  updatedAt?: string;
  /** SEO category tag for the hub filter. */
  category:
    | 'self_help'
    | 'practice_management'
    | 'contracts'
    | 'ai_legal'
    | 'compliance';
  /** SEO keywords - first one is primary. */
  keywords: string[];
  /** ~3-minute read time est. */
  readMinutes: number;
  /** Body sections rendered by the [slug] route. Each section has
   *  an h2 heading and prose paragraphs. Internal links use
   *  markdown-ish [label](path) syntax which the renderer parses. */
  sections: Array<{ heading: string; body: ArticleParagraph[] }>;
  /** Optional FAQ - rendered as expandable + emits FAQPage JSON-LD. */
  faq?: Array<{ q: string; a: string }>;
  /** End-of-article CTA. */
  cta?: { label: string; href: string };
};

export const ARTICLES: Article[] = [
  {
    slug: 'how-to-write-a-demand-letter',
    title:
      'How to write a demand letter (free template + 7-step guide)',
    description:
      'Step-by-step guide to writing a demand letter that actually gets a response. Free template, 7 essential elements, what to do if it is ignored.',
    publishedAt: '2026-04-15T09:00:00Z',
    category: 'self_help',
    keywords: [
      'how to write a demand letter',
      'demand letter template',
      'demand letter sample',
      'pre-suit demand',
    ],
    readMinutes: 8,
    sections: [
      {
        heading: 'What a demand letter actually is',
        body: [
          'A demand letter is a formal written request that the recipient pay money or perform some specific action by a stated deadline. It is the last off-ramp before a lawsuit. The recipient sees that you are organized, willing to take the next step, and serious about the timeline.',
          'Done well, a demand letter resolves the matter without a single court filing. Done poorly, it creates evidence that hurts you later. The difference is structure and tone.',
        ],
      },
      {
        heading: 'The 7 essential elements',
        body: [
          '1. Your full name and address at the top, then today\'s date.',
          '2. Recipient name and address.',
          '3. A clear "Re:" line that names the matter in one sentence.',
          '4. A factual paragraph: what happened, when, who was involved. Stick to facts you can prove.',
          '5. A legal-basis paragraph: the contract clause, statute, or common-law doctrine that gives you the right to demand. Plain language is fine: "Section 4 of our lease dated [date]" or "California Civil Code Section 1942."',
          '6. The demand itself: be specific. Dollar amount, action, or both. Vague demands ("make this right") read as theatrics.',
          '7. The deadline: typically 14 to 30 days. State the exact consequence of missing it (file suit, report to a regulator, record a lien).',
        ],
      },
      {
        heading: 'Tone is the entire game',
        body: [
          'A demand letter is not a place to vent. The reader will look for emotion to dismiss the letter as a bluff. Stay clinical. State facts in numbered paragraphs. Reserve all rights at the end.',
          'Read it out loud before sending. If any sentence sounds like it could appear on the local news as a quote you would regret, cut it.',
        ],
      },
      {
        heading: 'What to do when the deadline passes',
        body: [
          'If the deadline passes without resolution, your options scale with the dollar amount and your jurisdiction. Small claims courts handle disputes up to $5,000 to $25,000 depending on state. Above that, you typically need an attorney.',
          'Either way, do exactly what your letter said you would do. The single biggest credibility leak is making a threat and not following through.',
        ],
      },
      {
        heading: 'Skip the template - draft it with Bella',
        body: [
          {
            web: 'Advottic\'s legal AI Bella drafts the full letter in two minutes from a short narrative. She populates parties, facts, legal basis, demand, and deadline; you review and send. Free for the first three drafts; $19/mo for unlimited on [Personal Pro](/pricing).',
            app: 'Advottic\'s legal AI Bella drafts the full letter in two minutes from a short narrative. She populates parties, facts, legal basis, demand, and deadline; you review and send. Free for the first three drafts; unlimited drafts are included with a subscription on your account.',
          },
          'Bella also pulls real case-law citations from the public CourtListener database when the legal basis benefits from precedent.',
        ],
      },
    ],
    faq: [
      {
        q: 'Do I need a lawyer to send a demand letter?',
        a: 'No. Demand letters are routinely sent by individuals and small businesses without an attorney. That said, when the dispute exceeds small-claims limits or involves complex damages, an attorney drastically increases your leverage.',
      },
      {
        q: 'How long should a demand letter be?',
        a: 'One to two pages. The recipient should be able to read the entire letter in two minutes and immediately understand the demand, the basis, and the deadline.',
      },
      {
        q: 'Should I send by certified mail?',
        a: 'Yes. Certified mail with return receipt is the standard for proving receipt. Email is also acceptable as a backup when you have an established email channel with the recipient.',
      },
    ],
    cta: { label: 'Draft a demand letter with Bella', href: '/sign-in?next=/cases/new' },
  },

  {
    slug: 'best-legal-ai-2026',
    title:
      'The best legal AI software in 2026 (honest comparison)',
    description:
      'Side-by-side review of Casetext CoCounsel, Spellbook, Harvey, Lexis+, Westlaw Precision, and Advottic. Real pricing, real strengths, real weaknesses.',
    publishedAt: '2026-05-01T09:00:00Z',
    category: 'ai_legal',
    keywords: [
      'best legal AI',
      'legal AI software',
      'AI for lawyers',
      'CoCounsel vs Harvey',
      'Spellbook alternative',
    ],
    readMinutes: 12,
    sections: [
      {
        heading: 'Why this category exists',
        body: [
          'Legal AI hit the mainstream in 2023 with the public launch of Casetext CoCounsel and Harvey. Three years later, the market has split into three distinct shapes: research copilots, contract specialists, and full-stack platforms. Picking the wrong shape for your firm wastes $10k-$300k a year.',
        ],
      },
      {
        heading: 'Research copilots: CoCounsel, Harvey, Lexis+ AI',
        body: [
          'These tools live next to Westlaw and Lexis as research multipliers. They read the produced documents you upload, summarize them, and let you query case law in natural language. Pricing runs $250 to $500 per user per month, often gated behind a paid Westlaw or Lexis subscription on top.',
          'Strength: deep, vendor-curated case-law databases with KeyCite / Shepard\'s signaling. Weakness: research only - they don\'t draft your engagement letter, run your trust account, or send signing requests. You pay separately for everything else.',
        ],
      },
      {
        heading: 'Contract specialists: Spellbook, Ironclad CLM, LegalSifter',
        body: [
          'These tools live inside Microsoft Word and review contracts paragraph-by-paragraph against a library of standard market positions. $108-$300 per user per month.',
          'Strength: deep contract-clause libraries that catch problems junior associates miss. Weakness: same as research copilots - they only do one thing. They don\'t track your billable time or close the marketplace loop with new clients.',
        ],
      },
      {
        heading: 'Full-stack platforms: Advottic, Clio with Duo, Litify',
        body: [
          'Full-stack platforms treat AI as a tool inside the practice management suite, not as a separate product. The same dashboard runs your cases, your time, your trust ledger, and your AI assistant.',
          {
            web: '[Advottic](/) starts at $59 per user per month and bundles Bella (an AI agent that drafts documents, runs conflict checks, and starts time entries on her own), case management, IOLTA, e-signature, and a two-sided client marketplace. The bundled AI is roughly equivalent to Spellbook and the case management to Clio.',
            app: '[Advottic](/) bundles Bella (an AI agent that drafts documents, runs conflict checks, and starts time entries on her own), case management, IOLTA, e-signature, and a two-sided client marketplace. The bundled AI is roughly equivalent to Spellbook and the case management to Clio.',
          },
          'Clio with Duo is the same shape but $89-$129 per user per month plus the Duo upcharge; their AI is research-focused.',
          'Litify is enterprise-only Salesforce on top of legal workflows; quotes start at $200/user/mo with multi-year commits.',
        ],
      },
      {
        heading: 'How to pick',
        body: [
          {
            web: 'Solo / small firm under 10 attorneys: full-stack wins. You don\'t want to maintain three vendors. [Advottic Solo at $59/user/mo](/pricing) is the cheapest reasonable option.',
            app: 'Solo / small firm under 10 attorneys: full-stack wins. You don\'t want to maintain three vendors. Advottic Solo is the simplest reasonable option.',
          },
          {
            web: 'Mid-market firm (10-50 attorneys) doing transactional work: full-stack with strong contract-AI. Advottic Small Firm at $99/user/mo, or Spellbook + a separate practice-management tool.',
            app: 'Mid-market firm (10-50 attorneys) doing transactional work: full-stack with strong contract-AI. Advottic Small Firm, or Spellbook + a separate practice-management tool.',
          },
          'Big-law (50+ attorneys) doing litigation: research copilot wins. CoCounsel + the firm\'s existing PMS.',
        ],
      },
    ],
    faq: [
      {
        q: 'Is legal AI safe to use for client work?',
        a: 'Modern legal AI tools sign business associate agreements (HIPAA), don\'t train on your data by default, and store your prompts in private workspaces. The historical concern - prompts leaking into model training data - has been addressed across the major vendors.',
      },
      {
        q: 'How accurate is AI-generated case law?',
        a: 'Tools that use retrieval-augmented generation against a real case-law database (CoCounsel, Harvey, Advottic via CourtListener) cite real cases. Tools that ask a generic LLM to cite cases without retrieval can hallucinate. Always verify with KeyCite or Shepard\'s before relying on a citation.',
      },
    ],
    cta: { label: 'Try Advottic free for 14 days', href: '/pricing' },
  },

  {
    slug: 'iolta-trust-accounting-explained',
    title:
      'IOLTA trust accounting explained (and how to get reconciliation right)',
    description:
      'What IOLTA is, the three-way reconciliation every state bar requires, and the most common audit-trigger mistakes solo and small firms make.',
    publishedAt: '2026-04-22T09:00:00Z',
    category: 'practice_management',
    keywords: [
      'IOLTA',
      'IOLTA reconciliation',
      'attorney trust account',
      'three-way reconciliation',
      'trust account compliance',
    ],
    readMinutes: 10,
    sections: [
      {
        heading: 'What IOLTA stands for',
        body: [
          'IOLTA is "Interest On Lawyers\' Trust Accounts." Every U.S. state requires attorneys who hold client funds (retainers, settlement proceeds, deposits) to keep those funds in a separate, interest-bearing trust account. The interest goes to the state bar foundation to fund legal-aid programs, not to the attorney or the client.',
        ],
      },
      {
        heading: 'Three-way reconciliation: the gold standard',
        body: [
          'Every month, three numbers must match exactly: (1) the sum of all client sub-ledger balances, (2) the firm\'s trust journal total, (3) the bank statement balance. If any of the three diverges, the firm has either a bookkeeping error or a compliance problem.',
          'State bars audit randomly and after client complaints. A failed reconciliation is one of the top three reasons for license suspension.',
        ],
      },
      {
        heading: 'The rules state bars actually enforce',
        body: [
          'No commingling: never combine personal or operating funds with client funds. Even temporarily.',
          'No drawing on uncollected funds: a client check that hasn\'t cleared cannot be disbursed against. This catches a lot of small firms when wires bounce.',
          'Separate sub-ledger per matter: aggregate balance is not enough. You must track each client\'s share inside the pool.',
          'Earned-fee transfers in writing: you can move retainer money out of trust as fees are earned, but only with a contemporaneous billing record.',
        ],
      },
      {
        heading: 'Common audit triggers',
        body: [
          'Negative client sub-balance: this NEVER happens correctly. It means you disbursed more than the client had on deposit. Fix immediately and document.',
          'Bank fees on the IOLTA account: most states require fees come out of the operating account, not the trust account. Banks misroute these all the time.',
          'Round-numbered reconciliation: the bank statement total ending in a clean .00 every month is a red flag for tampering.',
        ],
      },
      {
        heading: 'How software makes this easier',
        body: [
          {
            web: '[Advottic Counsel](/pricing) ships per-matter sub-ledgers, three-way reconciliation reports, and an auto-flag for negative client balances. Other practice management tools that handle IOLTA include Clio (separate Trust module), CosmoLex, and Smokeball.',
            app: 'Advottic Counsel ships per-matter sub-ledgers, three-way reconciliation reports, and an auto-flag for negative client balances. Other practice management tools that handle IOLTA include Clio (separate Trust module), CosmoLex, and Smokeball.',
          },
          'Whatever tool you pick, do not run trust accounting in QuickBooks. QuickBooks has no concept of a per-matter sub-ledger and the workarounds break down at scale.',
        ],
      },
    ],
    faq: [
      {
        q: 'How often should I reconcile my IOLTA?',
        a: 'Monthly, minimum. Quarterly reconciliation is the legal floor in most states; monthly catches errors before they compound.',
      },
      {
        q: 'What happens if my IOLTA is short?',
        a: 'A shortfall is a fiduciary breach. You report the discrepancy to your state bar, fund the difference from operating, and document the cause. Failure to report is far worse than the original mistake.',
      },
    ],
    cta: { label: 'See Advottic\'s IOLTA features', href: '/pricing' },
  },

  {
    slug: 'lease-termination-letter-template',
    title:
      'How to write a lease termination letter (free template, by state)',
    description:
      'Step-by-step guide to legally ending a lease. Notice periods by state, free template, security-deposit and inspection rules.',
    publishedAt: '2026-03-30T09:00:00Z',
    category: 'self_help',
    keywords: [
      'lease termination letter',
      'how to break a lease',
      '30 day notice template',
      'tenant notice to vacate',
    ],
    readMinutes: 7,
    sections: [
      {
        heading: 'The three reasons leases end',
        body: [
          'A lease can end three ways: the term expires, both parties agree to end early (mutual termination), or one party invokes a clause permitting unilateral termination (military deployment, habitability breach, lease cancellation rider). The notice rules differ for each.',
        ],
      },
      {
        heading: 'Notice periods by state (general rules)',
        body: [
          'Month-to-month tenancies: 30 days in most states; 60 days in California for tenancies over a year and in some other states.',
          'Fixed-term ending: technically you do not need notice (the lease just expires), but most landlords expect at least 30 days as a courtesy.',
          'Mid-lease termination for a habitability breach: varies widely. Most states require a written notice + a cure period (typically 7-14 days) before you can leave.',
        ],
      },
      {
        heading: 'What every termination letter needs',
        body: [
          '1. Date.',
          '2. Tenant name and current address.',
          '3. Landlord name and address.',
          '4. The exact termination date (and the lease provision or state law that permits it).',
          '5. Forwarding address for the security-deposit return.',
          '6. Optional: request for a pre-move-out inspection (required in California, recommended elsewhere).',
        ],
      },
      {
        heading: 'After you send it',
        body: [
          'Keep proof of delivery (certified mail return receipt or email confirmation). Document the unit\'s condition with timestamped photos. Provide the forwarding address - most states give the landlord 14-30 days to return the deposit, and the clock only runs once they have your address.',
        ],
      },
    ],
    cta: { label: 'Generate the letter with Bella', href: '/sign-in?next=/cases/new' },
  },

  {
    slug: 'nda-vs-confidentiality-agreement',
    title:
      'NDA vs confidentiality agreement: are they the same?',
    description:
      'The legal difference between an NDA and a confidentiality agreement, when to use each, and the four clauses that actually matter.',
    publishedAt: '2026-03-15T09:00:00Z',
    category: 'contracts',
    keywords: [
      'NDA vs confidentiality agreement',
      'mutual NDA',
      'unilateral NDA',
      'NDA template',
      'confidentiality clause',
    ],
    readMinutes: 6,
    sections: [
      {
        heading: 'They are the same document',
        body: [
          'There is no legal distinction between an NDA and a confidentiality agreement. The terms are used interchangeably. "NDA" is more common in tech and business; "confidentiality agreement" reads more formal and shows up in regulated industries (healthcare, finance, law).',
          'What matters is the SHAPE of the agreement, not the name. Two shapes exist.',
        ],
      },
      {
        heading: 'Mutual vs unilateral',
        body: [
          'Mutual: both sides may disclose confidential information and both sides have to protect it. Use this for partnership talks, due diligence, joint ventures.',
          'Unilateral: only one side discloses. Use for vendor relationships, employee contracts, individual contractor onboarding.',
        ],
      },
      {
        heading: 'The four clauses that actually matter',
        body: [
          '1. Definition of "Confidential Information": narrow + specific beats broad + vague every time. List the categories.',
          '2. Permitted uses: the recipient can use the information ONLY for the stated purpose. State the purpose.',
          '3. Carve-outs: information that becomes public, that the recipient already had, or that is independently developed. These are standard - if either side fights them, that is a flag.',
          '4. Term: 2-5 years for general business, longer for trade-secret protection (often perpetual until information becomes public).',
        ],
      },
      {
        heading: 'Skip the lawyer for routine NDAs',
        body: [
          'A standard mutual NDA does not require a billable hour. [Bella drafts a clean two-page mutual NDA](/sign-in?next=/cases/new) in two minutes from your party names + jurisdiction. Have a lawyer review only when one side proposes a 20-page custom NDA - those are usually the ones with bear traps.',
        ],
      },
    ],
    cta: { label: 'Draft a mutual NDA', href: '/sign-in?next=/cases/new' },
  },

  {
    slug: 'how-to-find-a-lawyer',
    title: 'How to find a lawyer (without paying $400 to be told to call back)',
    description:
      'A practical guide to picking a lawyer without wasting consultation fees. Where to look, what to ask, and red flags to walk away from.',
    publishedAt: '2026-04-08T09:00:00Z',
    category: 'self_help',
    keywords: [
      'how to find a lawyer',
      'find a lawyer near me',
      'free legal consultation',
      'lawyer referral service',
    ],
    readMinutes: 7,
    sections: [
      {
        heading: 'Decide what kind of lawyer you need',
        body: [
          'Lawyers specialize. A good criminal defense attorney is a bad estate planner. A great corporate transactional lawyer cannot help you with a custody dispute. The first thing you decide is the practice area.',
          'Common buckets: family law (divorce, custody, adoption), personal injury, criminal defense, employment, immigration, business / contracts, real estate, intellectual property, estate planning, bankruptcy, tax.',
        ],
      },
      {
        heading: 'Where to actually look',
        body: [
          'Your state bar\'s referral service: every state bar runs a free directory. The lawyers listed there are licensed and in good standing. This is the safest first stop.',
          'Legal aid: if your income falls below ~125%-200% of the federal poverty line, you qualify for free representation through your local legal-aid organization. LSC.gov has a state-by-state directory.',
          'Marketplaces: [/find-counsel](/find-counsel) on Advottic matches you to firms that handle your matter type in your state. Other marketplaces include Avvo, Justia, and Martindale-Hubbell.',
          'Personal referrals: still the highest-conversion source. If a friend used a lawyer they liked, ask for the introduction.',
        ],
      },
      {
        heading: 'Questions to ask in the consultation',
        body: [
          '1. How many cases like mine have you handled in the last year?',
          '2. What outcomes did those cases reach?',
          '3. Will you handle this personally, or pass it to an associate?',
          '4. What is your fee structure? Hourly + rate, flat fee, contingency?',
          '5. What is your best-case timeline, and what would push it longer?',
          '6. What is the worst realistic outcome if I lose?',
        ],
      },
      {
        heading: 'Red flags to walk away from',
        body: [
          'Guarantees of outcome: no ethical lawyer guarantees winning. Lawyers who do are violating bar rules.',
          'Pressure to sign on the spot: legitimate firms send the engagement letter home for review.',
          'No retainer agreement: every state bar requires a written engagement letter before billable work starts.',
          'Bad reviews about communication: missing motions and missed calls cost cases. Read recent reviews specifically about responsiveness.',
        ],
      },
    ],
    cta: { label: 'Get matched with a vetted firm', href: '/find-counsel' },
  },

  {
    slug: 'best-practice-management-software',
    title:
      'Best practice management software for solo and small law firms (2026 roundup)',
    description:
      'Honest comparison of Clio, MyCase, PracticePanther, Smokeball, Rocket Matter, and Advottic. Real pricing, real shape of the products.',
    publishedAt: '2026-04-29T09:00:00Z',
    category: 'practice_management',
    keywords: [
      'best practice management software',
      'law firm software',
      'Clio alternative',
      'MyCase vs PracticePanther',
      'small law firm software',
    ],
    readMinutes: 11,
    sections: [
      {
        heading: 'What practice-management software actually does',
        body: [
          'A practice-management system (PMS) is the database of record for the firm. Every case file, every client, every billable hour, every dollar in trust. The PMS is the backbone; everything else (e-sign, AI, court filing) plugs into it.',
          'Picking the wrong PMS is expensive: data migration off Clio to a competitor is typically a $5k-$25k project plus a month of lost productivity.',
        ],
      },
      {
        heading: 'The full-stack tier',
        body: [
          {
            web: '[Advottic](/) - $59-$149 per user per month. Bundles AI (Bella), case management, e-signature, IOLTA, intake / conflict checking, marketplace, real-time team chat. Single tenant; no add-ons. Best for solo and small firms that want one tool.',
            app: '[Advottic](/) - bundles AI (Bella), case management, e-signature, IOLTA, intake / conflict checking, marketplace, real-time team chat. Single tenant; no add-ons. Best for solo and small firms that want one tool.',
          },
          'Clio Manage - $69-$129 per user per month. Largest install base, most third-party integrations. AI (Duo) is a $50/seat add-on. IOLTA works but is a separate module. Best for established firms that already use the Clio ecosystem.',
          'Smokeball - $49-$199 per user per month. Strong document automation; weaker AI. Australian roots; recent US push. Best for firms doing high-volume transactional work (estate planning, immigration).',
        ],
      },
      {
        heading: 'The price-fighter tier',
        body: [
          'MyCase - $49-$89 per user per month. Owned by AffiniPay (LawPay). Solid IOLTA via the LawPay integration. Best for firms that already use LawPay for credit-card payments.',
          'PracticePanther - $49-$89 per user per month. Owned by Paradigm (the Affinipay competitor). Similar feature set to MyCase. Long-tenured; reliable.',
          'Rocket Matter - $39-$89 per user per month. The cheapest option that still does the job for a solo. Limited AI. Strong document assembly.',
        ],
      },
      {
        heading: 'How to actually pick',
        body: [
          '1. Start with a 14-day free trial of two tools. Both Clio and Advottic offer them.',
          '2. Migrate ten real cases. Not test data - actual cases with documents and time entries. Most products fall apart on real data.',
          '3. Run a billing cycle on each. Generate the invoices, send them, mark them paid, run the trust reconciliation. Whichever tool felt smoothest is the answer.',
          '4. Read the data export terms. You want CSV exports of every table on demand, not "contact support."',
        ],
      },
    ],
    cta: { label: 'Try Advottic Counsel free for 14 days', href: '/pricing' },
  },

  {
    slug: 'electronic-signature-legally-binding',
    title:
      'Are electronic signatures legally binding? (UETA + E-SIGN explained)',
    description:
      'When e-signatures are valid, when they are not, and the four requirements every binding e-signed document must meet.',
    publishedAt: '2026-04-02T09:00:00Z',
    category: 'compliance',
    keywords: [
      'electronic signature legally binding',
      'e-signature law',
      'UETA',
      'E-SIGN Act',
      'is DocuSign legal',
    ],
    readMinutes: 9,
    sections: [
      {
        heading: 'The short answer: yes, mostly',
        body: [
          'Electronic signatures are legally binding in all 50 U.S. states under the federal E-SIGN Act (2000) and the Uniform Electronic Transactions Act (UETA, adopted by 49 states - New York has its own analogue). A document e-signed under these regimes has the same legal effect as a wet-ink signature.',
          'But every word of that sentence has carve-outs. Read on.',
        ],
      },
      {
        heading: 'Four requirements every e-signature must meet',
        body: [
          '1. Intent to sign: the signer must affirmatively indicate they intend the mark to be their signature. Clicking a "Sign" button after seeing the document satisfies this; clicking "Continue" through a flow does not.',
          '2. Consent to electronic delivery: the signer must agree to receive the document electronically. Most platforms surface this as a separate disclosure with a separate checkbox.',
          '3. Reasonable association: the signature must be reasonably associated with the document. A free-floating signature image is weak; a tamper-evident audit trail tying the signature to the document\'s SHA-256 hash is strong.',
          '4. Record retention: both parties must be able to retain a copy. The document and the audit trail must be reproducible later.',
        ],
      },
      {
        heading: 'What you cannot e-sign',
        body: [
          'Wills and codicils (most states; a few have started to allow electronic wills under specific procedures).',
          'Real-estate deeds and conveyances in many states. Real-estate purchase contracts are usually fine; the deed itself often needs a notary.',
          'Court orders.',
          'Adoption-related documents.',
          'Some UCC negotiable instruments (Article 3 paper).',
          'Most family-law judgments.',
          'Always verify with your jurisdiction.',
        ],
      },
      {
        heading: 'How Advottic\'s e-signature stacks up',
        body: [
          '[Advottic](/) ships UETA-aligned signing with: a separate electronic-records disclosure step, an explicit intent-to-sign checkbox, a SHA-256 hash of the document captured at signing-request creation, and a tamper-evident hash chain across every event (sent, viewed, signed, completed).',
          'Whether the resulting signature is binding for a specific document class in a specific state remains a question for counsel - we surface the warning every time.',
        ],
      },
    ],
    faq: [
      {
        q: 'Is a typed name a valid e-signature?',
        a: 'Yes, under UETA - intent to sign is the controlling factor, not the form of the mark. Most platforms accept typed, drawn, or uploaded signature marks.',
      },
      {
        q: 'Do I need a witness for an e-signature?',
        a: 'For most contracts, no. For documents that traditionally require witnesses (some real estate, wills), the witness rule survives the move to electronic - which is why those documents are often carved out.',
      },
    ],
    cta: { label: 'Send a UETA-aligned signing request', href: '/sign-in' },
  },

  {
    slug: 'small-claims-court-process',
    title: 'Small claims court: how to sue someone for under $10,000',
    description:
      'Step-by-step guide to small claims court. Filing fees, jurisdictional limits by state, what to bring, how to collect after you win.',
    publishedAt: '2026-05-08T09:00:00Z',
    category: 'self_help',
    keywords: [
      'small claims court',
      'how to sue someone',
      'small claims process',
      'small claims jurisdictional limit',
    ],
    readMinutes: 9,
    sections: [
      {
        heading: 'What small claims court is for',
        body: [
          'Small claims court is the legal system\'s on-ramp for disputes too small to justify a full lawyer-driven lawsuit. Most jurisdictions cap small claims at $5,000-$25,000. Filing fees run $30-$100. The judge hears your case in 10-20 minutes; no jury, often no lawyers, plain-English questions.',
          'It is the right venue for unpaid invoices, broken contracts, security-deposit disputes, minor property damage, and consumer claims against a business. It is the wrong venue for personal injury (often), employment claims (usually), or anything requiring complex discovery.',
        ],
      },
      {
        heading: 'Jurisdictional limits by state (2026)',
        body: [
          'Limits change. Check your state court\'s public website before filing. As of 2026: California $12,500 (individuals), New York City $10,000, Texas $20,000, Florida $8,000, Illinois $10,000. Plaintiffs that are businesses often face lower limits than individuals.',
          'You are bound by the cap. If you sue for $4,999 and your damages are $7,000, you waive the $2,001 difference. Plan accordingly.',
        ],
      },
      {
        heading: 'The 5-step process',
        body: [
          '1. **Send a demand letter first.** Many courts require proof of a pre-suit demand attempt. [Our demand letter guide](/resources/how-to-write-a-demand-letter) covers what to say and how.',
          '2. **File the complaint.** Pay the filing fee. The clerk gives you a case number, a court date (typically 30-90 days out), and a service packet for the defendant.',
          '3. **Serve the defendant.** Most states require sheriff service, process server, or certified mail with return receipt. Personal service by you (the plaintiff) is usually not allowed.',
          '4. **Show up prepared.** Bring three copies of every document, a one-page chronology of what happened, your demand letter with proof of service, and an itemized damages calculation.',
          '5. **Collect after you win.** A judgment is just a piece of paper. Collection - wage garnishment, bank levy, property lien - is a separate process in most states. Budget another 3-12 months.',
        ],
      },
      {
        heading: 'What to bring to court',
        body: [
          'The case is decided on what you can prove, not what you remember. Bring: written contracts, emails / texts (printed, with timestamps), photos of damage, receipts, repair estimates, witness statements (or witnesses themselves), your demand letter and proof of delivery, an itemized damages spreadsheet.',
          'Show up 30 minutes early. Dress like you would for a job interview. Address the judge as "Your Honor". Speak briefly, factually, and only when asked.',
        ],
      },
      {
        heading: 'Skip the chaos - prep with Advottic',
        body: [
          {
            web: '[Advottic](/) builds your small-claims case file in 15 minutes: drag in receipts and photos, write a 3-sentence narrative, and Bella generates the demand letter, chronology, itemized damages, and exhibit binder. Free for the first case; $19/mo for unlimited on [Personal Pro](/pricing).',
            app: '[Advottic](/) builds your small-claims case file in 15 minutes: drag in receipts and photos, write a 3-sentence narrative, and Bella generates the demand letter, chronology, itemized damages, and exhibit binder. Free for the first case; unlimited cases are included with a subscription on your account.',
          },
        ],
      },
    ],
    faq: [
      {
        q: 'Can I have a lawyer in small claims court?',
        a: 'Most states bar attorney representation in small claims; some allow it (Pennsylvania, Illinois). Check your state. The whole point of small claims is that ordinary people can represent themselves.',
      },
      {
        q: 'What if the defendant does not show up?',
        a: 'You typically win by default. The judge will still ask for proof of your damages, but the absence of any defense almost always tips the result your way. You still need to collect.',
      },
      {
        q: 'Can I appeal a small claims decision?',
        a: 'Yes, but limited. Most states allow only the defendant to appeal, or limit appeals to questions of law (not factual disputes). Read your state\'s rules carefully.',
      },
    ],
    cta: { label: 'Build your case file with Bella', href: '/sign-in?next=/cases/new' },
  },

  {
    slug: 'attorney-engagement-letter',
    title: 'Attorney engagement letter: what it does and what to look for',
    description:
      'Plain-English guide to attorney engagement letters: scope of representation, fee structure, conflict checks, termination clauses, and red flags to watch for.',
    publishedAt: '2026-05-08T10:00:00Z',
    category: 'self_help',
    keywords: [
      'attorney engagement letter',
      'retainer agreement',
      'lawyer engagement letter',
      'engagement letter template',
    ],
    readMinutes: 7,
    sections: [
      {
        heading: 'What an engagement letter does',
        body: [
          'An engagement letter is the contract between you and your attorney. It defines what they will do, what they will charge, and what they will not do. Almost every state\'s bar requires one for any representation beyond a free consultation.',
          'A good engagement letter protects both parties. It removes ambiguity about scope, fees, and exit terms. A bad engagement letter (or no letter at all) is the #1 source of fee disputes and bar complaints.',
        ],
      },
      {
        heading: 'The 7 elements every engagement letter has',
        body: [
          '1. **Scope of representation.** What specific matter is covered? "All your legal needs" is too broad and unenforceable.',
          '2. **Fee structure.** Hourly, flat fee, contingency, or hybrid. Hourly rates by role (partner / associate / paralegal). When fees are billed and when they are due.',
          '3. **Retainer and replenishment.** How much do you pay upfront? Where is it held (trust account)? When and how is it replenished?',
          '4. **Conflict check.** A statement that the firm has run conflict screens against you and the opposing parties, with consent to any waivable conflicts.',
          '5. **Communication expectations.** How often will the attorney update you? Within what time window will they return calls and emails?',
          '6. **Termination rights.** How can either party end the relationship? What happens to fees on termination?',
          '7. **Dispute resolution.** What happens if you and the attorney disagree on a bill or the work? Most letters include a fee-arbitration clause.',
        ],
      },
      {
        heading: 'Red flags to watch for',
        body: [
          '**Vague scope.** "We will represent you in your matter" is not a scope. Demand specifics: what filings, what hearings, what stage of the case.',
          '**Non-refundable retainer.** Most state bars require unearned fees to be returned. A clause that says "the retainer is non-refundable" is often unenforceable. Push back or walk away.',
          '**No conflict disclosure.** The letter should affirmatively state the firm has run conflict checks. Silence on this point is a yellow flag.',
          '**One-sided termination.** If the lawyer can fire you for any reason but you can only fire them with cause, that\'s an unfair clause. Get it changed.',
          '**Auto-replenish clauses.** Some letters auto-debit your bank account to top up the retainer. Insist on review and approval before each replenishment.',
        ],
      },
      {
        heading: 'How Bella reviews your engagement letter',
        body: [
          {
            web: 'Drop the PDF into [Advottic\'s contract review](/review-my-document). Bella flags missing elements, unusual clauses, and red flags against the standard market position for your state. Free for the first three reviews; $19/mo for unlimited.',
            app: 'Drop the PDF into [Advottic\'s contract review](/review-my-document). Bella flags missing elements, unusual clauses, and red flags against the standard market position for your state. Free for the first three reviews; unlimited reviews are included with a subscription on your account.',
          },
        ],
      },
    ],
    faq: [
      {
        q: 'Do I have to sign the engagement letter as written?',
        a: 'No. Engagement letters are negotiable. Reasonable attorneys expect questions and revisions. If your attorney refuses to negotiate any term, that itself is a signal about their flexibility on other things.',
      },
      {
        q: 'Can I fire my attorney mid-case?',
        a: 'Yes, you almost always can, but check the termination clause for what happens to unbilled work and your file. See [our guide on firing your lawyer](/resources/how-to-fire-your-lawyer) for the full process.',
      },
      {
        q: 'What if my attorney never gave me an engagement letter?',
        a: 'Most state bars require one. The absence of a written engagement letter is a serious ethics issue for the attorney and gives you significant leverage in any fee dispute. Ask for one in writing; if they refuse, contact your state bar.',
      },
    ],
    cta: { label: 'Have Bella review your letter', href: '/sign-in?next=/review-my-document' },
  },

  {
    slug: 'statute-of-limitations',
    title: 'Statute of limitations: how long you have to sue, by claim type',
    description:
      'Plain-English guide to the statute of limitations. Standard windows by claim type (contract, tort, personal injury), tolling rules, and how to find your state\'s deadline.',
    publishedAt: '2026-05-08T11:00:00Z',
    category: 'self_help',
    keywords: [
      'statute of limitations',
      'how long do I have to sue',
      'time limit to sue',
      'statute of limitations by state',
    ],
    readMinutes: 8,
    sections: [
      {
        heading: 'Why the deadline matters more than the merits',
        body: [
          'The statute of limitations is the legal clock that starts the moment you have a claim. If the clock runs out before you file, your case is over - no matter how strong it is on the merits.',
          'Defendants rarely volunteer this. They wait, they delay, they negotiate in bad faith. The moment your filing deadline passes, they file a motion to dismiss based on the time bar. You lose without a hearing on the actual dispute.',
        ],
      },
      {
        heading: 'Standard windows by claim type',
        body: [
          'These are typical (not universal) windows. Your state\'s actual rule may differ.',
          '**Personal injury (negligence):** 1-4 years from the date of injury. Most common: 2 years.',
          '**Breach of written contract:** 4-6 years from the date of breach. Most common: 4 years.',
          '**Breach of oral contract:** 2-4 years from the date of breach. Most common: 3 years.',
          '**Fraud:** 3-6 years, often from when the fraud was *discovered*, not when it happened.',
          '**Property damage:** 2-3 years from the date of damage.',
          '**Wrongful death:** 1-3 years from the date of death.',
          '**Wage claims (unpaid wages):** 2-3 years under federal law (FLSA); state laws often extend further.',
          '**Defamation:** 1-2 years from publication.',
        ],
      },
      {
        heading: 'When the clock pauses (tolling)',
        body: [
          'The clock can pause - "toll" - in specific circumstances:',
          '**Minority.** If the plaintiff is under 18, the clock typically does not start running until they turn 18 (with claim-type variations).',
          '**Disability or incapacity.** Some states pause the clock during periods of mental incapacity.',
          '**Defendant unavailability.** If the defendant has left the state or is hiding, the clock may pause.',
          '**Discovery rule.** For some claims (fraud, medical malpractice), the clock starts when the injury was *discovered or should have been discovered*, not when it happened.',
          '**Continuing violation.** For ongoing harms (some employment claims), the clock may reset with each new violation.',
        ],
      },
      {
        heading: 'How to find your state\'s exact rule',
        body: [
          'Three sources, in order of reliability:',
          '1. Your state\'s code (e.g., California Code of Civil Procedure §§ 312-366). Free, authoritative, sometimes confusing.',
          '2. Your state bar\'s public-information pages.',
          '3. A consultation with a local attorney - usually free for a 15-minute call.',
          'Do NOT rely on AI-generated "statute of limitations by state" tables without verification. Statutes change; outdated tables ruin cases.',
        ],
      },
      {
        heading: 'Track deadlines with Bella',
        body: [
          'When you create a case in [Advottic](/), Bella asks for the claim type and the date of injury (or breach), looks up the relevant statute of limitations for your state, and adds the filing deadline to your case calendar with reminders at 90, 30, and 7 days out. Free at every tier.',
        ],
      },
    ],
    faq: [
      {
        q: 'Can a statute of limitations be extended by agreement?',
        a: 'Sometimes. "Tolling agreements" between parties can extend the deadline by mutual consent, typically used during settlement negotiations. Get it in writing and check that your state allows tolling agreements for your claim type.',
      },
      {
        q: 'What happens if I file one day late?',
        a: 'The defendant will move to dismiss. Some courts allow narrow exceptions (e.g., the courthouse was closed); most will dismiss. Treat the deadline as immovable.',
      },
      {
        q: 'Does sending a demand letter pause the clock?',
        a: 'No. A demand letter is a settlement tool, not a tolling event. The clock continues to run. If you are close to the deadline, file first and negotiate after.',
      },
    ],
    cta: { label: 'Track your deadlines with Bella', href: '/sign-in?next=/cases/new' },
  },

  {
    slug: 'how-to-fire-your-lawyer',
    title: 'How to fire your lawyer (and find a new one)',
    description:
      'Plain-English guide to firing your attorney. Termination letter template, what happens to your file and fees, how to find replacement counsel, when to report to the bar.',
    publishedAt: '2026-05-09T09:00:00Z',
    category: 'self_help',
    keywords: [
      'fire my lawyer',
      'discharge attorney',
      'fire your attorney',
      'switch lawyers mid-case',
    ],
    readMinutes: 7,
    sections: [
      {
        heading: 'You almost always have the right to fire',
        body: [
          'Clients have a near-absolute right to discharge their attorney at any time, for any reason or no reason. Most states require only written notice. The attorney does not have to agree.',
          'The exception: if you are in active litigation, the court may require approval before the attorney can withdraw, especially close to trial. The court rarely refuses but may impose conditions.',
        ],
      },
      {
        heading: 'Common reasons people fire their attorney',
        body: [
          '**Communication failure.** No returned calls, no case updates, no answers. This is the #1 cause.',
          '**Strategic disagreement.** You and the attorney disagree on settlement, on whether to file a motion, on case strategy.',
          '**Fee dispute.** Surprise bills, padded hours, refusal to itemize.',
          '**Loss of confidence.** They missed a deadline, mishandled a witness, said something in court that hurt you.',
          '**Conflict of interest.** New information reveals the attorney has a conflict they did not disclose.',
        ],
      },
      {
        heading: 'The termination letter (template)',
        body: [
          'Send by certified mail with return receipt. Email is fine as a same-day backup, but certified mail is the proof.',
          '> "Dear [Attorney Name],"',
          '> ',
          '> "I am writing to terminate our attorney-client relationship effective immediately. Please cease all work on my matter."',
          '> ',
          '> "Please send me a complete copy of my file - all documents, correspondence, pleadings, and work product - within 14 days. Per [your state] Rule of Professional Conduct 1.16(d), the file belongs to me."',
          '> ',
          '> "Please send a final itemized invoice for work performed through today\'s date. I expect any unearned retainer to be returned within 30 days."',
          '> ',
          '> "I will retain new counsel and they will contact you about a smooth transition."',
          '> ',
          '> "Sincerely, [Your Name]"',
        ],
      },
      {
        heading: 'What happens to your file and money',
        body: [
          '**The file is yours.** Across all 50 states, the client owns the file. The attorney must return it on request, even if you owe outstanding fees (with narrow exceptions for some work product).',
          '**Unearned retainer must be returned.** Money sitting in the trust account that has not been billed against is yours. Demand a return within 30 days.',
          '**Earned fees through termination are owed.** If the attorney worked 10 hours before you fired them at $300/hr, you owe $3,000. They cannot charge for future work they did not do.',
          '**Contingency cases are different.** If your attorney was working on contingency, they may have a quantum meruit claim for the value of work done before discharge, against any recovery you eventually get.',
        ],
      },
      {
        heading: 'Finding new counsel',
        body: [
          'Three paths, in order of speed:',
          '1. **[Advottic Find Counsel](/find-counsel).** Submit a brief about your matter; Advottic Counsel firms in your state with relevant experience respond within 24 hours. Free.',
          '2. **Your state bar lawyer referral service.** Most state bars offer free 30-minute consultations through their referral programs.',
          '3. **Trusted personal referral.** Ask people in your industry who have used a lawyer for similar work.',
        ],
      },
      {
        heading: 'When to report to the bar',
        body: [
          'File a complaint with your state bar if your former attorney:',
          '- Refuses to return your file',
          '- Refuses to return unearned retainer',
          '- Mishandled trust funds (commingling, missing money)',
          '- Lied to the court on your behalf',
          '- Missed a deadline that hurt your case',
          'Bar complaints are free. The bar investigates. Most complaints end in private resolution; egregious cases end in discipline up to disbarment.',
        ],
      },
    ],
    faq: [
      {
        q: 'Will firing my lawyer hurt my case?',
        a: 'It depends. If you are mid-trial, switching is disruptive and the court may require strong cause. If you are pre-suit or in early discovery, switching is routine. New counsel can usually catch up in 1-2 weeks.',
      },
      {
        q: 'Can my old lawyer keep my file until I pay them?',
        a: 'In most states no, with narrow exceptions for work product. Even if you owe fees, the client file generally must be returned. Refusal can be reported to the bar.',
      },
      {
        q: 'How long does my old lawyer have to respond?',
        a: 'There is no universal rule, but 14-21 days is the working norm. If they exceed 30 days without responding, follow up in writing and consider a bar complaint.',
      },
    ],
    cta: { label: 'Find new counsel today', href: '/find-counsel' },
  },

  {
    slug: 'power-of-attorney-explained',
    title: 'Power of attorney explained (with template)',
    description:
      'Plain-English guide to power of attorney. Types (general, durable, healthcare), what it does, what it does not, how to revoke, and a free template.',
    publishedAt: '2026-05-09T10:00:00Z',
    category: 'self_help',
    keywords: [
      'power of attorney',
      'POA',
      'durable power of attorney',
      'healthcare power of attorney',
      'power of attorney template',
    ],
    readMinutes: 7,
    sections: [
      {
        heading: 'What a power of attorney is',
        body: [
          'A power of attorney (POA) is a legal document that lets you (the "principal") give someone else (the "agent" or "attorney-in-fact") authority to act on your behalf. The agent does not have to be a lawyer; usually a spouse, adult child, sibling, or trusted friend.',
          'A POA does NOT take away your own rights. You can still act for yourself as long as you are competent. The POA gives the agent *additional* authority - typically used when you are unavailable, incapacitated, or want help managing complex matters.',
        ],
      },
      {
        heading: 'Five common types',
        body: [
          '**General POA.** Broad authority over most legal and financial decisions. Ends if you become incapacitated.',
          '**Durable POA.** Like general, but *continues* even if you become incapacitated. This is what people usually want for estate planning.',
          '**Springing POA.** Takes effect only when a specific event happens (you become incapacitated, you leave the country). Cleaner in theory but harder to use - someone has to prove the trigger happened.',
          '**Limited (or special) POA.** Narrow scope: sign a single contract, sell one specific property, file one set of taxes. Ends when the task is done.',
          '**Healthcare POA (advance directive).** Authority over medical decisions only. Separate from financial POA in most states.',
        ],
      },
      {
        heading: 'What a POA cannot do',
        body: [
          'A POA does not let your agent:',
          '- Write a will or revoke yours',
          '- Vote for you in an election',
          '- Marry on your behalf',
          '- Testify under oath for you',
          '- Act after you die (the POA dies with you - that\'s what an executor is for)',
          '- Override your direct instructions while you are competent',
        ],
      },
      {
        heading: 'How to create one',
        body: [
          '1. **Pick your agent carefully.** This is the most important step. The agent should be trustworthy, available, and competent to manage your affairs.',
          '2. **Use your state\'s form or template.** Many states have official statutory POA forms. Using the official form removes ambiguity about validity.',
          '3. **Sign with witnesses and (usually) a notary.** Most states require at least one witness; many require notarization. Healthcare POAs sometimes have stricter rules.',
          '4. **Give copies to who needs them.** Original to your agent. Copy to your bank, your doctor, your healthcare proxy. Keep a copy with your other estate documents.',
          '5. **Revisit annually.** Life changes - divorces, deaths, moves. Update the POA when the named agent is no longer the right choice.',
        ],
      },
      {
        heading: 'Drafting your POA with Bella',
        body: [
          {
            web: '[Bella](/) drafts state-specific POA forms in 5 minutes from a short interview: who is the principal, who is the agent, what type, what powers. The output is a state-compliant draft ready for signing and notarization. Free for the first three drafts; $19/mo for unlimited on [Personal Pro](/pricing).',
            app: '[Bella](/) drafts state-specific POA forms in 5 minutes from a short interview: who is the principal, who is the agent, what type, what powers. The output is a state-compliant draft ready for signing and notarization. Free for the first three drafts; unlimited drafts are included with a subscription on your account.',
          },
        ],
      },
    ],
    faq: [
      {
        q: 'How do I revoke a power of attorney?',
        a: 'Sign a written revocation, deliver it to the agent and to anyone who has a copy (banks, doctors). Some states require the revocation to be recorded if the original POA was recorded. Then physically destroy or mark every copy "REVOKED".',
      },
      {
        q: 'Can I have more than one agent?',
        a: 'Yes - co-agents. They can be required to act jointly (both sign) or independently (either can sign). Joint is safer but slower; independent is faster but riskier.',
      },
      {
        q: 'Does a POA need to be notarized?',
        a: 'Almost always for financial POAs; sometimes for healthcare POAs. Notarization makes the document accepted by banks, real estate offices, and courts. Skip it and you may have to re-execute.',
      },
    ],
    cta: { label: 'Draft a POA with Bella', href: '/sign-in?next=/cases/new' },
  },

  {
    slug: 'how-to-start-an-llc',
    title: 'How to start an LLC (step by step, by state)',
    description:
      'Plain-English guide to LLC formation. State filing fees, operating agreements, EIN, separating business and personal, tax election timing.',
    publishedAt: '2026-05-09T11:00:00Z',
    category: 'self_help',
    keywords: [
      'how to start an LLC',
      'LLC formation',
      'forming an LLC',
      'LLC filing fees by state',
    ],
    readMinutes: 8,
    sections: [
      {
        heading: 'When you need an LLC',
        body: [
          'An LLC (limited liability company) separates your business from your personal assets. If the business gets sued, your house and savings are (generally) protected. If you are operating any business that has even a small chance of being sued, an LLC is the cheapest meaningful liability shield.',
          'You do not need an LLC for a hobby that earns a few hundred dollars a year. You do need one if you sign contracts, hire help, or produce a product or service that could plausibly harm someone.',
        ],
      },
      {
        heading: 'The 6-step process',
        body: [
          '1. **Pick a name.** Must be unique in your state. Check via your secretary of state\'s business name database (free, online). Add "LLC" or "L.L.C." to the end as required by most states.',
          '2. **Choose your registered agent.** A person or service at a physical address in your state who can receive legal mail. You can be your own (if your address is in-state and you are available during business hours), but most owners use a service ($50-150/year).',
          '3. **File the articles of organization.** Online or by mail with your secretary of state. Filing fee varies wildly: California $70, Delaware $90, Florida $125, Texas $300, Massachusetts $500.',
          '4. **Get an EIN from the IRS.** Free, online, takes 5 minutes at IRS.gov. Required for opening a business bank account and hiring employees.',
          '5. **Draft an operating agreement.** Even single-member LLCs benefit. The agreement defines ownership, distributions, decision-making, and what happens when a member leaves. Most states do not require filing the operating agreement - just signing it.',
          '6. **Open a business bank account.** With your articles of organization, EIN, and operating agreement. NEVER mix personal and business funds - it is the #1 way to lose your liability shield.',
        ],
      },
      {
        heading: 'Filing fees by state (2026)',
        body: [
          'Initial filing fees vary 10x by state. Some states also charge annual reports / franchise taxes:',
          '**Cheap states:** Kentucky $40, Mississippi $50, Arkansas $50, New Mexico $50.',
          '**Mid-range:** California $70 (but with annual $800 franchise tax that crushes small LLCs), Delaware $90 ($300 annual franchise tax), Florida $125.',
          '**Expensive:** Tennessee $300, Texas $300, Massachusetts $500, California with annual taxes can run $900+/year.',
          'Pick the state where you actually operate. Filing in Delaware "for tax benefits" usually does not work for small operations - you still have to register as a foreign LLC in your home state, doubling the cost.',
        ],
      },
      {
        heading: 'Operating agreement basics',
        body: [
          'The operating agreement is the LLC\'s internal contract. Cover these in writing:',
          '**Ownership.** Who owns what percentage? Initial capital contributions.',
          '**Voting and decisions.** Unanimous? Majority? By percentage of ownership?',
          '**Distributions.** When does the LLC pay out profits? In what proportion?',
          '**Management structure.** Member-managed (everyone) or manager-managed (one designated manager)?',
          '**Buyout terms.** What happens if a member wants to leave, gets divorced, dies, or becomes incapacitated? Valuation method?',
          '**Tax treatment.** Will you elect to be taxed as a partnership (default), S-corporation, or C-corporation?',
        ],
      },
      {
        heading: 'Skip the templates - draft with Bella',
        body: [
          {
            web: '[Bella](/) drafts state-compliant articles of organization and operating agreements from a 5-minute interview. Free for the first three drafts; $19/mo for unlimited on [Personal Pro](/pricing). For LLCs with multiple members or unusual tax situations, [Find Counsel](/find-counsel) connects you with a small-firm attorney for a fixed-fee formation.',
            app: '[Bella](/) drafts state-compliant articles of organization and operating agreements from a 5-minute interview. Free for the first three drafts; unlimited drafts are included with a subscription on your account. For LLCs with multiple members or unusual tax situations, [Find Counsel](/find-counsel) connects you with a small-firm attorney for a fixed-fee formation.',
          },
        ],
      },
    ],
    faq: [
      {
        q: 'Single-member LLC vs multi-member LLC for taxes?',
        a: 'Single-member LLCs are taxed as sole proprietorships by default (everything on Schedule C of your personal return). Multi-member LLCs are taxed as partnerships by default. Either can elect S-corp or C-corp treatment.',
      },
      {
        q: 'Do I need an operating agreement if I am the only owner?',
        a: 'Most states do not require it. You should still write one - it establishes the LLC as a separate entity (helps preserve the liability shield), governs what happens if you add owners or die, and is often required to open business bank accounts.',
      },
      {
        q: 'Should I form my LLC in Delaware?',
        a: 'Probably not, unless you are raising VC funding or have multi-state operations. For most small businesses, your home state is cheaper and simpler. Delaware\'s advantages mostly apply to corporations and large LLCs.',
      },
    ],
    cta: { label: 'Draft LLC docs with Bella', href: '/sign-in?next=/cases/new' },
  },

  {
    slug: 'what-is-probate',
    title: 'What is probate (and how to avoid it)?',
    description:
      'Plain-English guide to probate. What it is, how long it takes, how much it costs, and the 3 most effective ways to avoid it (trust, JTWROS, payable-on-death).',
    publishedAt: '2026-05-10T09:00:00Z',
    category: 'self_help',
    keywords: [
      'what is probate',
      'how to avoid probate',
      'probate process',
      'probate vs trust',
    ],
    readMinutes: 7,
    sections: [
      {
        heading: 'What probate actually is',
        body: [
          'Probate is the court-supervised process of transferring a deceased person\'s assets to their heirs. The court validates the will (if there is one), pays the estate\'s debts, and distributes whatever is left.',
          'Probate is not inherently bad - it provides clear title to assets and protects heirs from creditor claims. It is just slow (6-18 months on average), expensive (3-7% of estate value in court costs and attorney fees), and public (anyone can read your will and asset inventory).',
        ],
      },
      {
        heading: 'How long it takes and what it costs',
        body: [
          'Timeline: typical probate runs 6-18 months in most states. Complex estates with disputes can take 2-5 years. Heirs do not receive distributions until the process is well underway.',
          'Cost: attorney fees in many states are set by statute, often 3-7% of gross estate value (California is famously high). On a $500k estate, that\'s $15k-$35k of attorney fees alone, plus court costs and executor fees.',
          'Privacy: probate documents are public. Anyone can pull your will, asset inventory, and creditor list at the courthouse. For many families, this is the most painful surprise.',
        ],
      },
      {
        heading: 'Three ways to skip probate',
        body: [
          '**1. Revocable living trust.** You create a trust, transfer assets into it during your life, and name a successor trustee. On your death, the successor trustee distributes assets per the trust terms - no court involvement. Trusts cost $1,500-$3,500 to set up, save $15,000-$50,000+ on probate for typical estates.',
          '**2. Joint tenancy with right of survivorship (JTWROS).** Assets held jointly with another person pass automatically to the surviving owner on death. Common for spouses on the home. Watch out: makes the asset reachable by the co-owner\'s creditors during your life.',
          '**3. Beneficiary designations.** Retirement accounts, life insurance, and bank accounts can be set up with "payable on death" (POD) or "transfer on death" (TOD) designations. Funds bypass probate and go directly to the named beneficiary.',
        ],
      },
      {
        heading: 'When you still need probate',
        body: [
          'Even with good estate planning, probate is usually needed when:',
          '- A solely-owned asset was not put into the trust (a forgotten bank account, a car).',
          '- Beneficiary designations are out of date (ex-spouse still named on a 401(k)).',
          '- There are unsettled creditor claims that need court supervision to resolve.',
          'Many states have "small estate" procedures that bypass full probate for estates under $50k-$200k (limit varies). If the entire estate is small, the time and cost savings are significant.',
        ],
      },
      {
        heading: 'Skip the legal fees - draft with Bella',
        body: [
          '[Bella](/) drafts state-compliant wills, revocable trusts, and beneficiary-designation worksheets in 15-30 minutes from a short interview. Free for the first three drafts. For estates over $1M or with blended-family complexity, [Find Counsel](/find-counsel) connects you with a small-firm estate attorney for a flat-fee plan.',
        ],
      },
    ],
    faq: [
      {
        q: 'Does a will avoid probate?',
        a: 'No. A will directs the probate process; it does not skip it. The will is filed with the court, the court oversees distribution. To skip probate, use a trust, JTWROS, or beneficiary designations.',
      },
      {
        q: 'How much does probate cost compared to a trust?',
        a: 'Trust setup: $1,500-$3,500. Probate cost on a $500k estate: $15,000-$35,000+ depending on state. For most families with home equity plus retirement accounts, the trust pays for itself ~10x over.',
      },
      {
        q: 'What about pour-over wills?',
        a: 'A pour-over will is the safety net for a trust-based plan: it directs that any asset NOT in the trust at death "pours over" into the trust. It does not skip probate for the assets that go through it, but it ensures everything ends up in the trust eventually.',
      },
    ],
    cta: { label: 'Start your estate plan with Bella', href: '/sign-in?next=/cases/new' },
  },

  {
    slug: 'eviction-process-by-state',
    title: 'Eviction process: a landlord\'s step-by-step guide',
    description:
      'Plain-English guide to lawful eviction. Notice periods by state, required documentation, court process, and what landlords cannot do (self-help eviction).',
    publishedAt: '2026-05-10T10:00:00Z',
    category: 'self_help',
    keywords: [
      'eviction process',
      'how to evict a tenant',
      'eviction notice',
      'landlord eviction',
    ],
    readMinutes: 8,
    sections: [
      {
        heading: 'Lawful eviction is a procedural minefield',
        body: [
          'Eviction is one of the most procedurally regulated areas of state law. A landlord who skips a step - the wrong notice, the wrong service method, the wrong court - loses the case and starts over. Some skipped steps trigger tenant counterclaims and damages awards.',
          'This is a starting framework. Specific rules vary dramatically by state, county, and even city. Read your local rules carefully or consult a local landlord-tenant attorney.',
        ],
      },
      {
        heading: 'The general process',
        body: [
          '**1. Verify the lawful cause.** Common causes: non-payment of rent, lease violation (unauthorized occupants, pets, illegal activity), holdover (lease ended), nuisance. "I want my apartment back" is not lawful cause in most jurisdictions; you need a specific lease breach or notice-period expiration.',
          '**2. Send the proper notice.** Form and content are specified by statute. Non-payment notices often allow 3-14 days to cure (pay the back rent). Lease-violation notices vary widely. Holdover notices follow the lease term. Get the form wrong and the case is dismissed.',
          '**3. Wait out the notice period.** If the tenant cures the breach within the cure period (pays the rent, removes the unauthorized pet), the eviction stops. You start fresh if there\'s another breach later.',
          '**4. File the eviction lawsuit.** Forms vary by state. Filing fees run $50-$250. The court issues a summons and sets a hearing date, typically 5-30 days out.',
          '**5. Serve the tenant.** Most states require sheriff service or process server. Personal service by you (the landlord) is usually not allowed.',
          '**6. The hearing.** The judge hears both sides. The landlord must prove the cause and that proper notice was given. If the tenant has a defense (uninhabitable conditions, retaliation, discrimination), they raise it here.',
          '**7. Writ of possession.** If the landlord wins, the court issues a writ. The sheriff serves it, the tenant has 24-72 hours to leave, and if they don\'t the sheriff physically removes them.',
        ],
      },
      {
        heading: 'Notice periods by state and cause',
        body: [
          'These are typical (not universal). Verify your state.',
          '**Non-payment of rent:** California 3 days, New York 14 days, Texas 3 days, Florida 3 days, Illinois 5 days.',
          '**Lease violation (curable):** Most states 7-30 days to cure.',
          '**Holdover (lease ended):** Typically 30-60 days advance notice; longer for tenants in the rental over 1-2 years.',
          '**Health and safety / nuisance:** Often 3 days, sometimes "immediate" with expedited court process.',
        ],
      },
      {
        heading: 'What landlords cannot do (self-help eviction)',
        body: [
          'Across all 50 states, the following are illegal "self-help" methods even if the tenant has not paid in months:',
          '- Changing the locks while the tenant is out',
          '- Removing the tenant\'s belongings',
          '- Shutting off utilities (electricity, water, heat)',
          '- Threatening or intimidating the tenant',
          '- Showing up repeatedly or harassing the tenant',
          'Self-help eviction triggers tenant counterclaims (lockout damages, mental distress, attorney fees) that often exceed the unpaid rent. Use the court process even when it feels slow.',
        ],
      },
      {
        heading: 'Get your case file in order',
        body: [
          {
            web: '[Advottic](/) organizes your eviction case: lease, rent ledger, photos of property condition, communication log, notice + proof of service, court filings. Bella drafts the notice in your state\'s format and adds the cure period to your calendar with reminders. Counsel Solo at $59/user/mo for landlords with multiple properties.',
            app: '[Advottic](/) organizes your eviction case: lease, rent ledger, photos of property condition, communication log, notice + proof of service, court filings. Bella drafts the notice in your state\'s format and adds the cure period to your calendar with reminders. Advottic Counsel suits landlords with multiple properties.',
          },
        ],
      },
    ],
    faq: [
      {
        q: 'Can I evict for any reason if the lease is month-to-month?',
        a: 'No - most states require a stated reason (cause) or a notice period (typically 30-60 days). Some jurisdictions (rent-controlled cities) require "just cause" even for month-to-month tenancies. Verify your local rules.',
      },
      {
        q: 'What if the tenant has a service animal that violates my no-pet clause?',
        a: 'Service animals are protected under the Fair Housing Act and are not pets. You cannot evict for the service animal alone. You can evict for actual property damage caused by the animal.',
      },
      {
        q: 'Can the tenant counterclaim against me in eviction court?',
        a: 'Yes. Common defenses include: uninhabitable conditions (warranty of habitability), discrimination, retaliation (you are evicting because they reported you to code enforcement), improper notice. Be prepared.',
      },
    ],
    cta: { label: 'Organize your eviction file with Bella', href: '/sign-in?next=/cases/new' },
  },
];

export function getArticle(slug: string): Article | null {
  return ARTICLES.find((a) => a.slug === slug) ?? null;
}

export const ARTICLE_CATEGORIES: Record<Article['category'], string> = {
  self_help: 'Self-help',
  practice_management: 'Practice management',
  contracts: 'Contracts',
  ai_legal: 'AI + legal tech',
  compliance: 'Compliance',
};
