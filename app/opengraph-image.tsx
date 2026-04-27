import { ImageResponse } from 'next/og';

/**
 * Default OpenGraph image used by every page that doesn't ship its
 * own. 1200x630 is the canonical OG size and what every link
 * preview renderer (LinkedIn, iMessage, Slack, X) expects.
 *
 * Layered: forest gradient body, ambient gold halo at top-right,
 * deep midnight at bottom-left, brand wordmark vibe + tagline.
 * Composed from raw HTML/CSS so we don't have to ship a binary
 * image; rebuilds automatically as the brand evolves.
 */
export const runtime = 'edge';
export const alt = 'Advottic · Walk into court prepared';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 80px',
          color: '#f5edd6',
          backgroundImage: [
            'radial-gradient(ellipse at 85% 15%, rgba(213, 187, 126, 0.35), rgba(213, 187, 126, 0) 55%)',
            'radial-gradient(ellipse at 12% 92%, rgba(15, 32, 26, 0.85), rgba(15, 32, 26, 0) 60%)',
            'linear-gradient(135deg, #1f4839 0%, #173b30 45%, #0f2d24 100%)',
          ].join(', '),
        }}
      >
        {/* Top row: brand */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 24,
            letterSpacing: 8,
            textTransform: 'uppercase',
            fontWeight: 700,
            color: '#d5bb7e',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: '2px solid rgba(213,187,126,0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'serif',
              fontSize: 26,
              fontWeight: 700,
              backgroundImage:
                'linear-gradient(180deg, #1f4839 0%, #0f2d24 100%)',
            }}
          >
            <span
              style={{
                background:
                  'linear-gradient(135deg, #f3e1ad, #d5bb7e 50%, #b89853)',
                backgroundClip: 'text',
                color: 'transparent',
                lineHeight: 1,
              }}
            >
              A
            </span>
          </div>
          Advottic
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 84,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              fontFamily: 'serif',
            }}
          >
            Walk into court{' '}
            <span
              style={{
                background:
                  'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
                backgroundClip: 'text',
                color: 'transparent',
                fontStyle: 'italic',
              }}
            >
              prepared.
            </span>
          </div>
          <div
            style={{
              fontSize: 28,
              opacity: 0.85,
              maxWidth: 920,
              lineHeight: 1.35,
            }}
          >
            Organize evidence. Surface gaps. Ship a packet your attorney can
            read in five minutes.
          </div>
        </div>

        {/* Bottom row: tagline + roles */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            fontSize: 18,
            opacity: 0.75,
          }}
        >
          <div style={{ display: 'flex', gap: 28 }}>
            <span>You describe.</span>
            <span style={{ color: '#d5bb7e' }}>Advottic prepares.</span>
            <span>An attorney advises.</span>
          </div>
          <div
            style={{
              fontSize: 16,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: '#d5bb7e',
            }}
          >
            advottic.com
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
