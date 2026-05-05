import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-static';

/**
 * RFC 9116 security.txt. Tells researchers how to report a
 * vulnerability and points to our public disclosure policy.
 *
 * Lives at /.well-known/security.txt - this is the canonical URL
 * scanners look for. We also serve it at /security.txt as a
 * convenience (configured in next.config.mjs rewrites if needed).
 */
export function GET() {
  // Rolling 12-month expiry. The body is regenerated on every
  // deploy, so this stays fresh as long as we ship at least once
  // a year (which we do).
  const expires = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const body = `# Advottic security contact
# https://advottic.com/security/disclosure

Contact: mailto:security@advottic.com
Contact: https://advottic.com/security/disclosure
Expires: ${expires}
Preferred-Languages: en
Canonical: https://advottic.com/.well-known/security.txt
Policy: https://advottic.com/security/disclosure
Acknowledgments: https://advottic.com/security/disclosure#acknowledgements
`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
