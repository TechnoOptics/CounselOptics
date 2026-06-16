/**
 * Shared OG image renderer. Each opengraph-image.tsx route is a
 * 3-line wrapper that calls renderOgImage(title, subtitle) - lets
 * us roll out custom previews on every page without copy-pasting
 * the 150-line layout from /app/opengraph-image.tsx.
 *
 * Edge-compatible: this file is imported by `runtime = 'edge'`
 * routes, so it stays free of any Node-only APIs.
 */

import { ImageResponse } from 'next/og';

// Absolute origin so Satori can fetch the real brand mark PNG to
// composite into the card. Every per-page social/AI preview uses this
// helper, so they all carry the actual gold pillar logo.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://advottic.com');

/**
 * Standard OG canvas: forest gradient background, gold halo at top
 * right, deep-midnight pool at bottom left, brand bar + headline +
 * footer tagline. Takes title (the big line) + subtitle (the line
 * under it) and renders the 1200x630 PNG every social platform
 * (LinkedIn, X, Slack, iMessage, Discord, Facebook) expects.
 */
export function renderOgImage(opts: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
}): ImageResponse {
  const eyebrow = opts.eyebrow ?? 'ADVOTTIC';
  const subtitle =
    opts.subtitle ??
    'AI-powered legal-prep platform. Calm software, defensible audit trail.';
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
          {/* Real gold pillar mark so every per-page link/AI preview
              shows the actual Advottic logo, not a CSS letter. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${SITE_URL}/advottic-mark.png`}
            width={42}
            height={45}
            alt="Advottic"
          />
          {eyebrow}
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 72,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.06,
              fontFamily: 'serif',
            }}
          >
            {opts.title}
          </div>
          <div
            style={{
              fontSize: 26,
              opacity: 0.85,
              maxWidth: 980,
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </div>
        </div>

        {/* Bottom row: domain */}
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
    { width: 1200, height: 630 },
  );
}
