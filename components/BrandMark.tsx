/**
 * The Advottic mark — a classical pillar (legal) with circuit nodes (technology).
 * Render in gold or any current color via stroke/fill currentColor.
 */
export function BrandMark({
  className = '',
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      className={className}
    >
      {/* Capital — three stacked horizontal bars */}
      <rect x="14" y="6" width="36" height="3.6" rx="0.8" fill="currentColor" />
      <rect x="11" y="11" width="42" height="3.6" rx="0.8" fill="currentColor" />
      <rect x="14" y="16" width="36" height="3.6" rx="0.8" fill="currentColor" />

      {/* Two pillars */}
      <rect x="20" y="22" width="7" height="30" rx="1" fill="currentColor" />
      <rect x="37" y="22" width="7" height="30" rx="1" fill="currentColor" />

      {/* Circuit traces on the pillars */}
      <line x1="23.5" y1="26" x2="23.5" y2="38" stroke="#0F2D24" strokeWidth="1.2" />
      <line x1="40.5" y1="32" x2="40.5" y2="48" stroke="#0F2D24" strokeWidth="1.2" />

      {/* Circuit nodes (dots) */}
      <circle cx="23.5" cy="38" r="2" fill="#0F2D24" />
      <circle cx="23.5" cy="38" r="0.9" fill="currentColor" />
      <circle cx="40.5" cy="32" r="2" fill="#0F2D24" />
      <circle cx="40.5" cy="32" r="0.9" fill="currentColor" />

      {/* Base */}
      <rect x="11" y="54" width="42" height="3.6" rx="0.8" fill="currentColor" />

      {/* Bottom base trim — two angled corners suggested via small triangles */}
      <path d="M9 57.6 L11 54 L11 57.6 Z" fill="currentColor" />
      <path d="M55 57.6 L53 54 L53 57.6 Z" fill="currentColor" />
    </svg>
  );
}
