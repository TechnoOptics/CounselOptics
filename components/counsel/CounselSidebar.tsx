import Link from 'next/link';
import type { Firm, FirmMember } from '@/lib/firm-types';

const ITEMS: Array<{
  href: string;
  label: string;
  icon: React.ReactNode;
  hint: string;
}> = [
  { href: '/counsel', label: 'Dashboard', icon: <DashIcon />, hint: 'Overview' },
  { href: '/counsel/intake', label: 'Intake', icon: <UserIcon />, hint: 'New matter + conflict check' },
  { href: '/counsel/cases', label: 'Cases', icon: <CaseIcon />, hint: 'All firm matters' },
  { href: '/counsel/clients', label: 'Clients', icon: <UserIcon />, hint: 'Roster + invites' },
  { href: '/counsel/team', label: 'Team', icon: <UsersIcon />, hint: 'Members + roles' },
  { href: '/counsel/documents', label: 'Documents', icon: <DocIcon />, hint: 'Case-linked vault' },
  { href: '/counsel/contracts', label: 'Contracts', icon: <DocIcon />, hint: 'Standalone contract repo + Bella review' },
  { href: '/counsel/signing', label: 'Signing', icon: <SignIcon />, hint: 'E-sign requests' },
  { href: '/counsel/chat', label: 'Chat', icon: <ChatIcon />, hint: 'Channels + DMs' },
  { href: '/counsel/meetings', label: 'Meetings', icon: <CalIcon />, hint: 'Calendar' },
  { href: '/counsel/leads', label: 'Leads', icon: <UsersIcon />, hint: 'Inbound from /find-counsel' },
  { href: '/counsel/referrals', label: 'Referrals', icon: <UsersIcon />, hint: 'Co-counsel + fee splits' },
  { href: '/counsel/time', label: 'Time', icon: <DashIcon />, hint: 'Time entries' },
  { href: '/counsel/billing', label: 'Billing', icon: <SignIcon />, hint: 'Invoices' },
  { href: '/counsel/trust', label: 'Trust', icon: <SignIcon />, hint: 'IOLTA ledger' },
];

export function CounselSidebar({
  firm,
  membership,
}: {
  firm: Firm;
  membership: FirmMember;
}) {
  return (
    <nav className="card p-3 sticky top-24 space-y-0.5">
      <p className="text-[10px] uppercase tracking-[0.2em] font-semibold text-ink-500 dark:text-cream-100/55 px-2 pt-1 pb-2">
        {firm.name}
      </p>
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm text-ink-800 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/60 hover:text-forest-900 dark:hover:text-cream-100 transition-colors"
        >
          <span
            className="h-5 w-5 rounded inline-flex items-center justify-center text-white flex-none"
            style={{ backgroundColor: firm.accentColor, opacity: 0.85 }}
            aria-hidden
          >
            {item.icon}
          </span>
          <span className="flex-1">{item.label}</span>
          <span className="text-[10px] text-ink-400 dark:text-cream-100/45">{item.hint}</span>
        </Link>
      ))}
      {(membership.role === 'owner' || membership.role === 'admin') && (
        <>
          <div className="my-2 border-t border-ink-100 dark:border-forest-700/40" />
          <Link
            href="/counsel/settings"
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm text-ink-800 dark:text-cream-100/85 hover:bg-cream-50 dark:hover:bg-forest-800/60 hover:text-forest-900 dark:hover:text-cream-100 transition-colors"
          >
            <span
              className="h-5 w-5 rounded inline-flex items-center justify-center text-white flex-none"
              style={{ backgroundColor: firm.accentColor, opacity: 0.85 }}
              aria-hidden
            >
              <GearIcon />
            </span>
            <span>Firm settings</span>
          </Link>
        </>
      )}
    </nav>
  );
}

const SVG = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function DashIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  );
}
function CaseIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg {...SVG}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg {...SVG}>
      <circle cx="9" cy="8" r="3.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 21c0-3 3-5 6-5s6 2 6 5" />
      <path d="M14 21c0-2 2-4 5-4s5 2 5 4" />
    </svg>
  );
}
function DocIcon() {
  return (
    <svg {...SVG}>
      <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}
function SignIcon() {
  return (
    <svg {...SVG}>
      <path d="M15 4l5 5L9 20H4v-5z" />
      <path d="M12 7l5 5" />
    </svg>
  );
}
function ChatIcon() {
  return (
    <svg {...SVG}>
      <path d="M21 12a8 8 0 01-11.5 7.2L4 20l1-4.5A8 8 0 1121 12z" />
    </svg>
  );
}
function CalIcon() {
  return (
    <svg {...SVG}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg {...SVG}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a7.97 7.97 0 000-6l2-1.2-2-3.4-2.3.8a8 8 0 00-5.2-3L11.5 0h-3l-.4 2.2a8 8 0 00-5.2 3l-2.3-.8-2 3.4 2 1.2a7.97 7.97 0 000 6l-2 1.2 2 3.4 2.3-.8a8 8 0 005.2 3L8.5 24h3l.4-2.2a8 8 0 005.2-3l2.3.8 2-3.4z" />
    </svg>
  );
}
