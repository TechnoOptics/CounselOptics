import type { ReactNode } from 'react';
import Link from 'next/link';
import { T } from '@/components/i18n/LocaleProvider';
import type { FirmRequestType } from '@/lib/request-types';
import {
  AlertIcon,
  BuildingIcon,
  ChatIcon,
  ContractIcon,
  DocIcon,
  HelpIcon,
  LockIcon,
  MagnifyIcon,
  MailIcon,
  SealIcon,
  TrustIcon,
  UsersIcon,
} from '@/components/counsel/icons';

/**
 * The Hub's request-type tiles.
 *
 * An employee with a problem should not have to know which line of a
 * dropdown their problem lives on. They pick the thing that sounds like
 * what happened to them, and the form that opens is already the right
 * form.
 *
 * Two decisions worth stating.
 *
 * WHAT THE TILE SAYS. The label is the firm's own wording and is never
 * translated (`data-no-translate`) - running a firm's configured
 * request type through machine translation would corrupt the term the
 * firm chose. The guidance line under it is ours, so it is wrapped in
 * <T> like every other piece of product copy. It is written for
 * somebody who is not a lawyer: what happened to you, not what the
 * document is called.
 *
 * WHAT THE TILE SHOWS. Icons come from the counsel family in
 * components/counsel/icons.tsx, matched on the type's key first and
 * then on a keyword in the key or label. The keyword pass is what makes
 * a firm's own partner-app slugs ("Contract Review", "Incident") land
 * on a considered glyph instead of on the generic page. Anything that
 * matches nothing gets the page, which is a fine answer and a better
 * one than twelve mediocre bespoke drawings.
 */

type Face = { icon: ReactNode; hint: string };

const BY_KEY: Record<string, Face> = {
  new_contract_agreement: {
    icon: <ContractIcon />,
    hint: 'For a new agreement with a customer, vendor or partner.',
  },
  internal_review_request: {
    icon: <MagnifyIcon />,
    hint: 'Have legal read something over before it goes out.',
  },
  document_for_safekeeping: {
    icon: <TrustIcon />,
    hint: 'Hand a signed document to legal to hold on file.',
  },
  trademark_ip_filing: {
    icon: <SealIcon />,
    hint: 'Protect a name, logo or invention the company owns.',
  },
  nda_review: {
    icon: <LockIcon />,
    hint: 'Before you share anything confidential outside the company.',
  },
  vendor_msa_review: {
    icon: <BuildingIcon />,
    hint: 'A supplier sent terms and somebody needs to check them.',
  },
  employment_matter: {
    icon: <UsersIcon />,
    hint: 'Anything about hiring, leaving, or a person on your team.',
  },
  compliance_question: {
    icon: <HelpIcon />,
    hint: 'Not sure something is allowed. Ask before you act.',
  },
  litigation_hold: {
    icon: <AlertIcon />,
    hint: 'Preserve documents because a dispute is expected.',
  },
  demand_letter: {
    icon: <MailIcon />,
    hint: 'Ask legal to write formally to another party for you.',
  },
  other: {
    icon: <ChatIcon />,
    hint: 'Not sure where it fits. Describe it and legal will route it.',
  },
};

// Ordered: the first pattern that matches wins, so the specific
// categories are listed ahead of the catch-all "review" and "question".
const BY_KEYWORD: Array<[RegExp, Face]> = [
  [/\b(nda|nondisclosure|non disclosure|confidentiality)\b/, BY_KEY.nda_review],
  [
    /\b(trademark|patent|copyright|ip|brand)\b/,
    BY_KEY.trademark_ip_filing,
  ],
  [/\b(vendor|supplier|procurement|msa)\b/, BY_KEY.vendor_msa_review],
  [/\b(contract|agreement|sow|renewal)\b/, BY_KEY.new_contract_agreement],
  [/\b(hr|employee|employment|people|hiring|onboarding)\b/, BY_KEY.employment_matter],
  [/\b(incident|breach|hold|escalation|urgent)\b/, BY_KEY.litigation_hold],
  [/\b(letter|demand|notice|dispute|claim)\b/, BY_KEY.demand_letter],
  [/\b(compliance|policy|question|advice)\b/, BY_KEY.compliance_question],
  [/\b(review|check)\b/, BY_KEY.internal_review_request],
];

const FALLBACK: Face = {
  icon: <DocIcon />,
  hint: 'Send it to legal and follow the answer from here.',
};

function faceFor(type: FirmRequestType): Face {
  const exact = BY_KEY[type.key];
  if (exact) return exact;
  const text = `${type.key} ${type.label}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
  for (const [pattern, face] of BY_KEYWORD) {
    if (pattern.test(text)) return face;
  }
  return FALLBACK;
}

/** The tile grid's href. `/portal/new` reads this back as the preselected type. */
export function requestTypeHref(type: FirmRequestType): string {
  return `/portal/new?type=${encodeURIComponent(type.label)}`;
}

/**
 * One column on a phone, two on a tablet, three from a laptop up.
 * Three rather than four: at four the tile drops to about 245px on a
 * 1440 laptop once the Hub's rail is taken off, and "New contract /
 * agreement" wraps onto a second line, which puts the labels in a row
 * out of alignment with each other. The class string is complete and
 * literal - Tailwind reads source text, so an assembled
 * `lg:grid-cols-${n}` would compile to nothing.
 */
const GRID = 'grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

export function RequestTypeTiles({ types }: { types: FirmRequestType[] }) {
  return (
    <ul className={GRID}>
      {types.map((type) => {
        const face = faceFor(type);
        return (
          // The <li> is the grid item, not the link. `display: contents`
          // would have been tidier markup and is still dropped from the
          // accessibility tree by some browsers, which would cost the
          // list its item semantics.
          <li key={type.key}>
            <Link
              href={requestTypeHref(type)}
              /*
                The focus ring is an OUTLINE, not a ring/box-shadow, and
                it restates the radius. globals.css gives every <a> a
                focus-visible box-shadow ring at `a:focus-visible`, but
                `.counsel-shell .card` sets box-shadow at a higher
                specificity, so on a card-surfaced link the shared ring
                silently loses and only the shared rule's 6px radius
                lands - a focused tile squared off its corners and grew
                no ring at all. Nothing sets `outline` on .card, so an
                outline wins cleanly.
              */
              className="card group flex h-full items-start gap-3.5 p-4 transition-colors focus-visible:rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-400"
            >
              <span
                className="mt-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gold-500/[0.09] text-gold-300 ring-1 ring-gold-500/20 transition-colors group-hover:bg-gold-500/[0.18] group-hover:text-gold-200"
                aria-hidden
              >
                {face.icon}
              </span>
              <span className="min-w-0">
                <span
                  className="block font-display text-[15px] leading-snug text-cream-100"
                  data-no-translate
                >
                  {type.label}
                </span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-cream-100/55">
                  <T>{face.hint}</T>
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
