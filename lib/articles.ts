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
  sections: Array<{ heading: string; body: string[] }>;
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
          'Advottic\'s legal AI Bella drafts the full letter in two minutes from a short narrative. She populates parties, facts, legal basis, demand, and deadline; you review and send. Free for the first three drafts; $19/mo for unlimited on [Personal Pro](/pricing).',
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
          '[Advottic](/) starts at $59 per user per month and bundles Bella (an AI agent that drafts documents, runs conflict checks, and starts time entries on her own), case management, IOLTA, e-signature, and a two-sided client marketplace. The bundled AI is roughly equivalent to Spellbook and the case management to Clio.',
          'Clio with Duo is the same shape but $89-$129 per user per month plus the Duo upcharge; their AI is research-focused.',
          'Litify is enterprise-only Salesforce on top of legal workflows; quotes start at $200/user/mo with multi-year commits.',
        ],
      },
      {
        heading: 'How to pick',
        body: [
          'Solo / small firm under 10 attorneys: full-stack wins. You don\'t want to maintain three vendors. [Advottic Solo at $59/user/mo](/pricing) is the cheapest reasonable option.',
          'Mid-market firm (10-50 attorneys) doing transactional work: full-stack with strong contract-AI. Advottic Small Firm at $99/user/mo, or Spellbook + a separate practice-management tool.',
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
          '[Advottic Counsel](/pricing) ships per-matter sub-ledgers, three-way reconciliation reports, and an auto-flag for negative client balances. Other practice management tools that handle IOLTA include Clio (separate Trust module), CosmoLex, and Smokeball.',
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
          '[Advottic](/) - $59-$149 per user per month. Bundles AI (Bella), case management, e-signature, IOLTA, intake / conflict checking, marketplace, real-time team chat. Single tenant; no add-ons. Best for solo and small firms that want one tool.',
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
