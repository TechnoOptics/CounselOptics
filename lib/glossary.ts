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
];

export function getGlossaryEntry(slug: string): GlossaryEntry | null {
  return GLOSSARY.find((e) => e.slug === slug) ?? null;
}
