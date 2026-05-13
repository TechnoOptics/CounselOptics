# Advottic Design System — Portable Prompt

This is a self-contained spec to replicate Advottic's exact look-and-feel
on another product. It is written as a paste-able prompt for AI coding
assistants (Claude, Cursor, v0, etc.) and as a reference doc for human
designers. Swap the four "brand colors" at the top to re-skin for a
different product; the rest of the system stays as-is.

---

## ONE-LINER (paste into any AI coding assistant)

> Build my product UI in the **Advottic design system**: a calm, editorial
> SaaS aesthetic that pairs **deep-forest** + **warm-gold** + **cream
> neutrals**, with **Inter** for body text and **Fraunces** (or another
> variable serif) for display. Use the component recipes, motion patterns,
> and voice rules below. Replace the brand colors with mine (listed under
> "PRODUCT BRAND COLORS"). Keep every other value, animation, and pattern
> identical so the products feel like a family.

---

## 1. PRODUCT BRAND COLORS (the only thing you swap per product)

Replace the four values below for a new product. Everything else stays
constant — that's how the whole family looks consistent.

```
Brand primary (dark)   = #0F2D24   // forest-900 in Advottic
Brand primary (deep)   = #0a1f19   // forest-950
Brand accent (warm)    = #D5BB7E   // gold-500
Brand accent (deep)    = #b08229   // gold-700
```

Suggested swaps for related products in the family:

| Product       | Primary dark | Primary deep | Accent warm | Accent deep |
| ------------- | ------------ | ------------ | ----------- | ----------- |
| Advottic      | `#0F2D24`    | `#0a1f19`    | `#D5BB7E`   | `#b08229`   |
| Taxottic      | `#1C2F4A`    | `#0F1B2D`    | `#A8C2D9`   | `#5C7FA0`   |
| HealthOttic   | `#1A3D2F`    | `#0F2418`    | `#C9D4A6`   | `#7A8B58`   |
| EduOttic      | `#3A2A4F`    | `#221833`    | `#E4B8A0`   | `#A47765`   |

Keep the *relative luminosity* identical to Advottic's pair: a primary that
reads as "deep, serious, grown-up" and an accent that reads as "warm,
human, hand-crafted." Avoid bright tech-blue or neon — Advottic feels
trustworthy because its palette is what a quiet boutique law office would
choose, not what a startup pitch deck would choose.

---

## 2. FULL TAILWIND THEME

Drop this into `tailwind.config.ts` after swapping the four brand colors.
The fonts, sizes, shadows, and gradients are part of the look and should
NOT be changed without a strong reason.

```ts
import type { Config } from 'tailwindcss';
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
      },
      fontSize: {
        'display-xs': ['1.625rem', { lineHeight: '1.15', letterSpacing: '-0.01em' }],
        'display-sm': ['2rem', { lineHeight: '1.10', letterSpacing: '-0.01em' }],
        'display-md': ['2.5rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-lg': ['3rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        'display-xl': ['4.5rem', { lineHeight: '0.98', letterSpacing: '-0.02em' }],
      },
      colors: {
        // === SWAP THESE FOUR FOR A NEW PRODUCT ===
        forest: {
          DEFAULT: '#0F2D24', 950: '#0a1f19', 900: '#0F2D24', 800: '#173b30',
          700: '#23362F', 600: '#2d4940', 500: '#3B6656', 400: '#5e8a7c',
          300: '#9bb8ad', 200: '#cad9d2', 100: '#e3ece8', 50: '#f1f5f3',
        },
        gold: {
          DEFAULT: '#D5BB7E', 950: '#3E3520', 900: '#5C4F30', 800: '#7E6B41',
          700: '#A38A55', 600: '#C2A66A', 500: '#D5BB7E', 400: '#DEC68A',
          300: '#E5CE93', 200: '#EFE0B7', 100: '#F5EDD6', 50: '#FBF8EE',
        },
        // === KEEP THESE NEUTRALS THE SAME ===
        cream: { DEFAULT: '#f5edd6', 200: '#f5edd6', 100: '#fbf7e9', 50: '#fefcf3' },
        ink: {
          50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8',
          400: '#a1a1aa', 500: '#71717a', 600: '#52525b', 700: '#3f3f46',
          800: '#27272a', 900: '#18181b', 950: '#09090b',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 45 36 / 0.04), 0 1px 1px 0 rgb(15 45 36 / 0.03)',
        'card-hover': '0 6px 18px -4px rgb(15 45 36 / 0.10), 0 2px 4px -1px rgb(15 45 36 / 0.05)',
        'brand-glow': '0 8px 24px -4px rgb(15 45 36 / 0.30)',
        'gold-glow': '0 0 0 3px rgb(213 187 126 / 0.30)',
      },
      backgroundImage: {
        'forest-gradient': 'linear-gradient(135deg, #0F2D24 0%, #173b30 50%, #23362F 100%)',
        'gold-shine':
          'linear-gradient(135deg, #8a661f 0%, #c79532 12%, #f2d896 28%, #d4a14a 44%, #b08229 58%, #d4a14a 72%, #f2d896 88%, #c79532 100%)',
        'gold-metal':
          'linear-gradient(180deg, #f2d896 0%, #d4a14a 32%, #b08229 65%, #c79532 100%)',
      },
    },
  },
};
export default config;
```

---

## 3. TYPOGRAPHY

Three fonts. Load from Google Fonts via `next/font/google` (Next.js)
or `@import` (vanilla):

- **Inter** — body, UI labels, small text. Default sans.
  ```ts
  Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });
  ```
- **Fraunces** — display headlines, hero text. Variable serif with strong
  optical sizing; reads "editorial," not "tech." Weights 400, 500, 600, 700.
  ```ts
  Fraunces({ subsets: ['latin'], weight: ['400', '500', '600', '700'],
    display: 'swap', variable: '--font-display' });
  ```
- **Saira Condensed** — only the wordmark / logo. Weights 700, 800.
  Skip if you have a custom wordmark font.

**Display headlines** always use `font-display` + tight tracking (`-0.01em`
to `-0.02em`) + the `display-md` / `lg` / `xl` font-size tokens. Never set
the size in pixels at the call site — use the tokens so headings stay
consistent across pages.

**Italics on display:** italic body parts of hero headlines should be the
italic variant of the same display font, not a different font. See the
"gold-pan italic" pattern below for the signature flourish.

---

## 4. COMPONENT RECIPES (Tailwind `@layer components`)

Drop these straight into `globals.css`:

```css
@layer components {
  /* Buttons --------------------------------------------------------- */
  .btn {
    @apply relative inline-flex items-center justify-center gap-1.5
           rounded-lg px-4 py-2 text-sm font-medium tracking-tight
           transition-all duration-200 focus:outline-none focus-visible:ring-2
           focus-visible:ring-offset-2 focus-visible:ring-gold-500/60
           disabled:opacity-50 disabled:cursor-not-allowed
           active:scale-[0.98] overflow-hidden;
  }
  .btn-primary {
    @apply btn bg-forest-900 text-cream-50 shadow-brand-glow
           hover:bg-forest-800 hover:-translate-y-px hover:shadow-card-hover
           active:translate-y-0 active:bg-forest-950
           dark:bg-gold-metal dark:text-forest-950 dark:hover:brightness-110;
  }
  .btn-primary { color: #fbf7e9; }
  .dark .btn-primary { color: #0a1f19; }
  /* Subtle inner highlight on top edge - reads as polished metal */
  .btn-primary::after {
    content: ''; position: absolute; inset: 0 0 auto 0; height: 1px;
    background: linear-gradient(90deg, transparent 0%,
      rgba(213, 187, 126, 0.45) 50%, transparent 100%);
    pointer-events: none;
  }
  /* Diagonal sheen sweep on hover */
  .btn-primary::before {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(120deg, transparent 30%,
      rgba(213, 187, 126, 0.18) 50%, transparent 70%);
    transform: translateX(-120%);
    transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    pointer-events: none;
  }
  .btn-primary:hover::before { transform: translateX(120%); }

  .btn-secondary {
    @apply btn bg-white text-forest-900 border border-forest-200
           hover:border-gold-500 hover:bg-cream-50 hover:shadow-card
           dark:bg-forest-800/60 dark:text-cream-100 dark:border-forest-600
           dark:hover:bg-forest-700 dark:hover:border-gold-500;
  }
  .btn-ghost {
    @apply btn bg-transparent text-forest-900 hover:bg-cream-50
           hover:text-forest-700 dark:text-cream-100
           dark:hover:bg-forest-800/60;
  }
  .btn-accent {
    @apply btn bg-gold-shine text-forest-900 hover:opacity-90 shadow-sm;
  }

  /* Inputs ---------------------------------------------------------- */
  .input {
    @apply w-full rounded-lg border border-ink-200 bg-white px-3 py-2
           text-sm placeholder:text-ink-400 focus:outline-none
           focus:ring-2 focus:ring-forest-700/15 focus:border-forest-700
           transition-colors dark:bg-forest-900/60 dark:border-forest-600
           dark:text-cream-100 dark:placeholder:text-cream-100/40
           dark:focus:ring-gold-500/20 dark:focus:border-gold-500;
    scroll-margin-top: 5rem;
    font-size: max(16px, 0.875rem); /* iOS no-zoom */
  }
  /* Per-field invalid state (only after user interaction) */
  .input:user-invalid {
    @apply border-rose-300 ring-2 ring-rose-200/60
           dark:border-rose-500/60 dark:ring-rose-700/30;
  }
  .label {
    @apply block text-sm font-medium text-forest-900 mb-1.5 dark:text-cream-100;
  }

  /* Cards ---------------------------------------------------------- */
  .card {
    @apply rounded-xl border border-ink-200 bg-white shadow-card
           transition-all duration-300 dark:bg-forest-900/70
           dark:border-forest-700/60 dark:text-cream-100;
    scroll-margin-top: 5rem;
  }
  .card-hover { @apply card relative overflow-hidden; }
  .card-hover:hover {
    transform: translateY(-2px);
    border-color: rgba(213, 187, 126, 0.55);
    box-shadow: 0 14px 36px -10px rgba(15, 45, 36, 0.14),
                0 0 0 1px rgba(213, 187, 126, 0.18);
  }
  .card-hover::after {
    content: ''; position: absolute; inset: 0;
    background: radial-gradient(400px 200px at 100% 0%,
      rgba(213, 187, 126, 0.10), transparent 60%);
    opacity: 0; transition: opacity 0.4s ease; pointer-events: none;
  }
  .card-hover:hover::after { opacity: 1; }

  /* Premium "luminous" card - gold-tinted gradient ring baked into border.
     Use for hero blocks, pricing tier highlights, hero forms. */
  .card-luminous {
    @apply card relative overflow-hidden;
    background:
      linear-gradient(#fff, #fff) padding-box,
      linear-gradient(135deg,
        rgba(213, 187, 126, 0.55) 0%,
        rgba(245, 237, 214, 0.20) 35%,
        rgba(213, 187, 126, 0.35) 65%,
        rgba(245, 237, 214, 0.55) 100%) border-box;
    border: 1px solid transparent;
  }
  .dark .card-luminous {
    background:
      linear-gradient(#0f2d24, #0f2d24) padding-box,
      linear-gradient(135deg,
        rgba(213, 187, 126, 0.65) 0%,
        rgba(245, 237, 214, 0.18) 35%,
        rgba(213, 187, 126, 0.55) 65%,
        rgba(245, 237, 214, 0.45) 100%) border-box;
  }

  /* "AI" card - dark forest with gold-on-green gradient + pulsing aurora.
     Use for AI assistant surfaces, processing states. */
  .card-ai {
    @apply rounded-xl text-cream-100 shadow-card relative overflow-hidden;
    background:
      radial-gradient(700px 280px at 100% -20%,
        rgba(213, 187, 126, 0.28), transparent 60%),
      linear-gradient(160deg, #1a3d31 0%, #0f2d24 60%, #0a1f19 100%);
    border: 1px solid rgba(213, 187, 126, 0.22);
  }

  /* Badges --------------------------------------------------------- */
  .badge {
    @apply inline-flex items-center rounded-full px-2.5 py-0.5
           text-xs font-medium;
  }
  .badge-brand { @apply badge bg-forest-900 text-white; }
  .badge-accent { @apply badge bg-cream-200 text-forest-900; }

  /* Eyebrow - the signature pre-headline hairline ------------------- */
  .eyebrow {
    @apply inline-flex items-center gap-2 text-[11px] uppercase
           tracking-[0.18em] font-semibold text-gold-700;
  }
  .eyebrow::before {
    content: ''; display: inline-block;
    width: 14px; height: 1.5px; background: currentColor;
    border-radius: 2px; flex: none;
  }

  /* Tabs ----------------------------------------------------------- */
  .tab {
    @apply relative px-5 py-3.5 text-sm font-medium whitespace-nowrap
           text-ink-500 transition-colors duration-200
           hover:text-forest-900 hover:bg-cream-50/60;
  }
  .tab-active { @apply text-forest-900; }
  .tab-underline {
    @apply absolute inset-x-4 bottom-0 h-0.5 bg-forest-900 rounded-t;
  }

  /* Header nav link with subtle gold underline on hover */
  .nav-link {
    @apply relative px-3 py-2 rounded-md text-cream-100/85
           transition-colors hover:text-cream-100 hover:bg-forest-800;
  }
  .nav-link::after {
    content: ''; position: absolute; left: 12px; right: 12px;
    bottom: 4px; height: 1.5px;
    background: theme('colors.gold.500'); border-radius: 2px;
    transform: scaleX(0); transform-origin: left center;
    transition: transform 0.25s ease-out;
  }
  .nav-link:hover::after { transform: scaleX(1); }

  /* Brand mark - deep forest tile with gold figure */
  .brand-mark {
    background-image: linear-gradient(135deg, #0f2d24 0%, #173b30 100%);
  }

  /* Hero background - lighter forest base, multiple warm radial spots */
  .hero-bg {
    position: relative; isolation: isolate;
    background:
      radial-gradient(ellipse 700px 400px at 88% 14%,
        rgba(245, 237, 214, 0.32), transparent 55%),
      radial-gradient(ellipse 900px 520px at 72% 28%,
        rgba(213, 187, 126, 0.38), transparent 60%),
      radial-gradient(ellipse 620px 380px at 12% 82%,
        rgba(213, 187, 126, 0.22), transparent 65%),
      radial-gradient(ellipse 480px 320px at 50% 110%,
        rgba(245, 237, 214, 0.10), transparent 60%),
      linear-gradient(135deg, #1f4839 0%, #2a5a47 38%, #19372d 100%);
  }
  .hero-bg::before {
    content: ''; position: absolute; inset: 0; z-index: -1;
    background-image: radial-gradient(rgba(245, 237, 214, 0.06) 1px,
      transparent 1px);
    background-size: 28px 28px;
    -webkit-mask-image: radial-gradient(ellipse 720px 400px at 50% 40%,
      black 30%, transparent 78%);
    mask-image: radial-gradient(ellipse 720px 400px at 50% 40%,
      black 30%, transparent 78%);
    pointer-events: none;
  }

  /* Soft glassy gold/cream orbs for hero floating-light effect */
  .hero-orb { position: absolute; border-radius: 9999px;
    filter: blur(40px); pointer-events: none; opacity: 0.55; }
  .hero-orb--gold {
    background: radial-gradient(circle,
      rgba(213, 187, 126, 0.55) 0%, rgba(213, 187, 126, 0) 70%);
  }
  .hero-orb--cream {
    background: radial-gradient(circle,
      rgba(245, 237, 214, 0.45) 0%, rgba(245, 237, 214, 0) 70%);
  }

  /* Hairline rule with soft gold midpoint */
  .gold-rule {
    height: 1px;
    background: linear-gradient(90deg, transparent 0%,
      rgba(213, 187, 126, 0.35) 50%, transparent 100%);
  }
}
```

---

## 5. MOTION SYSTEM

```css
/* Soft-pulse halo for "AI is alive" surfaces */
@keyframes co-aurora {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(213, 187, 126, 0),
                0 0 0 0 rgba(245, 237, 214, 0);
  }
  50% {
    box-shadow: 0 0 0 4px rgba(213, 187, 126, 0.18),
                0 0 14px 2px rgba(245, 237, 214, 0.20);
  }
}
.aurora { animation: co-aurora 3.4s ease-in-out infinite; }

/* Status "live" dot - softer than a hard blink */
@keyframes co-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.9); }
}
.live-dot { animation: co-pulse 1.8s ease-in-out infinite; }

/* Slow gold shimmer panning across gold-shine text */
@keyframes co-gold-pan {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.gold-pan { background-size: 200% 200%;
            animation: co-gold-pan 8s ease-in-out infinite; }

/* Entrance: fade-up by 10px over 600ms with a "settle" easing */
@keyframes co-fade-up {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-fade-up { animation: co-fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }

/* Subtle glow for primary buttons / featured CTAs */
@keyframes co-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(213, 187, 126, 0); }
  50%      { box-shadow: 0 0 24px 0 rgba(213, 187, 126, 0.35); }
}
.animate-glow { animation: co-glow 3s ease-in-out infinite; }

/* Stagger entrance for child cards / tier columns */
.stagger > * { opacity: 0;
              animation: co-fade-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) both; }
.stagger > *:nth-child(1) { animation-delay: 0.04s; }
.stagger > *:nth-child(2) { animation-delay: 0.10s; }
.stagger > *:nth-child(3) { animation-delay: 0.16s; }
.stagger > *:nth-child(4) { animation-delay: 0.22s; }
.stagger > *:nth-child(5) { animation-delay: 0.28s; }
.stagger > *:nth-child(6) { animation-delay: 0.34s; }
.stagger > *:nth-child(7) { animation-delay: 0.40s; }
.stagger > *:nth-child(8) { animation-delay: 0.46s; }
.stagger > *:nth-child(n+9) { animation-delay: 0.52s; }

/* Respect prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  .animate-fade-up, .animate-fade-in, .animate-float, .animate-glow,
  .gold-pan, .aurora, .live-dot {
    animation: none !important;
  }
}
```

**Rule:** entrance animations are calm (≤600ms, easing
`cubic-bezier(0.16, 1, 0.3, 1)`), and continuous animations (aurora,
gold-pan, glow) cycle ≥3s. Nothing flashes faster than 1.8s. Reduced-motion
support is mandatory.

---

## 6. SIGNATURE UI PATTERNS

### 6a. Cookie banner (privacy-first language)

The cookie banner is short, plain, and decline-friendly. Not a dark pattern.

```tsx
<div className="fixed bottom-4 inset-x-4 sm:left-auto sm:right-6 sm:max-w-md
                rounded-2xl bg-white dark:bg-forest-950 ring-1
                ring-forest-200 dark:ring-forest-700/60 shadow-card-hover
                p-5 space-y-3 z-50">
  <p className="text-[10px] font-semibold uppercase tracking-[0.22em]
                text-gold-700 dark:text-gold-300">
    Cookies & privacy
  </p>
  <h3 className="font-semibold text-forest-900 dark:text-cream-100">
    Your preferences
  </h3>
  <p className="text-[13px] text-ink-600 dark:text-cream-100/70 leading-relaxed">
    We only use cookies that keep you signed in and the service running.
    No advertising trackers, ever. We never sell your data.
  </p>
  <div className="flex flex-wrap gap-2">
    <button className="btn-primary text-[12px] px-3 py-1.5">
      Accept essentials
    </button>
    <button className="btn-secondary text-[12px] px-3 py-1.5">
      Configure
    </button>
    <button className="btn-ghost text-[12px] px-3 py-1.5 underline">
      Decline non-essentials
    </button>
  </div>
  <p className="text-[10.5px] text-ink-500 dark:text-cream-100/55">
    <a href="/cookies" className="underline">Cookie Policy</a> ·
    <a href="/privacy" className="underline">Privacy</a> ·
    <a href="/terms" className="underline">Terms</a>
  </p>
</div>
```

### 6b. Consent / Acceptance modal (the "one quick consent before you start")

Hard-gate modal shown ONCE on first sign-in. No click-out, modal scroll
locked. Three rules: name the cost upfront ("one-time, ~30 seconds"),
spell out what they're agreeing to in plain English (5 bullet points),
explicit checkbox, no checked-by-default.

```tsx
<div role="dialog" aria-modal="true"
     className="fixed inset-0 z-[55] flex items-start justify-center
                px-4 py-6 sm:py-10 overflow-y-auto">
  <div className="absolute inset-0 bg-forest-950/82 backdrop-blur-md
                  animate-fade-in" />
  <div className="relative w-full max-w-2xl rounded-2xl border
                  border-gold-300/40 bg-white shadow-card-hover
                  overflow-hidden animate-fade-up"
       style={{ boxShadow: '0 0 0 1px rgba(213,187,126,0.4), 0 22px 60px -12px rgba(15,45,36,0.55), 0 0 80px rgba(213,187,126,0.18)' }}>
    {/* Brand strip header */}
    <div className="brand-mark text-cream-200 px-6 py-5">
      <p className="text-[10px] tracking-[0.28em] uppercase font-semibold
                    text-gold-300">
        Thanks for signing up
      </p>
      <h2 className="text-xl md:text-2xl font-semibold tracking-tight
                     text-cream-100 mt-1">
        Welcome. One quick consent before you start.
      </h2>
      <p className="text-cream-100/80 text-sm mt-1.5 max-w-xl leading-relaxed">
        We just need your acceptance of our terms before any data is created
        on your behalf. This is a one-time step; a quick tour follows.
      </p>
    </div>
    {/* Scrollable form area */}
    <form className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
      {/* Plain-English agreement scroll */}
      <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-4
                      text-sm text-ink-800 leading-relaxed space-y-3
                      max-h-56 overflow-y-auto">
        <p className="font-semibold text-ink-950">
          You acknowledge and agree to the following:
        </p>
        <ol className="list-decimal list-outside pl-5 space-y-2 text-[13px]">
          <li><strong>Not [domain] advice.</strong> Plain-English what
            the product does and doesn't do.</li>
          <li><strong>Security &amp; privacy.</strong> One paragraph on
            encryption, processing, your control over data.</li>
          <li><strong>Limitation of liability.</strong> One paragraph on
            cap (e.g., "greater of $100 or fees paid in prior 12 months").</li>
          <li><strong>Arbitration; class-action waiver.</strong> One
            paragraph naming the seat and law.</li>
          <li><strong>Acceptable use.</strong> One paragraph naming
            what's prohibited.</li>
        </ol>
      </div>
      {/* Explicit checkbox - NEVER pre-checked */}
      <label className="flex items-start gap-3 text-sm text-ink-800 cursor-pointer">
        <input type="checkbox" name="consent" required
               className="mt-1 h-4 w-4 rounded border-ink-300 text-forest-900
                          focus:ring-forest-900" />
        <span className="leading-relaxed">
          I have read and agree to the items above, the
          <a href="/terms" className="underline mx-1">Terms of Use</a> and
          <a href="/privacy" className="underline mx-1">Privacy Policy</a>,
          including the <strong>binding arbitration, class-action waiver,
          and jury-trial waiver</strong>.
        </span>
      </label>
      <div className="flex justify-end pt-1">
        <button type="submit" className="btn-primary">
          Approve &amp; continue
        </button>
      </div>
    </form>
  </div>
</div>
```

### 6c. User menu (avatar + portal switcher + "Switch account")

A dropdown anchored to the avatar with three sections:
1. **User identity card** at top: name + email + role badge
2. **Main links** (Profile, Settings, etc.)
3. **Switch portal** cluster (when user has access to multiple sub-products)
4. **Switch account** + **Sign out** at bottom

```tsx
<div role="menu" className="absolute right-0 mt-2 w-72 rounded-xl
                            border border-forest-200 bg-white
                            shadow-card-hover overflow-hidden z-50">
  {/* Identity */}
  <div className="px-4 py-3 border-b border-ink-100">
    <p className="font-semibold text-ink-950 text-sm truncate">
      {displayName}
    </p>
    <p className="text-xs text-ink-500 truncate">{email}</p>
    {isAdmin && (
      <span className="badge bg-forest-900 text-cream-200 mt-2">Admin</span>
    )}
  </div>
  {/* Main links */}
  <div className="py-1">
    <Link href="/profile" className="block px-4 py-2.5 text-sm
                                     text-ink-800 hover:bg-cream-50
                                     hover:text-forest-900">
      Profile &amp; settings
    </Link>
    {/* etc */}
  </div>
  {/* Switch portal (only if user has access to multiple) */}
  <div className="border-t border-ink-100 py-1.5">
    <p className="px-4 pt-1 pb-1 text-[10px] uppercase tracking-[0.18em]
                  font-semibold text-ink-500">
      Switch portal
    </p>
    {/* hard <a> not Link so the chrome layout re-renders */}
    <a href="/admin" className="flex items-center gap-2.5 px-4 py-2
                                 text-sm text-ink-800 hover:bg-cream-50">
      <span className="h-5 w-5 rounded inline-flex items-center
                       justify-center text-forest-950 text-[11px]
                       font-semibold"
            style={{ background: 'linear-gradient(135deg, #f5edd6 0%, #d5bb7e 50%, #c9a96e 100%)' }}>
        HQ
      </span>
      <span className="flex-1 truncate font-medium">Admin HQ</span>
      <span className="text-ink-400">→</span>
    </a>
  </div>
  {/* Bottom: Switch account + Sign out */}
  <div className="border-t border-ink-100">
    <form action="/auth/sign-out" method="post">
      <input type="hidden" name="next" value="/sign-in?switch=1" />
      <button className="w-full text-left px-4 py-2.5 text-sm
                         text-ink-800 hover:bg-cream-50 hover:text-forest-900">
        Switch account
      </button>
    </form>
    <form action="/auth/sign-out" method="post">
      <button className="w-full text-left px-4 py-2.5 text-sm
                         text-rose-700 hover:bg-rose-50">
        Sign out
      </button>
    </form>
  </div>
</div>
```

### 6d. Editable sidebar (user-arrangeable navigation)

Each nav item has a stable `id` (use the `href` as the id). Edit mode
shows a pencil icon next to the section title; clicking flips the
sidebar into edit mode with up/down arrows and an eye-toggle on each
item. Save persists `{ hidden: string[], order: string[] }` to the user
profile.

Three states per item in edit mode:
1. **Visible:** eye icon, drag/move-up/move-down active
2. **Hidden:** eye-with-slash, grayed out
3. **Locked:** items that must stay visible (e.g., "Profile") have no
   hide affordance

### 6e. Tier / pricing cards

```tsx
<div className={`card p-7 sm:p-8 relative ${tier.emphasized
  ? 'card-luminous ring-1 ring-gold-300/50 shadow-card-hover'
  : ''}`}>
  {tier.emphasized && (
    <span className="absolute -top-3 left-7 inline-flex items-center
                     gap-1 rounded-full bg-gold-shine text-forest-950
                     px-3 py-0.5 text-[10px] font-semibold uppercase
                     tracking-[0.18em] shadow-sm">
      Most popular
    </span>
  )}
  <p className="eyebrow">{tier.name}</p>
  <p className="font-display text-4xl font-medium tracking-[-0.02em]
                text-forest-900 dark:text-cream-100 mt-2">
    {tier.price}
    <span className="text-base text-ink-500 font-sans font-normal">
      {' '}{tier.cadence}
    </span>
  </p>
  <p className="text-sm text-ink-600 dark:text-cream-100/70 mt-2
                leading-relaxed">
    {tier.blurb}
  </p>
  <ul className="mt-6 space-y-2.5 text-sm text-ink-700
                 dark:text-cream-100/80">
    {tier.features.map((f) => (
      <li key={f} className="flex items-start gap-2.5">
        <CheckMark />
        <span>{f}</span>
      </li>
    ))}
  </ul>
  <Link href={tier.cta.href} className={tier.emphasized
    ? 'btn-primary mt-7 w-full' : 'btn-secondary mt-7 w-full'}>
    {tier.cta.label}
  </Link>
</div>
```

### 6f. Sign-in screen (the calm OAuth landing)

```
[Card-luminous wrapper]
  [Faint brand mark floating in the background, 7% opacity]
  Eyebrow: "Welcome"
  Display heading: "Sign in or create an account"
  Subtitle: plain-English of what happens on first sign-in
  [Continue with Google]   (btn-secondary with provider icon)
  [Continue with Microsoft] (btn-secondary)
  ─── OR ───
  [Email input]
  [Email me a sign-in code] (btn-primary, full width)
  Footer fine-print: not legal advice / [Learn more]
```

### 6g. Gold-shine italic display flourish

The signature display headline pattern. Use sparingly — once per page
maximum, ideally only in the hero:

```tsx
<h1 className="font-display text-display-xl text-forest-900
               dark:text-cream-100">
  Big things rarely happen<br />
  <span className="bg-gold-shine bg-clip-text text-transparent gold-pan
                   italic">
    all at once.
  </span>
</h1>
```

The italic clause shimmers slowly via the `gold-pan` animation. Don't
animate the entire headline — only the italic display fragment.

---

## 7. VOICE & WRITING STYLE

Calm, plainspoken, present-tense, never breathless. A few rules from
copy across Advottic:

- **Headlines name the feeling first, the feature second.** "Big things
  rarely happen all at once." (feeling) then in the subhead: "Most cases
  are built quietly, one note and one document at a time." (feature)
- **One number per claim, no superlatives.** "7-day free trial" not
  "industry-leading trial." "AES-256 at rest" not "bank-grade security."
- **Plural-aware copy.** "1 case" / "20 cases" — not "1 case(s)."
- **No em-dashes (—) anywhere user-facing.** Replace with hyphen, comma,
  colon, or rephrase. Em-dashes read as machine-generated.
- **No marketing fluff.** Replace "leverage", "synergize", "world-class",
  "best-in-class" with the specific thing the feature does.
- **Cost transparency.** "$19/mo" not "starting at $19." "20 cases
  included" not "generous case limit."
- **Compassion on rough edges.** "If you face possible incarceration,
  request a public defender at your first court appearance" sits in the
  footer of a paid product. Sister-product equivalent: name the
  free-or-low-cost alternative when the paid product isn't right.

---

## 8. ACCESSIBILITY GUARDRAILS

- All interactive elements have visible focus rings using
  `focus-visible:ring-2 focus-visible:ring-gold-500/60
  focus-visible:ring-offset-2`. Never `outline-none` without a replacement.
- Color is never the only signal of state. The `live-dot` pairs an
  emerald color with a pulse animation. Error states pair the rose color
  with `aria-invalid` and the validation message text.
- `prefers-reduced-motion` disables continuous animations (aurora,
  gold-pan, glow).
- Modal dialogs use `role="dialog"` + `aria-modal="true"` + a focusable
  close affordance + body-scroll-lock.
- The consent modal is **never click-out dismissable**. A choice is
  required before any user data is created.
- All `<img>` tags carry meaningful `alt` text (decorative icons get
  `alt=""` and `aria-hidden`).

---

## 9. WHAT TO AVOID

Things that break the Advottic feel:

- **Bright blue tech accents.** Stripe-blue, Linear-purple, GitHub-magenta
  all clash. Stay in the warm-forest / cream / gold band.
- **Heavy sans-serif display.** Inter / Helvetica at 60px reads as
  "startup pitch deck." Use Fraunces or similar variable serif for hero
  text.
- **Hard-edged cards.** Everything rounds to `rounded-xl` (12px) or
  `rounded-2xl` (16px). No square cards. No 4-pixel rounding.
- **Drop shadows that look like elevation icons.** Our shadows are subtle
  + warm-tinted (`rgb(15 45 36 / 0.04)` base). Never use pure-black
  shadows.
- **Hover effects that move >2px or scale >2%.** Buttons translate by
  `1px`, cards by `2px`. Anything more reads as a video game.
- **Animations faster than 200ms or longer than 700ms.** Everything in
  between feels intentional. Outside that band feels twitchy or sluggish.
- **Stock photography.** Use in-house SVG iconography (the SVGs in
  `/components` are all hand-drawn 24x24 strokes). Stock photos read as
  generic; SVGs read as "they thought about this."
- **Emoji in product copy.** Emojis read as casual; the brand reads as
  calm-professional. The one exception is the live-dot's emerald color
  serving as a non-emoji "active" indicator.

---

## 10. HOW TO PROMPT AN AI ASSISTANT WITH THIS

Three patterns that work well:

**Pattern A — full re-skin from scratch:**
> "Build the [feature] following the Advottic design system attached.
> Brand colors for this product are [primary] / [accent]. Everything else
> in the design system stays as-is. Start with the Tailwind config, then
> globals.css, then the feature components."

**Pattern B — adapt an existing component:**
> "Take this existing [Button / Card / Modal] and rewrite it to match the
> Advottic design system attached. Keep the props and behavior; replace
> only the visual surface."

**Pattern C — quick palette swap:**
> "Re-skin this Advottic-styled component for [new product]. The only
> change is the four brand colors: primary `#NEW`, deep `#NEW`, accent
> `#NEW`, accent-deep `#NEW`. Everything else (typography, motion,
> shadows, gradients) stays identical."

For best results, paste this entire file as a single attachment. The
AI assistant will then have the full system in context and can produce
matching components on the first try.
