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
    // Direction is the discriminator against Vendor / MSA review two
    // tiles down. Naming the counterparties here ("customer, vendor or
    // partner") sent anyone holding a contract somebody else drafted to
    // the wrong tile.
    hint: 'You need a new agreement drawn up, rather than one you were sent.',
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
    // An employee never issues a hold - legal does. So the tile has to
    // describe the employee's trigger, not the instrument.
    hint: 'Something happened that could become a dispute. Tell legal before anything gets deleted.',
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

/**
 * The keyword pass matches a GLYPH only, never a hint, which is why it
 * maps to icons rather than to whole faces.
 *
 * A glyph generalises and a sentence does not. "Contract Review", a
 * real partner-app slug, matches the contract pattern: the contract
 * page is right for it, but "You need a new agreement drawn up" is the
 * opposite of what that firm means, and it would have told somebody
 * holding a contract to review that the tile was for new ones. Only an
 * exact key match owns its copy; everything else takes the neutral
 * line, which is true of any request.
 *
 * Ordered: first match wins, so the specific categories sit ahead of
 * the catch-all "review" and "question".
 */
const BY_KEYWORD: Array<[RegExp, ReactNode]> = [
  [/\b(nda|nondisclosure|non disclosure|confidentiality)\b/, <LockIcon key="l" />],
  [/\b(trademark|patent|copyright|ip|brand)\b/, <SealIcon key="s" />],
  [/\b(vendor|supplier|procurement|msa)\b/, <BuildingIcon key="b" />],
  [/\b(contract|agreement|sow|renewal)\b/, <ContractIcon key="c" />],
  [/\b(hr|employee|employment|people|hiring|onboarding)\b/, <UsersIcon key="u" />],
  [/\b(incident|breach|hold|escalation|urgent)\b/, <AlertIcon key="a" />],
  [/\b(letter|demand|notice|dispute|claim)\b/, <MailIcon key="m" />],
  [/\b(compliance|policy|question|advice)\b/, <HelpIcon key="h" />],
  [/\b(review|check)\b/, <MagnifyIcon key="g" />],
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
  for (const [pattern, icon] of BY_KEYWORD) {
    if (pattern.test(text)) return { icon, hint: FALLBACK.hint };
  }
  return FALLBACK;
}

/** The tile grid's href. `/portal/new` reads this back as the preselected type. */
export function requestTypeHref(type: FirmRequestType): string {
  return `/portal/new?type=${encodeURIComponent(type.label)}`;
}

/**
 * One column on a phone, two on a tablet, three from `xl` up.
 *
 * Three-up is gated at `xl` (1280px) and not at `lg` (1024px) because
 * of where the Hub's grid actually sits. The Hub has no max-width and
 * runs beside a 256px rail, so at a 1024px viewport - a non-maximised
 * window, an iPad Pro in landscape - three-up gives a 216px tile, which
 * is narrower than the four-up-at-1440 layout that was rejected for
 * wrapping "New contract / agreement" onto a second line. At 1280 the
 * same tile is 301px and the labels hold one line. /portal/new is
 * capped at max-w-5xl and is comfortable either way.
 *
 * The class string is complete and literal - Tailwind reads source
 * text, so an assembled `xl:grid-cols-${n}` would compile to nothing.
 */
const GRID = 'grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3';

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
              // No focus classes: the shared `a:focus-visible` rule in
              // globals.css now carries an outline that a card cannot
              // suppress, so the ring arrives here the same way it
              // arrives on every other link in the product.
              className="card group flex h-full items-start gap-3.5 p-4 transition-colors"
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
