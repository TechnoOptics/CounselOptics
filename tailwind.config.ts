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
          DEFAULT: '#C9A85A',
          950: '#5b4a1e',
          900: '#74602a',
          800: '#8d7635',
          700: '#a68c40',
          600: '#bfa14d',
          500: '#C9A85A',
          400: '#d6bc7a',
          300: '#e2cf9a',
          200: '#ede1bd',
          100: '#f5edd6',
          50: '#fbf7e9',
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
        'gold-glow': '0 0 0 3px rgb(201 168 90 / 0.25)',
      },
      backgroundImage: {
        'forest-gradient': 'linear-gradient(135deg, #0F2D24 0%, #173b30 50%, #23362F 100%)',
        'gold-shine': 'linear-gradient(135deg, #C9A85A 0%, #d6bc7a 50%, #C9A85A 100%)',
        'gold-veil': 'linear-gradient(180deg, rgba(201,168,90,0) 0%, rgba(201,168,90,0.10) 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
