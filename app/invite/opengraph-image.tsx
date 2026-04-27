import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'A personal invitation from Abel · Advottic';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * OG card for /invite. Personal warmth + brand framing so when Abel
 * shares the link in a DM, iMessage, or email, the preview reads
 * as a hand-extended invitation, not a marketing page.
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
          justifyContent: 'space-between',
          padding: '64px 80px',
          color: '#f5edd6',
          backgroundImage: [
            'radial-gradient(ellipse at 85% 15%, rgba(213, 187, 126, 0.40), rgba(213, 187, 126, 0) 55%)',
            'radial-gradient(ellipse at 12% 92%, rgba(15, 32, 26, 0.85), rgba(15, 32, 26, 0) 60%)',
            'linear-gradient(135deg, #1f4839 0%, #173b30 45%, #0f2d24 100%)',
          ].join(', '),
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            fontSize: 22,
            letterSpacing: 8,
            textTransform: 'uppercase',
            fontWeight: 700,
            color: '#d5bb7e',
          }}
        >
          A personal invitation
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 88,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.04,
              fontFamily: 'serif',
            }}
          >
            Hi, I&rsquo;m{' '}
            <span
              style={{
                background:
                  'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
                backgroundClip: 'text',
                color: 'transparent',
                fontStyle: 'italic',
              }}
            >
              Abel.
            </span>
          </div>
          <div
            style={{
              fontSize: 30,
              opacity: 0.85,
              maxWidth: 920,
              lineHeight: 1.35,
            }}
          >
            Founder of Advottic. I&rsquo;d love your help testing what we&rsquo;ve built
            - and your honest feedback.
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            fontSize: 18,
            opacity: 0.78,
          }}
        >
          <div style={{ display: 'flex', gap: 28 }}>
            <span>5-minute walk-through</span>
            <span style={{ color: '#d5bb7e' }}>7-day free trial</span>
            <span>No card on file</span>
          </div>
          <div
            style={{
              fontSize: 16,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: '#d5bb7e',
            }}
          >
            advottic.com/invite
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
