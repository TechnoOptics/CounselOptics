import { ImageResponse } from 'next/og';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://advottic.com');

export const runtime = 'edge';
export const alt = 'What Advottic is, and isn’t';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * About-page OG. Mirrors the role-triangle headline from the
 * canonical /about page so when the link is shared, the social
 * preview already communicates the positioning before the click.
 */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '64px 80px',
          textAlign: 'center',
          color: '#f5edd6',
          backgroundImage: [
            'radial-gradient(ellipse at 85% 15%, rgba(213, 187, 126, 0.35), rgba(213, 187, 126, 0) 55%)',
            'radial-gradient(ellipse at 12% 92%, rgba(15, 32, 26, 0.85), rgba(15, 32, 26, 0) 60%)',
            'linear-gradient(135deg, #1f4839 0%, #173b30 45%, #0f2d24 100%)',
          ].join(', '),
        }}
      >
        {/* Real gold pillar mark so the shared card carries the logo. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`${SITE_URL}/advottic-mark.png`}
          width={66}
          height={71}
          alt="Advottic"
          style={{ marginBottom: 22 }}
        />
        <div
          style={{
            fontSize: 22,
            letterSpacing: 8,
            textTransform: 'uppercase',
            fontWeight: 700,
            color: '#d5bb7e',
            marginBottom: 28,
          }}
        >
          About Advottic
        </div>
        <div
          style={{
            // Satori needs display:flex on any node with >1 child;
            // without it the OG image 500s and no card renders.
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '0.25em',
            fontSize: 84,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            lineHeight: 1.08,
            fontFamily: 'serif',
            marginBottom: 32,
          }}
        >
          Advottic prepares.
          <span
            style={{
              background:
                'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
              backgroundClip: 'text',
              color: 'transparent',
              fontStyle: 'italic',
            }}
          >
            An attorney advises.
          </span>
          You decide.
        </div>
        <div style={{ fontSize: 26, opacity: 0.78, maxWidth: 980, lineHeight: 1.35 }}>
          The honest scope of what we do, and when to call a lawyer instead.
        </div>
      </div>
    ),
    { ...size },
  );
}
