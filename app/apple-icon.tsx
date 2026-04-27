import { ImageResponse } from 'next/og';

// iOS / iPadOS home-screen icon. 180x180 at 1x, 360x360 at 2x.
// Same gradient + gold-monogram look as the browser favicon, sized
// up so the depth reads cleanly on a phone screen.
export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundImage: [
            'radial-gradient(circle at 80% 18%, rgba(213, 187, 126, 0.45), rgba(213, 187, 126, 0) 55%)',
            'radial-gradient(circle at 12% 86%, rgba(15, 32, 26, 0.55), rgba(15, 32, 26, 0) 60%)',
            'linear-gradient(135deg, #1f4839 0%, #173b30 45%, #0f2d24 100%)',
          ].join(', '),
          color: '#d5bb7e',
          fontFamily: 'serif',
          fontSize: 124,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          boxShadow:
            'inset 0 2px 0 rgba(245, 237, 214, 0.20), inset 0 -6px 18px rgba(0, 0, 0, 0.35)',
        }}
      >
        <span
          style={{
            display: 'flex',
            background:
              'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
            backgroundClip: 'text',
            color: 'transparent',
            textShadow: '0 2px 0 rgba(0,0,0,0.30)',
          }}
        >
          A
        </span>
      </div>
    ),
    { ...size },
  );
}
