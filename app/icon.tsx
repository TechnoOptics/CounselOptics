import { ImageResponse } from 'next/og';

// Browser tab favicon. 32x32 on most browsers, scales up to 64.
// Replaces the old flat-green PNG with a richer forest gradient +
// gold accent so the icon reads as crafted on a high-DPI screen
// instead of a single solid color.
export const runtime = 'edge';
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Layered gradient: warm ambient gold at the top-right,
          // cool forest body, deep midnight in the bottom-left.
          backgroundImage: [
            'radial-gradient(circle at 80% 18%, rgba(213, 187, 126, 0.42), rgba(213, 187, 126, 0) 55%)',
            'radial-gradient(circle at 12% 86%, rgba(15, 32, 26, 0.55), rgba(15, 32, 26, 0) 60%)',
            'linear-gradient(135deg, #1f4839 0%, #173b30 45%, #0f2d24 100%)',
          ].join(', '),
          color: '#d5bb7e',
          fontFamily: 'serif',
          fontSize: 44,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          // Inner highlight + soft shadow for depth.
          boxShadow:
            'inset 0 1px 0 rgba(245, 237, 214, 0.18), inset 0 -2px 6px rgba(0, 0, 0, 0.35)',
        }}
      >
        <span
          style={{
            display: 'flex',
            background:
              'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
            backgroundClip: 'text',
            color: 'transparent',
            // Fake text-shadow to simulate the gold-leaf depth.
            textShadow: '0 1px 0 rgba(0,0,0,0.25)',
          }}
        >
          A
        </span>
      </div>
    ),
    { ...size },
  );
}
