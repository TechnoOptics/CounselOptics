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
  // Don't grant access to powerful browser APIs we don't use.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
    serverComponentsExternalPackages: ['pdfkit'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
