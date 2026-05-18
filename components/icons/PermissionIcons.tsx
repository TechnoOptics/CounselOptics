// Themed line icons for the permissions primer (replacing the stock
// emoji). Thin 1.75px stroke, round caps, currentColor - matches the
// app's other line icons and inherits the premium cream/gold popup
// palette instead of watering the experience down with OS emoji.

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function MicrophoneIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="9" y="2.75" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3M9 21h6" />
    </svg>
  );
}

export function CameraIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 7.5h2.2a1.5 1.5 0 0 0 1.25-.67l.86-1.29A1.5 1.5 0 0 1 10.06 4.8h3.88a1.5 1.5 0 0 1 1.25.67l.86 1.29a1.5 1.5 0 0 0 1.25.67h2.2A1.5 1.5 0 0 1 21 9v8.7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.7V9a1.5 1.5 0 0 1 1.5-1.5Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 3.6 1.2 5.1 1.9 6.1a.6.6 0 0 1-.5.9H4.6a.6.6 0 0 1-.5-.9C4.8 14.6 6 13.1 6 9.5Z" />
      <path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0" />
    </svg>
  );
}
