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
  // Unchanged for the signer page, and that was checked rather than
  // assumed. blob: was added here on the theory that pdf.js registers
  // an embedded typeface through an object URL; it does not. It builds
  // a FontFace from the font's own bytes, or from a data: URL, both of
  // which this line already allowed. The only object URL the library
  // creates is the wrapper it uses to start a cross-origin worker,
  // which is worker-src and pre-existing. A security header widened on
  // an unverified claim is exactly what the rest of this change is
  // about not doing, so it came back out.
  `font-src 'self' data: https://fonts.gstatic.com`,
  // The signer page fetches the PDF bytes itself now instead of
  // pointing a frame at storage, and it fetches them from this origin
  // (/api/firm/sign/document/[token]), so 'self' is what covers it and
  // no host was added here for it. It also fetches the OpenJPEG wasm
  // the same way, from public/pdf-worker/<version>/wasm/ on this
  // origin: the fetch is made by the page rather than the worker
  // (useWorkerFetch: false), so it lands here and not in worker-src,
  // and script-src already carries the 'unsafe-eval' that wasm
  // compilation needs. That is deliberate: the page is
  // unauthenticated and its URL carries a live signing credential, so
  // the rasteriser is given nothing cross-origin to reach for. The
  // Supabase host below is the pre-existing allowance for the
  // authenticated app's own client, not for that page.
  `connect-src 'self' https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://api.anthropic.com https://api.stripe.com https://*.vercel-insights.com`,
  // Supabase storage belongs here, not just in img-src: the counsel
  // document preview shows a stored PDF in an iframe pointed at a
  // signed storage URL. Without it, enforcing this policy would blank
  // that preview. The public /sign/[token] page used to need it too
  // and no longer does, because it renders the document itself from
  // same-origin bytes instead of framing storage.
  `frame-src 'self' https://*.supabase.co https://${SUPABASE_HOST} https://www.google.com https://maps.google.com https://js.stripe.com https://hooks.stripe.com https://billing.stripe.com https://app.cal.com`,
  // 'self' covers the pdf.js worker: it is NOT emitted into
  // /_next/static by the bundler (Next runs Terser over emitted .mjs
  // assets in non-module mode, which fails on the import.meta inside
  // it), it is copied into public/pdf-worker/<version>/ by
  // scripts/copy-pdf-worker.mjs at prebuild and served from this
  // origin, version-locked to the library that loads it. No CDN
  // worker, no character map fetched from anywhere. blob: predates
  // this and stays.
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
  `media-src 'self' blob:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self' https://checkout.stripe.com https://billing.stripe.com`,
  `frame-ancestors 'none'`,
  // NOTE: `upgrade-insecure-requests` intentionally omitted. The CSP
  // below ships as Content-Security-Policy-Report-Only, and that
  // directive is a spec-defined no-op in report-only mode - every
  // page load logged a console error ("...ignored when delivered in
  // a report-only policy"). The site is HTTPS-only with no mixed
  // content, so it has no effect here anyway. Re-add it on the line
  // below when switching the header to enforced Content-Security-
  // Policy (drop `-Report-Only`).
].join('; ');

const SECURITY_HEADERS = [
  // Browsers will only connect over HTTPS for the next year once they've
  // seen this header. Safe because Vercel always serves TLS. 1-year max-age
  // is the SOC 2 / HSTS-preload-eligible baseline; add `; preload` and submit
  // to hstspreload.org only after confirming every subdomain is HTTPS-only.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
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
  // Upload sourcemaps to Vercel so production stack traces are
  // readable instead of minified gibberish. Audit P0-3 (React #419)
  // could not be root-caused without these. Cost: ~5-10s on build,
  // bundle stays the same (maps are served as separate .map files
  // and gated behind Vercel's CDN auth headers). Maps are NOT
  // public; only Vercel auth can fetch them.
  productionBrowserSourceMaps: true,
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
    // Embed widgets must be frameable from third-party sites - that
    // is the whole point. Strip X-Frame-Options and relax the
    // frame-ancestors CSP for /embed/* only. Every other path keeps
    // the locked-down headers.
    const EMBED_SECURITY_HEADERS = SECURITY_HEADERS.filter(
      (h) => h.key !== 'X-Frame-Options',
    ).map((h) => {
      if (h.key === 'Content-Security-Policy-Report-Only') {
        return {
          ...h,
          value: h.value.replace(
            "frame-ancestors 'none'",
            "frame-ancestors *",
          ),
        };
      }
      return h;
    });
    return [
      {
        source: '/embed/:path*',
        headers: EMBED_SECURITY_HEADERS,
      },
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
  webpack: (config, { isServer, webpack }) => {
    // Keep the build machine's path out of a public page.
    //
    // pdf.js contains exactly one `import.meta.url`, inside the Node
    // canvas factory, which a browser never reaches. Webpack evaluates
    // it at build time regardless and inlines the absolute path of the
    // directory it was built in, so the chunk that /sign/[token] loads
    // carried a line like file:///.../node_modules/pdfjs-dist/build,
    // served to anyone holding a signing link, on a page that requires
    // no account.
    //
    // Defined to a constant rather than disabled: turning the parser's
    // import.meta evaluation off leaves the expression in the emitted
    // chunk, which then fails to minify (verified: the build stops
    // with a syntax error). This substitutes a fixed, meaningless URL
    // instead. Nothing in this app's own client code reads
    // import.meta.url, and the one library that does uses it only on
    // the Node path.
    if (!isServer) {
      config.plugins.push(
        new webpack.DefinePlugin({
          'import.meta.url': JSON.stringify('file:///app/'),
        }),
      );
    }
    return config;
  },
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
