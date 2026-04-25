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
        // Brand palette — deep forest green + warm cream accent.
        forest: {
          DEFAULT: '#23362F',
          950: '#1a2823',
          900: '#23362F',
          800: '#2d4940',
          700: '#3B6656',
          600: '#4a7568',
          500: '#5e8a7c',
          400: '#85a99e',
          300: '#aec3bb',
          200: '#d3dcd7',
          100: '#e8eeeb',
          50: '#f4f7f5',
        },
        cream: {
          DEFAULT: '#DFDAC0',
          200: '#DFDAC0',
          100: '#ece8d4',
          50: '#f5f3e8',
        },
        // Neutrals — kept as ink-* for backwards compatibility with existing class names.
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
        card: '0 1px 2px 0 rgb(35 54 47 / 0.04), 0 1px 1px 0 rgb(35 54 47 / 0.03)',
        'card-hover':
          '0 6px 18px -4px rgb(35 54 47 / 0.08), 0 2px 4px -1px rgb(35 54 47 / 0.04)',
        'brand-glow': '0 4px 14px 0 rgb(35 54 47 / 0.20)',
        'cream-glow': '0 0 0 4px rgb(223 218 192 / 0.40)',
      },
      backgroundImage: {
        'forest-gradient': 'linear-gradient(135deg, #23362F 0%, #3B6656 100%)',
        'cream-veil': 'linear-gradient(180deg, rgba(223,218,192,0) 0%, rgba(223,218,192,0.18) 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
