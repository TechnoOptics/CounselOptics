'use client';

/** Small shared UI atoms for the collaboration surfaces (avatars, timestamps). */

export function Avatar({
  name,
  avatarUrl,
  size = 28,
  ring,
}: {
  name: string;
  avatarUrl: string | null;
  size?: number;
  ring?: boolean;
}) {
  const initials = name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const dim = { width: size, height: size };
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        style={dim}
        className={
          'rounded-full object-cover shrink-0 ' +
          (ring ? 'ring-1 ring-ink-200 dark:ring-forest-700/50' : '')
        }
        data-no-translate
      />
    );
  }
  return (
    <span
      style={dim}
      className="inline-flex items-center justify-center rounded-full bg-forest-100 text-forest-900 ring-1 ring-forest-300/40 dark:bg-forest-800/60 dark:text-cream-100 text-[11px] font-semibold shrink-0"
      aria-hidden
      data-no-translate
    >
      {initials || '·'}
    </span>
  );
}

export function relTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  });
}
