/**
 * Curated catalog of legal self-help resources. URLs in this file should be
 * stable, well-known landing pages. Do NOT auto-generate URLs from an LLM -
 * pick from this list. If a state isn't covered, fall back to NATIONAL.
 *
 * Verify entries periodically; an outdated URL is worse than no URL.
 */

export type ResourceCategory =
  | 'Self-help'
  | 'Legal aid'
  | 'Court information'
  | 'Find a lawyer'
  | 'Public defender'
  | 'Plain-language law';

export type LegalResource = {
  title: string;
  url: string;
  description: string;
  category: ResourceCategory;
};

export const NATIONAL_RESOURCES: LegalResource[] = [
  {
    title: 'LawHelp.org',
    url: 'https://www.lawhelp.org/',
    description:
      'Find free legal aid programs near you, by state. Run by the Legal Services Corporation.',
    category: 'Legal aid',
  },
  {
    title: 'American Bar Association - Free Legal Help',
    url: 'https://www.americanbar.org/groups/legal_services/flh-home/',
    description:
      'ABA directory of state-by-state pro bono, lawyer referral, and self-help programs.',
    category: 'Find a lawyer',
  },
  {
    title: 'Pro Bono Net',
    url: 'https://www.probono.net/',
    description:
      'Connects low-income people with volunteer attorneys; statewide self-help materials.',
    category: 'Legal aid',
  },
  {
    title: 'Justia Free Lawyer Directory',
    url: 'https://www.justia.com/lawyers/',
    description:
      'Searchable directory of attorneys with practice area and location filters. Free to consumers.',
    category: 'Find a lawyer',
  },
  {
    title: 'U.S. Courts - Find Your Court',
    url: 'https://www.uscourts.gov/court-locator',
    description:
      'Locate federal district and bankruptcy courts; useful when responding to a federal case.',
    category: 'Court information',
  },
  {
    title: 'Cornell Legal Information Institute',
    url: 'https://www.law.cornell.edu/',
    description:
      'Free, plain-English summaries of US statutes, case law, and legal concepts.',
    category: 'Plain-language law',
  },
];

const STATE: Record<string, LegalResource[]> = {
  CA: [
    {
      title: 'California Courts Self-Help Guide',
      url: 'https://selfhelp.courts.ca.gov/',
      description:
        'Official California courts site with step-by-step guides for civil, family, eviction, and small claims cases.',
      category: 'Self-help',
    },
    {
      title: 'LawHelpCA',
      url: 'https://www.lawhelpca.org/',
      description: 'Find legal aid programs and free legal information by topic in California.',
      category: 'Legal aid',
    },
  ],
  TX: [
    {
      title: 'TexasLawHelp.org',
      url: 'https://www.texaslawhelp.org/',
      description:
        'Free legal information, court forms, and pro se guides for Texas civil cases.',
      category: 'Self-help',
    },
    {
      title: 'Texas Bar - Find a Lawyer Referral',
      url: 'https://www.texasbar.com/AM/Template.cfm?Section=Find_a_Lawyer',
      description: 'Statewide lawyer referral program; reduced consultation fees.',
      category: 'Find a lawyer',
    },
  ],
  NY: [
    {
      title: 'NY CourtHelp',
      url: 'https://nycourts.gov/courthelp/',
      description:
        'Official New York Unified Court System self-help center; do-it-yourself forms and step-by-step guides.',
      category: 'Self-help',
    },
    {
      title: 'LawHelpNY',
      url: 'https://www.lawhelpny.org/',
      description: 'Find free legal services and self-help materials across New York State.',
      category: 'Legal aid',
    },
  ],
  FL: [
    {
      title: 'Florida Courts Self-Help',
      url: 'https://www.flcourts.gov/Resources-Services/Court-Improvement/Family-Courts/Family-Law-Self-Help-Information',
      description:
        'Florida State Courts self-help materials and approved family law forms.',
      category: 'Self-help',
    },
    {
      title: 'Florida Law Help',
      url: 'https://www.floridalawhelp.org/',
      description: 'Statewide legal aid lookup with free legal information.',
      category: 'Legal aid',
    },
  ],
  IL: [
    {
      title: 'Illinois Legal Aid Online',
      url: 'https://www.illinoislegalaid.org/',
      description:
        'Free legal information, do-it-yourself forms, and legal aid lookup for Illinois.',
      category: 'Self-help',
    },
  ],
  PA: [
    {
      title: 'PALawHelp',
      url: 'https://palawhelp.org/',
      description: 'Pennsylvania-wide legal information and aid lookup.',
      category: 'Self-help',
    },
  ],
  OH: [
    {
      title: 'Ohio Legal Help',
      url: 'https://www.ohiolegalhelp.org/',
      description: 'Free legal information and forms for civil cases in Ohio.',
      category: 'Self-help',
    },
  ],
  GA: [
    {
      title: 'Georgia Legal Aid',
      url: 'https://www.georgialegalaid.org/',
      description: 'Self-help information and statewide legal aid contacts for Georgia.',
      category: 'Self-help',
    },
  ],
  MA: [
    {
      title: 'Massachusetts Court System Self-Help',
      url: 'https://www.mass.gov/topics/courts',
      description:
        'Massachusetts Trial Court resources, forms, and law libraries open to the public.',
      category: 'Self-help',
    },
    {
      title: 'MassLegalHelp',
      url: 'https://www.masslegalhelp.org/',
      description: 'Plain-language legal information for low-income Massachusetts residents.',
      category: 'Legal aid',
    },
  ],
  MI: [
    {
      title: 'Michigan Legal Help',
      url: 'https://michiganlegalhelp.org/',
      description:
        'Self-help center sponsored by the Michigan State Bar; do-it-yourself forms and tools.',
      category: 'Self-help',
    },
  ],
  NJ: [
    {
      title: 'NJ Courts Self-Help',
      url: 'https://www.njcourts.gov/self-help',
      description: 'New Jersey court system self-help guides and forms.',
      category: 'Self-help',
    },
  ],
  WA: [
    {
      title: 'Washington LawHelp',
      url: 'https://www.washingtonlawhelp.org/',
      description: 'Free legal information and aid lookup for Washington State.',
      category: 'Self-help',
    },
  ],
  MN: [
    {
      title: 'Minnesota Courts Self-Help',
      url: 'https://www.mncourts.gov/Help-Topics/Self-Help-Center.aspx',
      description:
        'Official Minnesota Judicial Branch self-help center with forms by case type.',
      category: 'Self-help',
    },
    {
      title: 'LawHelpMN',
      url: 'https://www.lawhelpmn.org/',
      description: 'Minnesota legal aid lookup and self-help legal information.',
      category: 'Legal aid',
    },
  ],
  CO: [
    {
      title: 'Colorado Judicial Branch - Self-Help',
      url: 'https://www.coloradojudicial.gov/self-help',
      description: 'Forms and how-to guides by case type for Colorado state courts.',
      category: 'Self-help',
    },
  ],
  AZ: [
    {
      title: 'Arizona Law Help',
      url: 'https://www.azlawhelp.org/',
      description: 'Self-help legal information and aid lookup for Arizona.',
      category: 'Self-help',
    },
  ],
  NC: [
    {
      title: 'NC Courts - Help Topics',
      url: 'https://www.nccourts.gov/help-topics',
      description: 'North Carolina court system self-help by case type.',
      category: 'Self-help',
    },
  ],
  VA: [
    {
      title: 'Virginia Court Self-Help',
      url: 'https://www.vacourts.gov/courts/scv/self_represented_litigants.html',
      description: 'Virginia self-represented litigants resources.',
      category: 'Self-help',
    },
  ],
  OR: [
    {
      title: 'Oregon Law Help',
      url: 'https://oregonlawhelp.org/',
      description: 'Self-help legal information and aid lookup for Oregon.',
      category: 'Self-help',
    },
  ],
  WI: [
    {
      title: 'Wisconsin Court System Self-Help',
      url: 'https://www.wicourts.gov/services/public/selfhelp/index.htm',
      description: 'Wisconsin court self-help guides and forms.',
      category: 'Self-help',
    },
  ],
};

/**
 * Resolve a list of resources for a given jurisdiction. Tries a state name or
 * abbreviation match; falls back to national resources if no state match.
 */
export function getResourcesFor(stateInput: string | undefined | null): {
  state: string | null;
  state_specific: LegalResource[];
  national: LegalResource[];
} {
  const code = normalizeStateCode(stateInput);
  const state_specific = code ? STATE[code] ?? [] : [];
  return {
    state: code,
    state_specific,
    national: NATIONAL_RESOURCES,
  };
}

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
};

function normalizeStateCode(input: string | undefined | null): string | null {
  if (!input) return null;
  const cleaned = input.trim();
  if (!cleaned) return null;
  // strip parenthetical suffix like "Minnesota (MN)"
  const withoutParen = cleaned.replace(/\s*\(([A-Z]{2})\)\s*$/, ' $1').trim();
  // accept "MN", "Minnesota", or "Minnesota MN"
  const codeMatch = withoutParen.match(/\b([A-Za-z]{2})\b\s*$/);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    if (STATE[code]) return code;
  }
  const lower = withoutParen.toLowerCase();
  if (STATE_NAME_TO_CODE[lower]) return STATE_NAME_TO_CODE[lower];
  // try first-word match (e.g. "California, USA")
  const firstTwoWords = lower.split(/[\s,]+/).slice(0, 2).join(' ').trim();
  if (STATE_NAME_TO_CODE[firstTwoWords]) return STATE_NAME_TO_CODE[firstTwoWords];
  const firstWord = lower.split(/[\s,]+/)[0];
  if (STATE_NAME_TO_CODE[firstWord]) return STATE_NAME_TO_CODE[firstWord];
  return null;
}
