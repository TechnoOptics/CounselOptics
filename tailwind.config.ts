import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: [
          'var(--font-display)',
          'ui-serif',
          'Georgia',
          'Cambria',
          'Times New Roman',
          'serif',
        ],
      },
      colors: {
        // Advottic brand - deep forest green base, warm gold accent.
        forest: {
          DEFAULT: '#0F2D24',
          950: '#0a1f19',
          900: '#0F2D24',
          800: '#173b30',
          700: '#23362F',
          600: '#2d4940',
          500: '#3B6656',
          400: '#5e8a7c',
          300: '#9bb8ad',
          200: '#cad9d2',
          100: '#e3ece8',
          50: '#f1f5f3',
        },
        gold: {
          // Softer champagne-leaning gold; less saturated than the previous
          // burnished tone (#C9A85A) so it reads as warm rather than yellow.
          DEFAULT: '#D5BB7E',
          950: '#3E3520',
          900: '#5C4F30',
          800: '#7E6B41',
          700: '#A38A55',
          600: '#C2A66A',
          500: '#D5BB7E',
          400: '#DEC68A',
          300: '#E5CE93',
          200: '#EFE0B7',
          100: '#F5EDD6',
          50: '#FBF8EE',
        },
        // Cream kept as a neutral warm-off-white tint for subtle backgrounds.
        cream: {
          DEFAULT: '#f5edd6',
          200: '#f5edd6',
          100: '#fbf7e9',
          50: '#fefcf3',
        },
        // Neutrals - kept as ink-* for backwards compatibility with existing class names.
        // Soft warm-white instead of clinical zinc.
        ink: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',
          950: '#09090b',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 45 36 / 0.04), 0 1px 1px 0 rgb(15 45 36 / 0.03)',
        'card-hover':
          '0 6px 18px -4px rgb(15 45 36 / 0.10), 0 2px 4px -1px rgb(15 45 36 / 0.05)',
        'brand-glow': '0 8px 24px -4px rgb(15 45 36 / 0.30)',
        'gold-glow': '0 0 0 3px rgb(213 187 126 / 0.30)',
      },
      backgroundImage: {
        'forest-gradient': 'linear-gradient(135deg, #0F2D24 0%, #173b30 50%, #23362F 100%)',
        // Metallic gold to match the brand pillar mark: deep bronze base,
        // rich warm gold mids, and two cream-gold highlight bands so the
        // gold-pan animation sweeps a real shimmer across text/surfaces.
        'gold-shine':
          'linear-gradient(135deg, #8a661f 0%, #c79532 12%, #f2d896 28%, #d4a14a 44%, #b08229 58%, #d4a14a 72%, #f2d896 88%, #c79532 100%)',
        // Vertical solid-fill version for buttons / CTAs - top highlight,
        // rich body, deep base, warm bottom edge. Same palette, fewer
        // stops, no diagonal so big surfaces still read as "gold."
        'gold-metal':
          'linear-gradient(180deg, #f2d896 0%, #d4a14a 32%, #b08229 65%, #c79532 100%)',
        'gold-veil':
          'linear-gradient(180deg, rgba(213,187,126,0) 0%, rgba(213,187,126,0.10) 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
