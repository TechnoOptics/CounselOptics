import Link from 'next/link';
import type { ReactNode } from 'react';

import {
  PORTAL_REQUEST_FAMILIES,
  type PortalFamilyKey,
} from '@/lib/portal-request-families';
import { MonoRef } from '@/components/counsel/patterns';
import {
  CaseIcon,
  ContractIcon,
  ImportIcon,
  InboxIcon,
} from '@/components/counsel/icons';

/**
 * The four ways in, and the smaller row of everything else.
 *
 * A component rather than markup on the page for one reason: this is
 * the piece of the portal a person actually looks at, and a page tied
 * to a signed-in employee and a live database cannot be rendered and
 * examined. Here it takes plain props, so the preview harness renders
 * THE SHIPPED COMPONENT with made-up numbers rather than a copy of it
 * that can drift from what ships.
 *
 * The tiles are presentational and hold no policy. Which families a
 * person sees, and how many are open in each, are decided by the page.
 */

/** The glyph for each family. Keyed here so the harness cannot differ. */
const FAMILY_ICON: Record<PortalFamilyKey, ReactNode> = {
  internal: <InboxIcon />,
  contract: <ContractIcon />,
  legal: <CaseIcon />,
  dropbox: <ImportIcon />,
};

/** The accent at low alpha, for an icon square. Matches patterns.tsx. */
const ACCENT_TINT = 'color-mix(in oklab, var(--accent) 16%, transparent)';

export type UtilityTile = {
  href: string;
  icon: ReactNode;
  label: string;
  line: string;
};

export function TileArrow() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="transition-transform group-hover:translate-x-0.5"
      aria-hidden
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/**
 * The four request families.
 *
 * `openByFamily` is this person's own open requests per family, and it
 * is what makes the action link change wording. With nothing open the
 * link offers to START one and goes to the form; with something open it
 * says how many and goes to the list filtered to exactly those rows.
 * Both destinations are real and both are the same predicate, so the
 * sentence and the page it opens cannot disagree.
 */
export function HelpTiles({
  openByFamily,
}: {
  openByFamily: Record<PortalFamilyKey, number>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {PORTAL_REQUEST_FAMILIES.map((family) => {
        const openHere = openByFamily[family.key] ?? 0;
        const href =
          openHere > 0
            ? `/portal/requests?family=${family.key}`
            : `/portal/new?family=${family.key}`;
        const action =
          openHere > 0 ? `${openHere} open with you` : family.startLabel;
        return (
          <Link
            key={family.key}
            href={href}
            className="card group flex flex-col gap-3 p-4 transition-colors hover:border-edge-bright"
          >
            <div className="flex items-start justify-between gap-2">
              <span
                className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg text-accent-text"
                style={{ background: ACCENT_TINT }}
                aria-hidden
              >
                {FAMILY_ICON[family.key]}
              </span>
              <MonoRef title={`family=${family.key}`}>{family.code}</MonoRef>
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-foreground">
                {family.title}
              </h3>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
                {family.blurb}
              </p>
            </div>
            <span className="mt-auto inline-flex items-center gap-1.5 pt-1 text-[12.5px] font-medium text-accent-text">
              {action}
              <TileArrow />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** The smaller row: what an employee can do here that is not filing. */
export function UtilityTiles({ tiles }: { tiles: UtilityTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((u) => (
        <Link
          key={u.href}
          href={u.href}
          className="group flex items-start gap-3 rounded-xl border border-edge bg-surface p-3 transition-colors hover:border-edge-bright"
        >
          <span
            className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-accent-text"
            style={{ background: ACCENT_TINT }}
            aria-hidden
          >
            {u.icon}
          </span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-foreground">
              {u.label}
              <TileArrow />
            </span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
              {u.line}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}
