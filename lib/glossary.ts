/**
 * Glossary entries. Each becomes its own page at /glossary/<slug>
 * with a DefinedTerm + WebPage JSON-LD bundle. The glossary index
 * at /glossary lists them all in a DefinedTermSet.
 *
 * Adding a new entry: append an object here. The page route + sitemap
 * entry + RSS feed pick it up automatically.
 */

export type GlossaryEntry = {
  slug: string;
  term: string;
  shortDefinition: string;
  longDefinition: string;
  aliases: string[];
  /** YYYY-MM-DD when this entry was last reviewed for accuracy. */
  lastReviewed: string;
};

export const GLOSSARY: GlossaryEntry[] = [
  {
    slug: 'bella',
    term: 'Bella',
    shortDefinition:
      "Advottic's always-on AI legal assistant. Summarizes case files, drafts documents, surfaces crisis resources.",
    longDefinition:
      'Bella is the in-product AI assistant inside Advottic. She summarizes case files, drafts documents from 13+ templates, answers legal-prep questions, and surfaces 988 (Suicide & Crisis Lifeline), Crisis Text Line, Childhelp, and 911 / public-defender resources when a user describes a crisis. Bella tells you what tool she called and what answer she got back, so the AI reasoning is auditable. Tier 1 (chat + draft) ships in every paid Personal plan. Tier 2 adds firm letterhead, branded PDF reports, and email delivery for Advottic Counsel firms.',
    aliases: ['Bella AI', 'Bella assistant', 'Advottic Bella'],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'safe-witness',
    term: 'Safe Witness',
    shortDefinition:
      "Personal-safety alerting feature that sends a one-time SMS/email + live tracker to trusted contacts when the user presses-and-holds a button.",
    longDefinition:
      'Safe Witness is a personal-safety alerting feature inside Advottic. The user presses-and-holds the Safe Witness button on their Wear OS watch for four seconds (or the equivalent web/phone button) to fire a one-time SMS and email alert to every trusted contact they have explicitly added at /profile. Each message contains a pre-shared verification PIN, GPS location, a Google Maps link, and a one-tap link to call 911. After the initial press, the watch and any open web client ping the user’s location every 30 seconds so contacts can see a moving dot on a live tracker page. The user explicitly stops live tracking when they are safe. A red distress overlay also surfaces inside Bella + the document Decoder when the user types phrases like "I am in danger" or "I want to hurt myself", giving them one-tap access to 911, 988, and a press-and-hold Safe Witness trigger.',
    aliases: [
      'Advottic Safe Witness',
      'Safe Witness alert',
      'Safe Witness button',
    ],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'advottic-counsel',
    term: 'Advottic Counsel',
    shortDefinition:
      'Practice-management workspace for law firms inside Advottic - matter management, intake, IOLTA trust accounting, e-signature, SAML SSO.',
    longDefinition:
      "Advottic Counsel is the firm-side product inside the Advottic platform. It gives law firms matter management, branded client intake at a custom subdomain (yourfirm.advottic.com), IOLTA trust accounting with 3-way reconciliation, calendar + deadline tracking, document review with confidence rating, e-signature requests, court-form auto-fill (CA, NY, TX, FL, Federal), a marketplace lead engine for client acquisition, and Bella as an authenticated firm agent with access to firm data. Solo tier ($59/seat/month) covers a single attorney + 1 staff. Small Firm ($99/seat/month) adds the marketplace, IOLTA, and the custom subdomain up to 25 users. Growing Firm ($149/seat/month) adds analytics + a dedicated CSM up to 100 users. Enterprise (from $1,800/month) adds SAML SSO, SCIM provisioning, BAA availability, and custom data residency.",
    aliases: [
      'Advottic Counsel',
      'Counsel',
      'Advottic for firms',
      'Advottic Enterprise',
    ],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'advottic-review',
    term: 'Advottic Review',
    shortDefinition:
      "AI-assisted issue spotting on a user's case file - identifies relevant legal categories, evidence gaps, and confidence rating.",
    longDefinition:
      "Advottic Review is the AI-assisted issue-spotting feature inside Advottic case files. After a user has added facts and exhibits to a case, they run Advottic Review and get back a summary of possible legal categories, an evidence-to-claims map, gap callouts where evidence is missing, and a confidence rating per claim. Outputs are informational - they're a starting point for an attorney conversation, not legal advice. Advottic Review is bundled with Personal Pro, Personal Plus, every Counsel tier, and is available during the 7-day trial for Free users.",
    aliases: ['Advottic Review', 'AI Review', 'case review'],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'techno-optics',
    term: 'Techno Optics LLC',
    shortDefinition:
      'Minnesota-registered LLC that operates the Advottic platform.',
    longDefinition:
      "Techno Optics LLC is the Minnesota-registered Limited Liability Company that operates the Advottic legal-prep platform. Headquartered in Edina, Minnesota, USA. Founded 2025. EIN: 33-1557687. The trade name Advottic launched 2025. Techno Optics LLC also operates a separate consumer alerting product, Learning Parenting, on a different domain.",
    aliases: ['Techno Optics', 'TechnoOptics LLC'],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'action-center',
    term: 'Action Center',
    shortDefinition:
      'In-app hub grouping Advottic\'s four high-leverage tools: War Room, Deadline Radar, Decoder, and Safe Witness.',
    longDefinition:
      "Action Center is the menu item inside Advottic that groups four cross-cutting tools the user reaches for repeatedly: War Room (real-time case collaboration with a co-counsel or trusted contact), Deadline Radar (rolling calendar of filing deadlines, hearings, and statute-of-limitations expirations), Decoder (paste any legal document and get a plain-English explanation), and Safe Witness (personal-safety alerting). One menu item keeps the four together so users learn to look for them in the same place every time.",
    aliases: ['Action Center menu', 'Advottic Action Center'],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'decoder',
    term: 'Decoder',
    shortDefinition:
      'Plain-English explainer for legal documents. Paste any contract, lease, or court filing; get a summary the user can act on.',
    longDefinition:
      "Decoder is Advottic's plain-English legal-document explainer. The user pastes the full text of a contract, lease, court filing, demand letter, or any other legal document, and Decoder returns a short summary covering: what the document is, who's bound by it, the key dates and dollar amounts, the riskiest clauses, and what the user should do or ask their attorney about next. Outputs are informational; for legal advice users still consult a licensed attorney in their jurisdiction. Decoder also fires Advottic's distress overlay when the pasted text describes a crisis (e.g. a domestic-violence affidavit) so users have one-tap access to 988, 911, and Safe Witness contacts.",
    aliases: ['Advottic Decoder', 'Decoder tool'],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'war-room',
    term: 'War Room',
    shortDefinition:
      'Real-time case collaboration surface where the user can think through a matter with a co-counsel, paralegal, or trusted contact.',
    longDefinition:
      "War Room is the real-time collaboration surface inside Advottic. The user opens a War Room session on a case, shares a one-tap link with a co-counsel, paralegal, or trusted contact, and they think through the matter together: live document review, shared exhibit annotation, and Bella-assisted Q&A across the case file. Sessions are ephemeral by default (no transcript stored unless the user opts in) so attorneys can talk freely without worrying about discoverable chat logs.",
    aliases: ['Advottic War Room', 'case War Room'],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'deadline-radar',
    term: 'Deadline Radar',
    shortDefinition:
      'Rolling calendar of every filing deadline, hearing, statute-of-limitations expiration, and reminder across the user\'s cases.',
    longDefinition:
      "Deadline Radar is the rolling deadline view inside Advottic. It aggregates every filing deadline, hearing date, statute-of-limitations expiration, response window, court-form due date, and self-set reminder across every case the user is tracking, then renders them on a single calendar with color coding for urgency. The radar also pulls in jurisdiction-specific tolling rules so a user filing in California sees CA statutes that auto-toll for COVID-era equitable extensions, while a user in Texas sees TX-specific clocks. Daily push notifications surface anything due in the next 72 hours.",
    aliases: ['Advottic Deadline Radar', 'Deadline tracker'],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'advottic-aid',
    term: 'Advottic Aid',
    shortDefinition:
      'Counsel-side AI panel that retrieves the user\'s open cases, relevant state law, and recent precedent during a Bella session.',
    longDefinition:
      "Advottic Aid is the counsel-side AI panel inside Advottic Counsel. While an attorney is working in a case file, the Aid panel surfaces the open matters the question touches, relevant state-specific statutes and case law, and any matching firm templates or prior briefs. It's effectively a retrieval-augmented search across the firm's own knowledge plus jurisdiction-specific public law. Outputs are informational citations; the attorney does the legal analysis.",
    aliases: ['Aid panel', 'Advottic Aid panel'],
    lastReviewed: '2026-06-08',
  },
  {
    slug: 'iolta',
    term: 'IOLTA trust accounting',
    shortDefinition:
      'Compliant attorney trust-account ledger with three-way reconciliation. Ships in every Advottic Counsel firm tier.',
    longDefinition:
      "IOLTA (Interest on Lawyers Trust Account) is the regulatory regime that requires US attorneys to hold client funds in a trust account separate from the firm's operating account. Advottic Counsel includes a fully-compliant IOLTA ledger with three-way reconciliation (bank statement / book balance / client ledger all matched monthly), per-client subaccounts, and an audit trail signed at every transaction. The system flags negative balances, missing reconciliations, and unusual disbursements before they become bar-complaint problems. Shipped in Solo, Small Firm, Growing Firm, and Enterprise tiers.",
    aliases: ['Advottic IOLTA', 'trust accounting'],
    lastReviewed: '2026-06-08',
  },
];

export function getGlossaryEntry(slug: string): GlossaryEntry | null {
  return GLOSSARY.find((e) => e.slug === slug) ?? null;
}
