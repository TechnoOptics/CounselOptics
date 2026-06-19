import { PLAY_STORE_URL, APP_STORE_URL } from '@/lib/app-links';

/**
 * App-store download badges. Renders the Google Play badge always
 * (live) and the App Store badge only once the iOS version is live
 * (gated via NEXT_PUBLIC_IOS_APP_LIVE in lib/app-links). Server
 * component - the links are real <a> tags so search crawlers follow
 * them, which is what surfaces the install option on a brand search.
 */
function AppleGlyph() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.365 1.43c0 1.14-.46 2.22-1.2 3-.79.85-2.08 1.5-3.18 1.41-.13-1.07.43-2.2 1.13-2.93.78-.82 2.13-1.42 3.25-1.48zM20.7 17.2c-.6 1.37-.89 1.98-1.66 3.19-1.07 1.68-2.58 3.77-4.45 3.79-1.66.02-2.08-1.08-4.33-1.07-2.25.01-2.72 1.09-4.38 1.07-1.87-.02-3.3-1.91-4.37-3.59C-1.5 17.96-1.92 12.2.55 9.18c1.24-1.5 3.05-2.42 4.85-2.42 1.82 0 2.96 1.08 4.46 1.08 1.46 0 2.35-1.08 4.45-1.08 1.6 0 3.29.86 4.5 2.35-3.95 2.14-3.3 7.72 1.04 8.13z" />
    </svg>
  );
}

function PlayGlyph() {
  return (
    <svg
      width="20"
      height="22"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M3.6 1.6a1.4 1.4 0 0 0-.5 1.1v18.6c0 .47.2.86.5 1.1L13.7 12 3.6 1.6zM17.9 9.6 5.9 2.7l9.1 9 2.9-2.1zM15 13.3l-9.1 9 12-6.9-2.9-2.1zM20.7 10.8l-2.5-1.4-3.2 2.6 3.2 2.6 2.5-1.4a1.4 1.4 0 0 0 0-2.4z" />
    </svg>
  );
}

export function GetTheApp({ className = '' }: { className?: string }) {
  const badge =
    'inline-flex items-center gap-2.5 rounded-xl bg-forest-950 text-cream-100 px-4 py-2.5 ring-1 ring-cream-100/15 hover:ring-gold-300/50 hover:bg-forest-900 transition-colors';
  return (
    // Hidden inside the native apps - showing a store badge (esp.
    // Google Play) in the iOS app violates App Store Guideline 2.3.10.
    <div data-hide-in-app className={`flex flex-wrap items-center gap-3 ${className}`}>
      {APP_STORE_URL && (
        <a
          href={APP_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Download Advottic on the App Store"
          className={badge}
        >
          <AppleGlyph />
          <span className="leading-tight text-left">
            <span className="block text-[9px] uppercase tracking-wide opacity-75">
              Download on the
            </span>
            <span className="block text-[15px] font-semibold">App Store</span>
          </span>
        </a>
      )}
      <a
        href={PLAY_STORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Get Advottic on Google Play"
        className={badge}
      >
        <PlayGlyph />
        <span className="leading-tight text-left">
          <span className="block text-[9px] uppercase tracking-wide opacity-75">
            Get it on
          </span>
          <span className="block text-[15px] font-semibold">Google Play</span>
        </span>
      </a>
    </div>
  );
}
