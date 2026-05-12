// Content Security Policy. Starts in Report-Only mode so we can
// observe what breaks before we enforce. Key allowances:
//   - 'self' for everything we serve (most things)
//   - Supabase project domain for auth + storage + Postgres realtime
//   - Anthropic for Bella streaming
//   - Stripe for checkout / billing portal
//   - Google Maps for the find-counsel iframe
//   - Cal for the optional calendar embed
//   - 'unsafe-inline' on script-src is required by Next.js inline
//     bootstrap scripts; tightening to nonces is a planned migration
const SUPABASE_HOST = (() => {
  try {
    const u = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    return u ? new URL(u).host : '*.supabase.co';
  } catch {
    return '*.supabase.co';
  }
})();

const CSP = [
  `default-src 'self'`,
  // Next.js streams inline scripts for hydration + chunked render.
  // 'unsafe-inline' is the canonical Next 14 allowance; nonce
  // strategy can replace this in a future Next 15+ migration.
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://app.cal.com`,
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  `img-src 'self' data: blob: https://*.supabase.co https://${SUPABASE_HOST} https://*.googleusercontent.com https://maps.gstatic.com https://maps.googleapis.com`,
  `font-src 'self' data: https://fonts.gstatic.com`,
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://api.anthropic.com https://api.stripe.com https://*.vercel-insights.com`,
  `frame-src 'self' https://www.google.com https://maps.google.com https://js.stripe.com https://hooks.stripe.com https://billing.stripe.com https://app.cal.com`,
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
  `media-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self' https://checkout.stripe.com https://billing.stripe.com`,
  `frame-ancestors 'none'`,
  `upgrade-insecure-requests`,
].join('; ');

const SECURITY_HEADERS = [
  // Browsers will only connect over HTTPS for the next ~6 months once they've
  // seen this header. Safe because Vercel always serves TLS.
  { key: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains' },
  // Disallow framing - defense against clickjacking.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Disable MIME sniffing.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Don't leak full URLs in referrer headers to third parties.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Lock down powerful APIs to same-origin only. Camera + microphone +
  // geolocation are needed in-app (mobile camera scan, voice dictation,
  // find-counsel "use my location") so they get `(self)`. Everything
  // else stays denied. interest-cohort=() opts us out of FLoC.
  {
    key: 'Permissions-Policy',
    value:
      'camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()',
  },
  // CSP in Report-Only mode for the first observation week. Switch
  // the header name to plain `Content-Security-Policy` (drop
  // `-Report-Only`) once the violations log is quiet. The same value
  // works in either mode.
  { key: 'Content-Security-Policy-Report-Only', value: CSP },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Suppress the `X-Powered-By: Next.js` response header. Free
  // version disclosure handed to every visitor and pen-test scanner;
  // the audit flagged it as P1-3. No functional impact.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    serverComponentsExternalPackages: ['pdfkit'],
    // Required in Next 14 for instrumentation.ts to load - without
    // this flag, the onRequestError hook is silently ignored, which
    // is why crash_reports stayed empty after the 500 we tried to
    // capture. (Default-on in Next 15.)
    instrumentationHook: true,
  },
  // Allow next/image to load firm logos + avatars uploaded to public
  // Supabase Storage buckets. The wildcard hostname covers any
  // Supabase project URL we might use for staging/dev.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // www.advottic.com -> apex collapse stays in next.config.mjs because
  // it is a cross-host external redirect. All other subdomain routing
  // (hq.advottic.com -> /admin/*, enterprise.advottic.com -> /counsel/*)
  // lives in middleware.ts now: the previous redirect+rewrite chain in
  // beforeFiles double-applied at the Vercel Edge once cookies started
  // crossing subdomains, turning /admin into /admin/admin and 404'ing
  // every signed-in tester. Middleware does both legs in a single pass
  // with explicit ordering and no chance of re-evaluation.
  async redirects() {
    return [
      // www.advottic.com/* -> advottic.com/*  (canonical apex).
      //
      // Why: Supabase Auth's "Allowed Redirect URLs" list whitelists the
      // apex callback (https://advottic.com/auth/callback). When a user
      // initiates OAuth from www, the browser supabase client computes
      // redirectTo from window.location.origin = https://www.advottic.com,
      // which Supabase doesn't recognize, so it falls back to Site URL
      // (apex root) and the user lands at https://advottic.com/?code=...
      // - the wrong path, no PKCE exchange, no session.
      //
      // Collapsing www -> apex at the edge keeps every user on the one
      // origin Supabase trusts. Also stops cookie scope from splitting
      // across two hostnames (each cookie is host-scoped by default).
      //
      // 307 (temporary) instead of 308 so we can roll this back without
      // poisoning browser/CDN caches if anything downstream depends on
      // www. Promote to permanent: true after a clean week.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.advottic.com' }],
        destination: 'https://advottic.com/:path*',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
