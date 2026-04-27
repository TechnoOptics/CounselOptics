import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

/**
 * One-stop endpoint for every iOS icon size Xcode wants in the
 * AppIcon.appiconset. Usage on the Mac:
 *
 *   curl -o icon-1024.png https://www.advottic.com/ios-icon?size=1024
 *   curl -o icon-180.png  https://www.advottic.com/ios-icon?size=180
 *   curl -o icon-167.png  https://www.advottic.com/ios-icon?size=167
 *   curl -o icon-152.png  https://www.advottic.com/ios-icon?size=152
 *   curl -o icon-120.png  https://www.advottic.com/ios-icon?size=120
 *   curl -o icon-87.png   https://www.advottic.com/ios-icon?size=87
 *   curl -o icon-80.png   https://www.advottic.com/ios-icon?size=80
 *   curl -o icon-76.png   https://www.advottic.com/ios-icon?size=76
 *   curl -o icon-60.png   https://www.advottic.com/ios-icon?size=60
 *   curl -o icon-58.png   https://www.advottic.com/ios-icon?size=58
 *   curl -o icon-40.png   https://www.advottic.com/ios-icon?size=40
 *   curl -o icon-29.png   https://www.advottic.com/ios-icon?size=29
 *   curl -o icon-20.png   https://www.advottic.com/ios-icon?size=20
 *
 * Then drag the PNGs into Xcode -> App/App/Assets.xcassets/AppIcon.appiconset.
 *
 * The image is the same forest-gradient + gold-A monogram as the
 * web favicon, scaled cleanly. Apple's App Store requires the 1024
 * variant be square, opaque (no transparency), and have no rounded
 * corners (Apple rounds at install time) - all satisfied here.
 */
export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const ALLOWED = new Set([20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024]);

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get('size');
  const requested = param ? parseInt(param, 10) : 1024;
  const size = ALLOWED.has(requested) ? requested : 1024;

  // Tune typography to the rendered size so the "A" stays readable
  // on the 20px icon and majestic on the 1024px App Store icon.
  const fontSize = Math.round(size * 0.7);
  const inset = Math.max(1, Math.round(size * 0.012));

  return new ImageResponse(
    (
      <div
        style={{
          width: size,
          height: size,
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
          fontSize,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          boxShadow: `inset 0 ${inset * 2}px 0 rgba(245, 237, 214, 0.20), inset 0 ${-inset * 4}px ${inset * 8}px rgba(0, 0, 0, 0.35)`,
        }}
      >
        <span
          style={{
            display: 'flex',
            background:
              'linear-gradient(135deg, #f3e1ad 0%, #d5bb7e 50%, #b89853 100%)',
            backgroundClip: 'text',
            color: 'transparent',
            textShadow: `0 ${inset}px 0 rgba(0,0,0,0.30)`,
          }}
        >
          A
        </span>
      </div>
    ),
    { width: size, height: size },
  );
}
