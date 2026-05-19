/**
 * Branded legal document generation for the enterprise (Counsel).
 *
 * A catalog of the document/contract/case types a legal team needs,
 * plus the ONE rule that matters when the firm puts its name on the
 * output: cleanLegalText() strips em/en dashes and every "this was
 * written by an AI" tell so the document reads as the firm's own
 * professional work product. Pure + dependency-free (shared by the
 * API route and the studio UI).
 */

export type TemplateField = {
  name: string;
  label: string;
  placeholder?: string;
  textarea?: boolean;
  optional?: boolean;
};

export type LegalTemplate = {
  id: string;
  name: string;
  group: string;
  blurb: string;
  fields: TemplateField[];
};

const PARTIES: TemplateField[] = [
  { name: 'partyA', label: 'First party (your client / the firm side)', placeholder: 'Acme Corporation' },
  { name: 'partyB', label: 'Second party / counterparty', placeholder: 'Beta LLC' },
  { name: 'jurisdiction', label: 'Governing law (state + country)', placeholder: 'Minnesota, USA' },
];

const TERMS: TemplateField = {
  name: 'terms',
  label: 'Key terms, deal points, and any specifics to include',
  placeholder:
    'Scope, price/consideration, term length, termination, confidentiality, anything non-standard...',
  textarea: true,
};

function contract(
  id: string,
  name: string,
  blurb: string,
  extra: TemplateField[] = [],
): LegalTemplate {
  return {
    id,
    name,
    group: 'Contracts',
    blurb,
    fields: [...PARTIES, ...extra, TERMS],
  };
}

export const LEGAL_TEMPLATES: LegalTemplate[] = [
  contract('nda-mutual', 'Mutual NDA', 'Two-way confidentiality agreement.'),
  contract('nda-oneway', 'One-Way NDA', 'Discloser/recipient confidentiality.'),
  contract('msa', 'Master Services Agreement', 'Umbrella MSA with SOW hooks.'),
  contract('sow', 'Statement of Work', 'SOW under an existing MSA.'),
  contract('services', 'Services Agreement', 'Standalone services contract.'),
  contract('consulting', 'Consulting Agreement', 'Independent consultant terms.'),
  contract(
    'ic',
    'Independent Contractor Agreement',
    'Contractor engagement + IP assignment.',
  ),
  contract(
    'employment',
    'Employment Agreement',
    'Offer + employment terms.',
    [{ name: 'role', label: 'Role / title', placeholder: 'Senior Engineer' }],
  ),
  contract(
    'vendor',
    'Vendor / Supplier Agreement',
    'Procurement / supply terms.',
  ),
  contract('saas', 'SaaS Subscription Agreement', 'Software subscription + SLA.'),
  contract('license', 'License Agreement', 'IP / software licensing.'),
  contract('reseller', 'Reseller / Channel Agreement', 'Resale + margins.'),
  contract('lease', 'Commercial Lease', 'Premises lease terms.'),
  contract('sales', 'Sales / Purchase Agreement', 'Goods or asset sale.'),
  contract('loan', 'Loan / Promissory Note', 'Debt + repayment terms.'),
  contract(
    'settlement',
    'Settlement & Release',
    'Dispute settlement + mutual release.',
  ),
  contract('jv', 'Joint Venture Agreement', 'JV scope, governance, splits.'),
  contract('partnership', 'Partnership Agreement', 'Partner roles + economics.'),
  contract(
    'shareholders',
    'Shareholders / Operating Agreement',
    'Entity governance.',
  ),
  {
    id: 'engagement-letter',
    name: 'Engagement Letter',
    group: 'Firm',
    blurb: 'Scope of representation + fees for a client.',
    fields: [
      { name: 'partyA', label: 'Firm / counsel', placeholder: 'Zinpro Legal' },
      { name: 'partyB', label: 'Client', placeholder: 'Acme Corporation' },
      { name: 'jurisdiction', label: 'Jurisdiction', placeholder: 'Minnesota, USA' },
      TERMS,
    ],
  },
  {
    id: 'demand-letter',
    name: 'Demand Letter',
    group: 'Disputes',
    blurb: 'Formal demand before litigation.',
    fields: [
      { name: 'partyA', label: 'Sender (your side)', placeholder: 'Acme Corporation' },
      { name: 'partyB', label: 'Recipient', placeholder: 'Beta LLC' },
      { name: 'jurisdiction', label: 'Jurisdiction', placeholder: 'Minnesota, USA' },
      {
        name: 'terms',
        label: 'Facts, the wrong done, and the remedy demanded',
        textarea: true,
      },
    ],
  },
  {
    id: 'cease-desist',
    name: 'Cease & Desist',
    group: 'Disputes',
    blurb: 'Stop infringing/wrongful conduct.',
    fields: [
      { name: 'partyA', label: 'Sender', placeholder: 'Acme Corporation' },
      { name: 'partyB', label: 'Recipient', placeholder: 'Infringer' },
      { name: 'jurisdiction', label: 'Jurisdiction', placeholder: 'Minnesota, USA' },
      { name: 'terms', label: 'The conduct to stop + basis', textarea: true },
    ],
  },
  {
    id: 'litigation-hold',
    name: 'Litigation Hold Notice',
    group: 'Disputes',
    blurb: 'Preserve-evidence notice to custodians.',
    fields: [
      { name: 'partyA', label: 'Issuing party', placeholder: 'Legal Department' },
      { name: 'partyB', label: 'Custodians / recipients', placeholder: 'All Sales staff' },
      { name: 'jurisdiction', label: 'Jurisdiction', placeholder: 'Minnesota, USA' },
      { name: 'terms', label: 'Matter + categories of data to preserve', textarea: true },
    ],
  },
  {
    id: 'board-consent',
    name: 'Board Written Consent',
    group: 'Corporate',
    blurb: 'Unanimous written consent of directors.',
    fields: [
      { name: 'partyA', label: 'Entity', placeholder: 'Acme Corporation' },
      { name: 'partyB', label: 'Board / signatories', placeholder: 'Board of Directors' },
      { name: 'jurisdiction', label: 'State of incorporation', placeholder: 'Delaware, USA' },
      { name: 'terms', label: 'Resolutions to adopt', textarea: true },
    ],
  },
  {
    id: 'privacy-policy',
    name: 'Privacy Policy',
    group: 'Compliance',
    blurb: 'Website/app privacy policy.',
    fields: [
      { name: 'partyA', label: 'Company', placeholder: 'Acme Corporation' },
      { name: 'partyB', label: 'Product / site', placeholder: 'acme.com' },
      { name: 'jurisdiction', label: 'Primary jurisdiction', placeholder: 'Minnesota, USA' },
      { name: 'terms', label: 'Data collected + how it is used', textarea: true },
    ],
  },
  {
    id: 'dpa',
    name: 'Data Processing Addendum',
    group: 'Compliance',
    blurb: 'GDPR/CCPA-style processor terms.',
    fields: [...PARTIES, TERMS],
  },
];

export const TEMPLATE_GROUPS = [
  'Contracts',
  'Disputes',
  'Corporate',
  'Compliance',
  'Firm',
];

export function getTemplate(id: string): LegalTemplate | null {
  return LEGAL_TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * Strip every "an AI wrote this" tell so the firm's document reads
 * as its own work product:
 *  - em/en/figure dashes -> comma (if spaced) or hyphen
 *  - chat preambles ("Sure, here is...") and sign-offs
 *  - markdown chrome (** ## ``` ` >) and emojis
 *  - bracketed AI/meta notes
 * Deterministic and conservative - never rewrites legal substance.
 */
export function cleanLegalText(input: string): string {
  let s = (input ?? '').replace(/\r\n/g, '\n');

  // Code fences / inline backticks.
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''));
  s = s.replace(/`/g, '');

  // Dashes: spaced em/en -> ", " ; tight (ranges) -> "-".
  s = s.replace(/\s+[—–―‒]\s+/g, ', ');
  s = s.replace(/[—–―‒]/g, '-');

  // Markdown headings/emphasis/blockquote markers (keep the text).
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  s = s.replace(/\*\*(.*?)\*\*/g, '$1');
  s = s.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:]|$)/g, '$1$2');
  s = s.replace(/(^|[\s(])_(?!_)([^_\n]+?)_(?=[\s).,;:]|$)/g, '$1$2');
  s = s.replace(/^\s{0,3}>\s?/gm, '');

  // Emojis / pictographs.
  s = s.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu,
    '',
  );

  // Chat preamble / sign-off lines.
  const lines = s.split('\n');
  while (lines.length) {
    const t = lines[0].trim();
    if (
      !t ||
      /^(sure|certainly|absolutely|of course|here(?:'s| is)\b|below is\b|i('| ha)ve (?:drafted|prepared|created)|as (?:requested|you asked)|happy to help|i hope this helps)\b/i.test(
        t,
      )
    ) {
      lines.shift();
    } else break;
  }
  while (lines.length) {
    const t = lines[lines.length - 1].trim();
    if (
      !t ||
      /^(let me know\b|i hope (?:this|that)\b|feel free\b|please (?:let me|review)\b|disclaimer:|note: i am an ai|as an ai\b)/i.test(
        t,
      )
    ) {
      lines.pop();
    } else break;
  }
  s = lines.join('\n');

  // Inline "As an AI" / meta-bracket notes.
  s = s.replace(/\bas an ai\b[^.]*\.?/gi, '');
  s = s.replace(/\[(?:note|ai|assistant)[^\]]*\]/gi, '');

  // Whitespace tidy + comma artifacts from dash replacement.
  s = s.replace(/ ,/g, ',').replace(/,{2,}/g, ',');
  s = s.replace(/[ \t]{2,}/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}
