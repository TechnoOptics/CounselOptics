/**
 * Stroke icons for the counsel surfaces that were drawing real emoji.
 *
 * The evidence centre and the co-counsel guest shell used 👤 🏢 📍 📁 📅 🔎
 * 🔒 🗂 as UI chrome. Emoji render as somebody else's artwork (a different
 * one per platform), they cannot take the surrounding text colour, and on a
 * screen an outside client sees they read as unfinished. These match the set
 * already drawn by hand elsewhere in the workspace (CalendarIcon /
 * DocumentIcon in app/counsel/intake/[id]/page.tsx): one weight, no fill,
 * currentColor throughout, so they inherit state and theme like text.
 */

function Icon({
  size = 13,
  children,
  className,
}: {
  size?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number; className?: string };

/** A named individual. */
export function PersonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </Icon>
  );
}

/** An organisation or company. */
export function OrgIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 21V6.5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 13 6.5V21" />
      <path d="M13 11h5.5A1.5 1.5 0 0 1 20 12.5V21" />
      <path d="M2.5 21h19M7 9h3M7 13h3M7 17h3M16 15h1M16 18h1" />
    </Icon>
  );
}

/** A location. */
export function PlaceIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 21s6.5-5.6 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 15.4 12 21 12 21Z" />
      <circle cx="12" cy="10.3" r="2.4" />
    </Icon>
  );
}

/** A saved view over evidence. Never a container - nothing moves into it. */
export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2l2 2.4h8.8A1.5 1.5 0 0 1 21 9.9v8.6a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
    </Icon>
  );
}

/** A date. */
export function CalendarIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Icon>
  );
}

/** Anything else the analysis picked out of an item. */
export function DetailIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.4 15.4 4.1 4.1" />
    </Icon>
  );
}

/** Private to its creator. */
export function LockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
    </Icon>
  );
}

/** The evidence intake itself: a filed, indexed collection. */
export function ArchiveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="4.5" rx="1.3" />
      <path d="M4.8 8.5V19a1.5 1.5 0 0 0 1.5 1.5h11.4a1.5 1.5 0 0 0 1.5-1.5V8.5" />
      <path d="M10 12.5h4" />
    </Icon>
  );
}
