import type { Config } from 'tailwindcss';

const config: Config = {
  // 'class' so a user-controlled toggle works. The actual `dark` class
  // is set on <html> by ThemeBoot in app/layout based on profile pref +
  // localStorage cache + OS preference fallback.
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    // lib/ holds shared style maps (e.g. the intake participant palette).
    // Without this glob those classes are silently never generated.
    './lib/**/*.{js,ts,jsx,tsx}',
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
      // 5-stop display scale so callsites can use a single named token
      // instead of arbitrary text-[44px] values that drift over time.
      // display-xl = landing hero, display-lg = page hero, display-md =
      // section heads, display-sm = card titles, display-xs = subsection.
      fontSize: {
        'display-xs': ['1.625rem', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
        'display-sm': ['2rem', { lineHeight: '1.1', letterSpacing: '-0.01em' }],
        'display-md': ['2.5rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-lg': ['3rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-xl': ['4.5rem', { lineHeight: '0.98', letterSpacing: '-0.02em' }],
      },
      colors: {
        // Semantic TEXT tokens. See the block at the top of
        // app/globals.css for the derivation and its contrast proof, and
        // lib/accent-text.ts for the arithmetic.
        //
        // Deliberately plain `var()` rather than the `rgb(... /
        // <alpha-value>)` form used by `forest` below: these resolve
        // through oklch() at paint time, so there are no channels to
        // split and an opacity modifier (`text-accent-text/60`) does
        // not apply. Use a fixed token instead of fading one.
        'accent-text': 'var(--accent-text)',
        'accent-on': 'var(--accent-on)',
        'warn-text': 'var(--warn-text)',
        'danger-text': 'var(--danger-text)',
        // Advottic brand - deep forest green base, warm gold accent.
        //
        // Driven by CSS custom properties (space-separated RGB
        // channels) so the whole forest scale is themeable per shell
        // WITHOUT touching call sites. :root in globals.css defines
        // the green channels (consumer app is byte-identical), and
        // .counsel-shell / .enterprise-shell remap them to neutral
        // black so the enterprise product is black-on-gold with the
        // exact same gradient depth, effects, and texture.
        forest: {
          DEFAULT: 'rgb(var(--forest-900) / <alpha-value>)',
          950: 'rgb(var(--forest-950) / <alpha-value>)',
          900: 'rgb(var(--forest-900) / <alpha-value>)',
          800: 'rgb(var(--forest-800) / <alpha-value>)',
          700: 'rgb(var(--forest-700) / <alpha-value>)',
          600: 'rgb(var(--forest-600) / <alpha-value>)',
          500: 'rgb(var(--forest-500) / <alpha-value>)',
          400: 'rgb(var(--forest-400) / <alpha-value>)',
          300: 'rgb(var(--forest-300) / <alpha-value>)',
          200: 'rgb(var(--forest-200) / <alpha-value>)',
          100: 'rgb(var(--forest-100) / <alpha-value>)',
          50: 'rgb(var(--forest-50) / <alpha-value>)',
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
