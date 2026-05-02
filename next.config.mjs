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
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
  // hq.advottic.com is the founder-facing alias for the HQ console.
  // The URL bar should NEVER show "/admin" on this subdomain - the
  // user's mental model is that hq.advottic.com IS the admin portal,
  // so paths look like hq.advottic.com/firms, /users, /counsel, etc.
  //
  // Two-rule strategy:
  //
  //   1. REDIRECT: hq.advottic.com/admin/X -> hq.advottic.com/X.
  //      Strips the legacy /admin segment from the URL bar so
  //      internal <Link href="/admin/firms"> clicks settle on the
  //      clean URL after one hop. Also handles users who paste an
  //      old www.advottic.com/admin/X bookmark into hq.advottic.com.
  //
  //   2. REWRITE: hq.advottic.com/X -> internally /admin/X.
  //      Server-side only - browser URL is unchanged. The Next.js
  //      routing then resolves /admin/X against the actual file
  //      tree (app/admin/X/page.tsx) and renders the HQ surfaces.
  //
  // The middleware sets x-pathname using the effective /admin/X path
  // when Host is hq.advottic.com so server components / auth checks
  // see the canonical path even before the rewrite resolves.
  async redirects() {
    return [
      // hq.advottic.com/admin/X -> hq.advottic.com/X
      {
        source: '/admin/:path*',
        has: [{ type: 'host', value: 'hq.advottic.com' }],
        destination: '/:path*',
        permanent: false,
      },
      // hq.advottic.com/admin -> hq.advottic.com/  (root case)
      {
        source: '/admin',
        has: [{ type: 'host', value: 'hq.advottic.com' }],
        destination: '/',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        // hq.advottic.com/ -> internally /admin (HQ landing)
        {
          source: '/',
          has: [{ type: 'host', value: 'hq.advottic.com' }],
          destination: '/admin',
        },
        // hq.advottic.com/<anything> -> internally /admin/<anything>
        // beforeFiles ensures we win over file-system routing for
        // top-level paths like /firms, /users, /consumer, etc.
        {
          source: '/:path*',
          has: [{ type: 'host', value: 'hq.advottic.com' }],
          destination: '/admin/:path*',
        },
      ],
    };
  },
};

export default nextConfig;
