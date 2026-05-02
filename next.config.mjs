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
  // Anyone landing on hq.advottic.com is bounced to the equivalent
  // www.advottic.com/admin/* path - we 308 instead of rewriting so
  // the URL bar settles on the canonical /admin/* paths and the
  // existing UserMenu / layout / middleware logic (which all key off
  // pathname starting with /admin) doesn't need any host-aware
  // branching. Path-preserving so hq.advottic.com/firms goes to
  // /admin/firms, hq.advottic.com/users to /admin/users, etc.
  async redirects() {
    return [
      // /admin/* on hq subdomain - go straight to www without the
      // /admin/admin/* double-stack.
      {
        source: '/admin/:path*',
        has: [{ type: 'host', value: 'hq.advottic.com' }],
        destination: 'https://www.advottic.com/admin/:path*',
        permanent: false,
      },
      // Everything else on hq subdomain - prefix with /admin and
      // send to www.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'hq.advottic.com' }],
        destination: 'https://www.advottic.com/admin/:path*',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
