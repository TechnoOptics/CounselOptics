# Techottic UI spec, and how to port it into Advottic

Status: study only. Nothing in Techottic was modified. Nothing in Advottic has been
modified. This document is the instruction set another engineer follows to make the
Advottic web portals (`app/counsel/**`, `app/portal/**`) read the way Techottic reads.

Companion doc: `docs/DESIGN_SYSTEM.md` (Advottic's existing system). Where the two
disagree, this doc says explicitly which one wins.

---

## (a) What Techottic is, and where it lives

**Path:** `/Users/technooptics/Techottic`
**Git remote:** `https://github.com/TechnoOptics/techottic.git`
**package.json name:** `techottic`
**What it is:** an IT service-management web app (tickets, assets, live coverage map,
onboarding, knowledge base, RBAC, approvals, projects, wallboard). Self-described in its
README as "the all-in-one IT command center." Demo domain in the seed data is
`techottic.io`; the real domain `techottic.com` sits at GoDaddy and there is an Azure AD
app registration of the same name wired up in `src/lib/entra.ts` / `src/lib/msauth.ts`
for Microsoft SSO.

### Candidates considered

| Path | What it actually is | Verdict |
| --- | --- | --- |
| `/Users/technooptics/Techottic` | Next.js 16 App Router web app, 132 source files, ~70 real pages, Tailwind v4 | **This is it.** The only candidate with a web portal UI. |
| `/Users/technooptics/Projects/taxottic` | Different product. Capacitor mobile app (`ios/`, `android/`, `capacitor.config.ts`), remote `github.com/TechnoOptics/taxottic.git`, package name `taxottic` | Different app, not a naming variant |
| `/Users/technooptics/Developer/taxottic` | Contains one file, an Apple auth key `AuthKey_TSVQX5CWM3.p8` | Not a project |
| `/Users/technooptics/Taxottic` | Two folders of App Store screenshots | Not a project |
| `/Users/technooptics/CompanyApp/.git/worktrees/techottic` | A git worktree inside the Zinpro One monorepo that happens to be named `techottic` | Unrelated, name collision only |

Techottic and Taxottic are two separate products from the same author. Only Techottic has
the portal look worth copying.

### Stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js `16.2.12`, App Router, React `19.2.4`, server components read SQLite directly, mutations are server actions |
| Styling | **Tailwind v4** via `@tailwindcss/postcss`. There is **no `tailwind.config.*` file**. All tokens are declared in `src/app/globals.css` inside an `@theme inline { }` block |
| Component library | None. Every primitive is hand-written in one 148-line file, `src/components/ui.tsx` |
| Icons | `lucide-react` `^1.27.0`. Clean stroke SVGs, sized 16 in nav, 14 to 15 inline, 12 in dense chips |
| Charts | `recharts` `^3.10.1` |
| Map | `react-leaflet` `^5.0.0` with CARTO dark tiles |
| Fonts | `Geist` and `Geist_Mono` from `next/font/google`, exposed as `--font-geist-sans` / `--font-geist-mono` and aliased in `@theme inline` to `--font-sans` / `--font-mono`. Two runtime overrides on `<html data-font>`: `system` and `serif` |

---

## (b) The token system, with real values

Everything below is verbatim from `/Users/technooptics/Techottic/src/app/globals.css`.

### Colour

Themes are two flat blocks of CSS custom properties selected by `data-theme` on `<html>`.
There is no per-component colour logic anywhere in the app shell.

```css
:root,
[data-theme="dark"] {
  --background: #0a0a0b;
  --surface: #101012;
  --surface-2: #17171a;
  --border: #232327;
  --border-bright: #33333a;
  --foreground: #f4f4f5;
  --muted: #9c9ca6;
  --accent: #059669;
  --accent-2: #34d399;
  --code-bg: rgba(0, 0, 0, 0.32);
  --code-fg: #6ee7b7;
  color-scheme: dark;
}

[data-theme="light"] {
  --background: #f6f6f7;
  --surface: #ffffff;
  --surface-2: #f0f0f2;
  --border: #e2e2e6;
  --border-bright: #cfcfd6;
  --foreground: #17171b;
  --muted: #5d5d68;
  --accent: #059669;
  --accent-2: #10b981;
  --code-bg: rgba(0, 0, 0, 0.06);
  --code-fg: #047857;
  color-scheme: light;
}
```

Bridged into Tailwind utilities:

```css
@theme inline {
  --color-background: var(--background);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-edge: var(--border);
  --color-edge-bright: var(--border-bright);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-accent: var(--accent);
  --color-accent-2: var(--accent-2);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

Note the naming: the border token is exposed as `edge`, so call sites read
`border-edge` and `hover:border-edge-bright`. That naming is deliberate and it is what
makes the hover convention readable across 70 pages.

**Nine tokens carry the entire UI.** There is no 50-to-950 ramp. Three surfaces
(`background` / `surface` / `surface-2`), two borders (`edge` / `edge-bright`), two text
colours (`foreground` / `muted`), two accents.

**Runtime accent override.** `src/app/layout.tsx` writes the org's chosen accent straight
onto the html element: `style={{ ["--accent"]: settings.accent }}`. One line, and the whole
product re-tints.

### Semantic colour (fixed, never themed)

Declared as plain hex maps in `src/components/ui.tsx`:

```ts
const STATUS_COLORS: Record<string, string> = {
  New: "#38bdf8",
  Open: "#e2e8f0",
  "In Progress": "#fbbf24",
  "Pending Customer": "#f472b6",
  "On Hold": "#94a3b8",
  Escalated: "#ef4444",
  Resolved: "#34d399",
  Closed: "#64748b",
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: "#ef4444", P2: "#f97316", P3: "#eab308", P4: "#64748b",
};
```

Plus, from `ARCHITECTURE.md`: red = danger, amber = warning, gold `#eab308` = VIP,
violet = parent incident. These never change with theme.

### The single most portable idea in the whole codebase: the badge triple

Every status pill, priority chip and VIP marker derives all three of its colours from
**one** hex, using fixed alpha suffixes:

```
text        = c
background  = c + "1a"   (10% alpha)
border      = c + "40"   (25% alpha)
```

VIP uses a slightly stronger variant (`c + "1f"` background, `c + "55"` border). That is
the entire badge system. It gives perfect visual consistency across an unbounded set of
states without writing a single new class.

### Radius scale

| Token | Used for |
| --- | --- |
| `rounded-md` (6px) | env badge, priority chip, tiny icon buttons |
| `rounded-lg` (8px) | `.field`, `.btn-primary`, `.btn-ghost`, dropdown rows |
| `rounded-xl` (12px) | nav rows, list rows, notification bell, palette result rows |
| `14px` | `.card`, hardcoded in CSS, deliberately between `xl` and `2xl` |
| `rounded-2xl` (16px) | tab bars, filter-chip strips, banner strip |
| `rounded-full` | status pills, avatars, health dots |

### Shadow scale

Almost none. That is the point.

```css
.card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35); }
[data-theme="light"] .card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }
```

`shadow-2xl` appears only on things that float above the page: the command palette panel,
the notification dropdown, the column picker. Elevation is communicated by **border
brightness**, not by shadow.

### Type scale

There is no custom `fontSize` config. The scale is stock Tailwind, applied with strict
discipline:

| Role | Class string |
| --- | --- |
| Page title | `text-2xl font-bold tracking-tight` |
| Stat value | `text-3xl font-bold` (colour set inline per stat) |
| Section title | `text-sm font-semibold uppercase tracking-wider text-muted` |
| Nav group eyebrow | `text-[10px] font-bold uppercase tracking-[0.14em] text-muted/70` |
| Stat label | `text-xs font-medium uppercase tracking-wider text-muted` |
| Table header | `text-[10px] uppercase tracking-wider text-muted` |
| Body | `text-sm` |
| Long-form body | `text-sm leading-relaxed text-foreground/90` |
| Meta / secondary | `text-xs text-muted` |
| Dense chip | `text-[11px] font-bold tracking-wide` |
| Identifiers | `font-mono text-xs text-muted` |

One family (Geist) does everything. Hierarchy comes from weight, case, tracking and the
`foreground` / `muted` split, not from a second typeface.

### Spacing rhythm

| Slot | Value |
| --- | --- |
| Sidebar width | `w-60` (240px), main column offset `ml-60` |
| Main content padding | `p-6` |
| Header padding | `px-6 py-3` |
| Sidebar brand block | `px-5 py-5`, nav `px-3 py-4`, footer `p-3` |
| Card padding | `p-4` compact, `p-5` comfortable, `p-6` to `p-8` for forms and hero blocks |
| Stat grid | `grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-8` |
| Section grid | `grid gap-6 lg:grid-cols-2`, `grid gap-6 xl:grid-cols-3` |
| Two-pane detail | `grid gap-6 lg:grid-cols-[1fr_340px]` (tickets), `lg:grid-cols-[1.5fr_1fr]` (portal) |
| List item spacing | `space-y-2` |
| Vertical section spacing | `space-y-6` |
| Table cells | `px-3 py-2.5` |
| Page container caps | `mx-auto max-w-2xl` / `max-w-3xl` / `max-w-4xl` / `max-w-5xl` / `max-w-6xl` chosen per page. The app shell itself is full-bleed |

### Dark mode

Yes, a real one, and it is cheap:

- `data-theme` on `<html>`, resolved server-side in `src/app/layout.tsx`. A per-user
  `tk_theme` cookie beats the platform default from `getPlatformSettings()`.
- `ThemeToggle` (`src/components/theme-toggle.tsx`) flips `document.documentElement.dataset.theme`
  **and** writes the cookie, so the change is instant and survives reload with no flash.
- It reads current theme through `useSyncExternalStore` off the DOM rather than
  `useState` + `useEffect`, so there is no mount-time render cascade and no hydration flash.
- Theme can be scoped to a subtree. `/wallboard` forces `data-theme="dark"` on its own root.
- House rule from `ARCHITECTURE.md`, quoted: never hardcode white or near-black for text
  or chart marks; use `var(--foreground)` / `var(--muted)`. (The codebase violates its own
  rule in `charts.tsx` and the Leaflet block. See section (f).)

### Global texture

```css
body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans), system-ui, sans-serif;
  background-image: radial-gradient(900px 420px at 75% -12%, rgba(16, 185, 129, 0.05), transparent 65%);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--muted) 35%, transparent); border-radius: 8px; }
::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, var(--muted) 55%, transparent); }

.glow-line {
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--foreground) 14%, transparent), transparent);
  height: 1px;
}
```

One 5%-opacity accent wash in the top right corner, fixed so it does not scroll. That is
the entire "atmosphere" budget.

---

## (c) The shell and layout recipe

Source: `/Users/technooptics/Techottic/src/app/(app)/layout.tsx` (97 lines total).

```
<div className="flex min-h-screen">
  <aside  fixed 240px rail  />
  <div className="ml-60 flex min-h-screen flex-1 flex-col">
    [banner strip]
    <header sticky />
    <main className="flex-1 p-6">{children}</main>
  </div>
</div>
```

Actual class strings, verbatim:

```tsx
// Root
<div className="flex min-h-screen">

// Sidebar
<aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-edge bg-surface/80 backdrop-blur-xl">

// Brand block
<div className="flex items-center gap-2 px-5 py-5">

// Hairline under the brand
<div className="glow-line mx-4" />

// Nav scroller
<nav className="flex-1 overflow-y-auto px-3 py-4">

// Sidebar footer (avatar + role + sign out)
<div className="border-t border-edge p-3">
  <div className="flex items-center gap-3 rounded-xl p-2">
    <Link className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:bg-surface-2/70">

// Main column
<div className="ml-60 flex min-h-screen flex-1 flex-col">

// Header
<header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-edge bg-background/70 px-6 py-3 backdrop-blur-xl">

// Content
<main className="flex-1 p-6">{children}</main>
```

Key structural decisions:

1. **Sidebar is fixed, not sticky, and the main column is offset with a hard `ml-60`.**
   No flex sibling, no grid template. Simple and it never fights sticky headers.
2. **Both pieces of chrome are translucent with `backdrop-blur-xl`.** Sidebar at
   `bg-surface/80`, header at `bg-background/70`. Blur is used ONLY on fixed and sticky
   chrome, never on content cards.
3. **The header holds exactly three things:** the command-palette trigger on the left,
   then theme toggle and notification bell on the right. No breadcrumbs, no page title.
   Titles live in the page body via `PageHeader`.
4. **Nav is grouped, not flat.** Groups render as `<div className="space-y-5">` with a
   `text-[10px] font-bold uppercase tracking-[0.14em] text-muted/70` eyebrow above each,
   and `space-y-0.5` between rows.
5. **Pages compose themselves.** Every page is `PageHeader` then a container
   (`mx-auto max-w-6xl` or full width), then cards in a grid. There is no page-level
   wrapper component and no per-page layout file.
6. **Banners are full-bleed strips above the header**, inside the main column, so they
   push content down rather than overlaying it.

---

## (d) Component recipes, with real class strings

### Buttons

From `globals.css`:

```css
.btn-primary {
  @apply inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2
         text-sm font-semibold text-white shadow-sm hover:bg-emerald-600
         active:scale-[.99] transition cursor-pointer disabled:opacity-50;
}

.btn-ghost {
  @apply inline-flex items-center justify-center gap-2 rounded-lg border border-edge
         bg-transparent px-3 py-2 text-sm font-medium text-foreground
         hover:border-edge-bright hover:bg-surface-2 active:scale-[.99] transition
         cursor-pointer;
}
```

Two variants only. Every other "variant" is an inline `!` override at the call site, for
example a destructive button:

```tsx
className="btn-ghost !border-red-500/40 !text-red-400 hover:!bg-red-500/10"
```

or a dense one: `className="btn-ghost !py-1 text-xs"`. See section (f): copy the two base
variants, do not copy the `!` override habit.

### Form input

```css
.field {
  @apply w-full rounded-lg border border-edge bg-surface-2 px-3 py-2 text-sm
         text-foreground placeholder:text-muted/60 outline-none
         focus:border-edge-bright focus:ring-2 focus:ring-accent/25 transition;
}
```

Plus native-control hygiene, which is a real quality signal and costs 6 lines:

```css
input, select, textarea { color-scheme: inherit; }
option { background: var(--surface-2); color: var(--foreground); }
input:-webkit-autofill, input:-webkit-autofill:hover, input:-webkit-autofill:focus {
  -webkit-text-fill-color: var(--foreground);
  -webkit-box-shadow: 0 0 0 1000px var(--surface-2) inset;
  transition: background-color 9999s ease-in-out 0s;
}
::selection { background: rgba(16, 185, 129, 0.3); }
```

Label above input: `className="mb-1 block text-xs font-medium text-muted"`.

Checkboxes are native with `className="accent-emerald-500"`. No custom checkbox component
anywhere.

### Card

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}
[data-theme="light"] .card { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06); }
```

Interactive cards add `className="card p-4 h-full transition hover:border-edge-bright"`.
Hover changes the border only. Never the shadow, never the background.

Nested "row inside a card" is a distinct, consistently repeated recipe:

```tsx
className="flex items-center gap-3 rounded-xl border border-edge bg-surface-2/40 px-3 py-2.5 transition hover:border-edge-bright"
```

### Badges and pills

`StatusBadge` (from `src/components/ui.tsx`):

```tsx
<span
  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap"
  style={{ color: c, background: `${c}1a`, border: `1px solid ${c}40` }}
>
  <span className={`h-1.5 w-1.5 rounded-full ${status === "Escalated" ? "pulse-red" : ""}`}
        style={{ background: c }} />
  {status}
</span>
```

`PriorityBadge`:

```tsx
<span
  className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-bold tracking-wide"
  style={{ color: c, background: `${c}1a`, border: `1px solid ${c}40` }}
>
  {priority}
</span>
```

`HealthDot`:

```tsx
<span className="inline-flex items-center gap-1.5 text-xs" style={{ color: m.c }}>
  <span className={`h-2 w-2 rounded-full ${health === "offline" ? "pulse-red" : ""}`}
        style={{ background: m.c }} />
  {m.label}
</span>
```

The pulse animation, used only for genuinely urgent states:

```css
@keyframes pulse-dot {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45); }
  50%      { box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
}
.pulse-red { animation: pulse-dot 1.6s infinite; }
```

### Stat card

```tsx
<div className="card p-4 h-full transition hover:border-edge-bright">
  <div className="text-xs font-medium uppercase tracking-wider text-muted">{label}</div>
  <div className="mt-1 text-3xl font-bold" style={{ color: accent }}>{value}</div>
  {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
</div>
```

The value colour is passed per stat and encodes state:
`accent={breached > 0 ? "#ef4444" : "#34d399"}`. Neutral stats pass
`accent="var(--foreground)"`. Wrapping the card in a `<Link>` when a drill-down exists is
the default, not the exception.

### Page header and section title

```tsx
// PageHeader
<div className="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
    {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
  </div>
  {action}
</div>

// SectionTitle
<div className="mb-3 flex items-center justify-between">
  <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{children}</h2>
  {action}
</div>
```

`items-end` on the header is why the action button optically aligns with the baseline of
the title instead of floating.

### Empty state

```tsx
<div className="card flex flex-col items-center justify-center gap-2 p-10 text-center">
  <div className="text-muted/60">{icon}</div>
  <div className="font-medium">{title}</div>
  {sub && <div className="text-sm text-muted">{sub}</div>}
</div>
```

Inline table empty state: `<div className="p-10 text-center text-sm text-muted">`.

### Nav row

```tsx
// active
"flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition bg-accent/15 font-semibold text-emerald-300 border border-accent/30"
// idle
"flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition text-muted hover:bg-surface-2 hover:text-foreground border border-transparent"
```

Note `border border-transparent` on the idle state. That is what stops the row from
shifting 1px when it becomes active. Small detail, very visible if you skip it.

### Tab bar / filter chip strip

Container and pill, used identically in `admin/tabs.tsx` and the `/tickets` view presets:

```tsx
<div className="my-5 flex flex-wrap gap-1 rounded-2xl border border-edge bg-surface/60 p-1">
  <Link className={active
    ? "rounded-xl px-4 py-2 text-sm transition bg-accent/20 font-semibold text-emerald-300"
    : "rounded-xl px-4 py-2 text-sm transition text-muted hover:bg-surface-2 hover:text-foreground"} />
</div>
```

A `rounded-2xl` tray with `p-1` holding `rounded-xl` pills. The nested-radius relationship
(outer 16, inner 12, gap 4) is what makes it look machined rather than assembled.

### Table

```tsx
<div className="card overflow-visible p-0">
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-edge text-left text-[10px] uppercase tracking-wider text-muted">
          <th className="px-3 py-2.5 whitespace-nowrap">{label}</th>
      <tbody>
        <tr className="cursor-pointer border-b border-edge/50 transition hover:bg-surface-2/40"
            onClick={() => router.push(href)}>
          <td className="px-3 py-2.5">
```

Details worth copying exactly:

- The card wrapper takes `p-0` and the table supplies all padding.
- Row separators are `border-edge/50`, half strength, while the header rule is full
  `border-edge`. That single contrast difference makes a dense table readable.
- The whole row is clickable via `router.push`; interactive cells stop propagation with
  `onClick={(e) => e.stopPropagation()}`.
- Inline editing lives in the cell: an assignee `<select>` styled
  `className="field !w-auto !border-transparent !bg-transparent !py-0.5 text-xs hover:!border-edge"`
  so it looks like text until hovered.
- A live filter row sits between header and table:
  `className="field !border-transparent !bg-transparent !py-1.5 text-xs focus:!border-edge"`.

Bulk-action bar, revealed when rows are selected:

```tsx
<div className="flex flex-wrap items-center gap-2 border-b border-emerald-500/30 bg-emerald-500/[.06] px-4 py-2.5">
  <span className="text-sm font-semibold text-emerald-500">{n} selected</span>
```

### Modal / overlay (command palette)

```tsx
// backdrop
<div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/70 p-6 pt-[12vh] backdrop-blur-sm" onClick={close}>
  // panel
  <div className="card w-full max-w-xl overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
    <div className="flex items-center gap-3 border-b border-edge px-4 py-3">
      <input className="w-full bg-transparent text-sm outline-none placeholder:text-muted/60" />
    </div>
    <div className="max-h-[50vh] overflow-y-auto p-2">
      <button className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition cursor-pointer
                         bg-emerald-500/10 border border-emerald-500/30" />  {/* active row */}
```

Trigger button in the header:

```tsx
className="flex items-center gap-2 rounded-xl border border-edge bg-surface-2/60 px-3 py-2 text-xs text-muted transition hover:border-edge-bright hover:text-foreground cursor-pointer"
// with a keycap
<kbd className="ml-2 rounded-md border border-edge bg-surface px-1.5 py-0.5 font-mono text-[10px]">
```

`pt-[12vh]` rather than vertical centering is the correct call: the panel grows downward
and never jumps as results arrive.

### Dropdown (notification bell)

```tsx
// trigger
className="relative rounded-xl border border-edge bg-surface-2/60 p-2.5 text-muted hover:text-foreground hover:border-edge-bright transition cursor-pointer"
// unread count
className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white"
// panel
className="absolute right-0 top-12 z-50 w-96 card p-2 shadow-2xl"
// panel heading
className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted"
```

The theme toggle uses the same trigger recipe at `rounded-lg` with `p-2.5`, which is why
the header controls read as a set.

### Notices / toasts

There is no toast system. Persistent notices are full-bleed strips with per-theme colours:

```css
.notice-critical { background: rgba(239,68,68,.14); color: #fca5a5; border-bottom: 1px solid rgba(239,68,68,.3); }
.notice-warning  { background: rgba(245,158,11,.14); color: #fcd34d; border-bottom: 1px solid rgba(245,158,11,.3); }
.notice-info     { background: rgba(56,189,248,.14); color: #7dd3fc; border-bottom: 1px solid rgba(56,189,248,.3); }
[data-theme="light"] .notice-critical { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
[data-theme="light"] .notice-warning  { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
[data-theme="light"] .notice-info     { background: #e0f2fe; color: #075985; border-color: #7dd3fc; }
```

Applied as `className="notice px-6 py-2 text-sm font-medium notice-critical"`.

### Charts

`src/components/charts.tsx`. The good pattern: axes and grid are drawn from theme vars.

```tsx
<CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
<XAxis tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
<Bar dataKey="count" radius={[0, 8, 8, 0]} barSize={16} />
<Area type="monotone" stroke="var(--foreground)" fill="url(#gOpen)" strokeWidth={2} />
```

Gradient fills go from `stopOpacity={0.35}` at top to `0` at bottom. Axis lines and tick
lines are always off. Bars get a radius on the trailing edge only.

### Print

```css
@media print {
  aside, header, .no-print { display: none !important; }
  .ml-60 { margin-left: 0 !important; }
  body { background: #fff !important; color: #111 !important; }
  .card { background: #fff !important; border-color: #ddd !important; box-shadow: none !important; }
  .card *, h1, h2, p, span, td, th { color: #111 !important; }
}
```

Twelve lines, and the whole dark app prints correctly. Cheap and it reads as care.

---

## (e) What makes it feel premium

In descending order of how much a copier must get it right.

**1. Restraint in the palette. This is the whole trick.**
Nine neutral tokens plus one accent. The accent appears in exactly four places: active nav
row, primary button, links, focus ring. Everything else is `foreground` or `muted` on
`surface`. If you port only one idea, port this.

**2. Borders carry elevation, not shadows.**
`hover:border-edge-bright` is the universal hover. There is one 1px shadow on cards and
`shadow-2xl` on floating panels, and nothing in between. Overlapping shadow tiers are the
single most common thing that makes a UI look amateur, and Techottic simply does not have
any.

**3. The badge triple.**
One hex expands into text / 10% background / 25% border. Consistent everywhere, extends to
new states for free.

**4. Uppercase micro-labels with wide tracking.**
`text-[10px]` to `text-xs`, `uppercase`, `tracking-wider` or `tracking-[0.14em]`, always
`text-muted`. Used for nav groups, section titles, stat labels, table headers, dropdown
headings. This one habit does most of the work that a second typeface would otherwise do.

**5. Motion is small, uniform and boring.**
Bare `transition` on every interactive element. `active:scale-[.99]` on buttons only. One
`pulse-red` keyframe reserved for genuine urgency. There are no entrance animations, no
staggered reveals, no parallax. Nothing announces itself.

**6. Blur is reserved for chrome.**
`backdrop-blur-xl` on the fixed sidebar and sticky header. `backdrop-blur-sm` on the modal
scrim. Never on content cards. Blurred content cards are a performance cost and they wash
out text.

**7. Density is deliberate and consistent.**
`px-3 py-2.5` table cells, `gap-4` stat grids, `gap-6` section grids, `space-y-2` lists.
The same numbers repeat across 70 pages, which is why nothing looks off-grid.

**8. Icon discipline.**
Lucide at 16 in nav, 14 to 15 inline, 12 in dense chips. Never larger. Icons sit inside
`gap-2.5` flex rows and are never the focus.

**9. Native controls are themed.**
`color-scheme: inherit`, styled `<option>`, killed autofill yellow. Users never see a
white system dropdown drop out of a dark UI. This is invisible when done and glaring when
not.

**Incidental, safe to ignore:** the emerald hue itself, the body radial wash, the
`glow-line`, the gradient wordmark, the Leaflet theming, the DEV/PROD environment badge,
the wallboard.

---

## (f) Port plan for Advottic, ordered by visual impact per unit of risk

> **STATUS as of 2026-08-01: P1 through P5 are DONE. Do not rebuild them.**
>
> This plan was written 2026-07-30, before the counsel primitives sweep. Two
> agents dispatched on 2026-08-01 to "port P1 and P5" and "port P2, P4 and P9"
> both found the work already shipped, and both correctly returned a zero-line
> diff rather than manufacture one. Verified in `app/globals.css` directly:
>
> | step | state | where |
> | --- | --- | --- |
> | P1 neutral ramp | DONE, all 11 values match this doc exactly, plus the collapsed single wash | `app/globals.css:689`, commit `bf30b26` |
> | P2 badge triple | DONE, exact `c` / `c+1a` / `c+40`, gold default, 34 importers | `components/counsel/StatusPill.tsx`, `lib/pill-colors.ts`, commit `35376b7` |
> | P3 shared primitives module | DONE. This doc called it "the largest single gap versus Techottic" | `components/counsel/ui.tsx` |
> | P4 sidebar active/hover | DONE, three active signals, `border-transparent` idle to stop the 1px shift | `components/counsel/CounselSidebar.tsx:56`, commit `4c133755` |
> | P5 card contrast + hover | DONE, `rgba(22,22,26,0.92)`, gold hairline `0.12`, no `backdrop-filter` on `.card` | `app/globals.css:788`, commit `87351d7` |
>
> The commit subjects describe the problem solved, not the source of the idea,
> so grepping the log for "techottic" or "theme" finds nothing and wrongly
> suggests none of this landed. Read `app/globals.css` instead.
>
> **P9 (print stylesheet) is BLOCKED on a product decision, not on effort.**
> Its premise here is false: Advottic does not "get whatever the browser
> decides". `app/globals.css:921` is an intentional anti-exfiltration control
> that hides the page and prints a refusal notice, added in `adc1a0e2`
> "Capture deterrents + trace watermark". Implementing P9 means defeating a
> security control on an app that stores PHI under a live compliance program.
> Do not do it as a styling change.
>
> **Contrast constraint that P1 created, and that anyone editing the ramp must
> respect.** Lightening the card cost every status pill 0.15 to 0.25 of
> contrast ratio. `PILL_COLORS.quiet` now sits at 4.69:1 against the counsel
> card, a margin of 0.19 over the WCAG AA floor of 4.5:1 for small text. It
> fails again as soon as `.counsel-shell .card` rises above roughly
> `rgb(23,23,27)`. Two agents derived that threshold independently. See the
> comment block in `lib/pill-colors.ts` before touching the surface.
>
> Still genuinely open: P6 table standard, P7 header control set, P8 command
> palette, P9 (blocked, above), P10 light mode (high risk, many files, and
> counsel hardcodes `dark` on the root).

### Where Advottic stands today

- Tailwind **v3** with a real `tailwind.config.ts`. Colour families `forest`, `gold`,
  `cream`, `ink`. `forest-*` is already driven by space-separated RGB CSS variables
  (`--forest-950` through `--forest-50`) declared in `app/globals.css`.
- `.counsel-shell` and `.enterprise-shell` already **remap the entire forest ramp to a
  neutral black ramp** (`--forest-950: 8 8 8` ... `--forest-50: 244 244 244`). This is
  structurally the same idea as Techottic's surface tokens, which is why several of the
  ports below are genuinely one-block changes.
- Component layer in `app/globals.css` under `@layer components`: `.btn`, `.btn-primary`,
  `.btn-secondary`, `.btn-ghost`, `.btn-accent`, `.input`, `.label`, `.card`,
  `.card-hover`, `.card-luminous`, `.card-ai`, `.popup-panel`, `.badge`, `.badge-brand`,
  `.badge-accent`, `.eyebrow`, `.divider`, `.gold-rule`.
- Counsel shell is **dark-only**: `app/counsel/layout.tsx` root is
  `className="dark counsel-shell min-h-screen flex flex-col text-cream-100"`.
- Typography: Inter (`--font-sans`) plus Fraunces (`--font-display`) plus Saira Condensed
  for the wordmark. A custom 5-stop `display-xs` through `display-xl` scale.
- Icons: hand-rolled duotone gold SVG glyphs in `components/counsel/CounselSidebar.tsx`.
  No icon dependency.
- **No shared UI primitives module.** There is no `components/ui/`. 180 tsx files under
  `app/counsel` + `components/counsel` each roll their own page header, section heading
  and empty state. This is the largest single gap versus Techottic.

### Compatibility verdict

| Techottic pattern | Transfers to Advottic? |
| --- | --- |
| Nine-token neutral surface system | **Yes, cleanly.** Retarget the existing `.counsel-shell` forest override block |
| Badge triple (`c` / `c+1a` / `c+40`) | **Yes, cleanly.** Advottic has no equivalent; pure addition |
| `hover:border-edge-bright` convention | **Yes.** Maps to `hover:border-gold-500/32` on cards, already partly present |
| Uppercase micro-label rhythm | **Yes.** Advottic already has `.eyebrow`; extend the habit to section titles and table headers |
| Shared primitives module | **Yes, high value.** Pure addition, adopt page by page |
| Grouped sidebar with eyebrows | **Yes, already present.** Only the active/hover treatment needs retuning |
| Fixed 240px rail + `ml-60` | **No.** Advottic counsel uses a flex sibling rail inside a padded flex row, with a collapse provider. Do not restructure |
| Command palette | Yes, but it is net-new work plus a search endpoint |
| Dual light/dark theme | **Collides.** Counsel hardcodes `dark`; every counsel class string assumes it |
| Emerald accent | **Collides. Do not port.** Gold is the brand |
| Geist single-family type | **Collides. Do not port.** Inter + Fraunces is a brand asset |
| `@theme inline` token syntax | **Collides.** Tailwind v3 versus v4. Translate, do not copy |
| Lucide icon set | **Collides softly.** Lucide is compliant stroke SVG, but swapping out the bespoke gold duotone glyphs would cost brand distinctiveness. Port the sizing discipline, keep the glyphs |

### The plan

**P1. Retune the counsel neutral ramp to Techottic's zinc values.**
Impact: high. Risk: very low. Files: 1 (`app/globals.css`, the `.counsel-shell, .enterprise-shell` block near line 649).

Advottic's counsel neutrals are pure greys (`18 18 18`, `26 26 26`, `33 33 33`). Techottic's
are very slightly blue-shifted zinc, which is why they read as designed rather than as
"black". Suggested mapping, preserving Advottic's slot semantics:

| Advottic var | Current | Proposed | Techottic source |
| --- | --- | --- | --- |
| `--forest-950` | `8 8 8` | `10 10 11` | `--background #0a0a0b` |
| `--forest-900` | `18 18 18` | `16 16 18` | `--surface #101012` |
| `--forest-800` | `26 26 26` | `23 23 26` | `--surface-2 #17171a` |
| `--forest-700` | `33 33 33` | `35 35 39` | `--border #232327` |
| `--forest-600` | `45 45 45` | `51 51 58` | `--border-bright #33333a` |
| `--forest-500` | `64 64 64` | `72 72 80` | interpolated |
| `--forest-400` | `92 92 92` | `110 110 120` | interpolated |
| `--forest-300` | `140 140 140` | `156 156 166` | `--muted #9c9ca6` |
| `--forest-200` | `200 200 200` | `202 202 210` | interpolated |
| `--forest-100` | `230 230 230` | `232 232 236` | interpolated |
| `--forest-50` | `244 244 244` | `244 244 245` | `--foreground #f4f4f5` |

Zero call sites change. Also consider replacing `.counsel-shell`'s three-layer background
image with Techottic's single fixed wash, retinted gold:
`radial-gradient(900px 420px at 75% -12%, rgba(213,187,126,0.05), transparent 65%)`.
Advottic currently stacks three gradients, which is more than the effect needs.

**P2. Add the badge triple as a primitive.**
Impact: high. Risk: very low. Files: 1 new.

Create `components/counsel/StatusPill.tsx` implementing Techottic's formula with
Advottic's semantics (matter status, deadline state, signing state, intake priority). Use
gold `#D5BB7E` as the neutral/default hex so the default state stays on brand. Adopt at
call sites incrementally. Advottic's existing `.badge` / `.badge-brand` / `.badge-accent`
are only three fixed variants and cannot express a status set.

**P3. Add a shared counsel primitives module.**
Impact: high. Risk: low (pure addition). Files: 1 new, then incremental adoption.

Create `components/counsel/ui.tsx` porting `PageHeader`, `SectionTitle`, `StatCard`,
`EmptyState` from `/Users/technooptics/Techottic/src/components/ui.tsx`, restyled with
Advottic tokens:

- `PageHeader`: `mb-6 flex flex-wrap items-end justify-between gap-3`, title
  `font-display text-display-xs text-cream-100` (keep Fraunces, do not use `text-2xl
  font-bold`), subtitle `mt-1 text-sm text-cream-100/70`.
- `SectionTitle`: `text-sm font-semibold uppercase tracking-wider text-cream-100/60`.
- `StatCard`: `card p-4 h-full transition hover:border-gold-500/32` with the value colour
  passed per stat.
- `EmptyState`: `card flex flex-col items-center justify-center gap-2 p-10 text-center`.

This is the change that most reduces future drift across the 180 counsel files.

**P4. Retune the sidebar active and hover states.**
Impact: medium-high. Risk: very low. Files: 1 (`components/counsel/CounselSidebar.tsx`, two class strings, each appearing twice).

Current active state stacks four signals: background tint, `ring-1`, `border-l-2`, and
bold. Techottic uses three and reads cleaner. Proposed:

```
active: "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition bg-gold-500/15 font-semibold text-gold-200 border border-gold-500/30"
idle:   "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition text-cream-100/70 hover:bg-forest-800 hover:text-cream-100 border border-transparent"
```

Note `border border-transparent` on idle to prevent the 1px shift. Keep the existing
duotone gold glyphs and the `opacity-80` / `opacity-100` active treatment; that is already
better than Techottic's flat icons. Optionally drop `rounded-md` to `rounded-xl` to match
the nested-radius rhythm.

**P5. Card contrast and hover discipline.**
Impact: high. Risk: medium (touches every counsel and portal surface visually; needs a screenshot sweep). Files: 1 CSS block, ~219 files affected visually.

Current `.counsel-shell .card` is `rgba(24,24,24,0.62)` with `backdrop-filter: blur(6px)`.
Two problems relative to Techottic: 62% opacity plus blur lowers text contrast against a
gradient backdrop, and blur on every card is a real paint cost on long pages.

Proposed: raise to roughly `rgba(22, 22, 26, 0.92)`, drop `backdrop-filter` from `.card`
entirely (keep it on the sticky header, the mobile top bar and modal scrims), keep the
gold hairline `rgba(213,187,126,0.12)` and the hover brighten to `0.32`. Add Techottic's
single flat shadow `0 1px 2px rgba(0,0,0,0.35)` instead of relying on the ring shadows in
`.bg-forest-950 > .card`.

Also audit: Advottic has four card variants (`card-hover`, `card-luminous`, `card-ai`,
`popup-panel`) with overlapping gradient and glow behaviour. Techottic has one. Consider
retiring `card-luminous` inside counsel and reserving it for marketing, where the extra
ornament belongs.

**P6. Table standard.**
Impact: medium. Risk: low. Files: several, incremental.

Adopt verbatim: `px-3 py-2.5` cells, header rule `border-b border-forest-700`, row rule
`border-b border-forest-700/50`, row hover `hover:bg-forest-800/40`, header text
`text-[10px] uppercase tracking-wider text-cream-100/60`, whole-row `router.push` with
`stopPropagation` on interactive cells, and the inline live-filter row above the table.

**P7. Header control set.**
Impact: medium. Risk: low. Files: `components/counsel/CounselHeader.tsx`.

Give the notification bell, profile menu and language switcher one shared trigger recipe
so they read as a set:
`rounded-xl border border-forest-700 bg-forest-800/60 p-2.5 text-cream-100/70 hover:text-cream-100 hover:border-gold-500/40 transition`.
Today they are styled individually.

**P8. Command palette.**
Impact: medium-high perceived quality. Risk: medium (net-new component plus a search API). Files: 2 new plus a header slot.

Advottic has `AskAdvottic`, an AI question bar, which is a different thing: it answers, it
does not navigate. A Cmd+K palette over matters, clients, documents and people would be a
genuine addition. Port the overlay recipe from
`/Users/technooptics/Techottic/src/components/command-palette.tsx` verbatim (the
`pt-[12vh]` placement, the 180ms debounce, the `max-h-[50vh]` scroller, arrow-key
handling). Do not port the emerald row highlight; use `bg-gold-500/10 border
border-gold-500/30`.

**P9. Print stylesheet.**
Impact: low but disproportionate credibility for a legal product. Risk: very low. Files: 1.

Port the 12-line `@media print` block, adapted to Advottic's shell selectors. A firm
printing a matter summary from a black-and-gold UI currently gets whatever the browser
decides.

**P10. Light mode for counsel.**
Impact: high for some users. Risk: **high**. Files: many.

`app/counsel/layout.tsx` hardcodes `dark`, and effectively every counsel class string is
written as `text-forest-900 dark:text-cream-100`. The `dark:` halves are all live; the
light halves are dead code that has never been rendered in the counsel shell and is almost
certainly wrong in places. Doing this properly means auditing all 180 counsel files. Treat
as a separate project, not as part of a visual refresh. Techottic's mechanism (a
`data-theme` attribute plus a cookie plus `useSyncExternalStore` reading the DOM) is the
right one to copy when the time comes, and it is a strictly better pattern than Advottic's
`ThemeBoot` + `class` approach because it avoids the mount-time state write.

### Safe token swaps versus multi-file work

| Safe token swap (1 file, no call sites) | Multi-file work |
| --- | --- |
| P1 neutral ramp | P3 primitives adoption (1 new file, then N call sites) |
| P5 card CSS block (visual sweep needed, but 1 file) | P6 table standard |
| P9 print block | P7 header controls |
| P4 sidebar (2 class strings) | P8 command palette |
| P2 new pill component | P10 light mode (do not attempt casually) |

---

## (g) Explicitly do NOT port

**1. Every emoji. Non-negotiable, this is the Advottic house rule.**
Techottic contains roughly 105 emoji and pictographic characters across 30 tsx files.
Confirmed instances:

- `⚡` in the sidebar wordmark (`src/app/(app)/layout.tsx` line 34) and the login card
- `⏻` as the sign-out button glyph (`layout.tsx` line 69)
- `🚨` `⚠️` `ℹ️` as banner severity prefixes (`layout.tsx` line 83)
- `📺 TV mode` button on the dashboard
- `🚨 Needs attention now` section title
- `✨` in empty states ("Enjoy it while it lasts ✨", "You're all caught up ✨", "hopefully
  it stays that way ✨")
- `★ VIP` in `VipBadge` (`src/components/ui.tsx` line 84)
- `🤖` appended to virtual-agent names in assignee dropdowns
- `⏸ Paused`, `◆`, `↳`, `✓`, `✉` scattered through the ticket table and detail
- `⚡` inside a placeholder string in the ticket filter input

Advottic uses clean stroke SVGs. Every one of these needs a glyph, not a character.
Advottic already has the right pattern in `components/counsel/CaseSectionIcons.tsx` and
`KindIcon.tsx`.

**2. The emerald accent (`#059669` / `#34d399` / `text-emerald-300`).**
Port the *discipline* (one accent, four placements), not the hue. Advottic's accent is
gold `#D5BB7E`. Wherever this spec quotes an emerald class, substitute the gold
equivalent.

**3. Geist as the only typeface, and dropping the display serif.**
Techottic gets away with one family because it is an IT tool. Advottic sells to law firms
and Fraunces is doing real brand work. Keep `font-display` on titles. Port the uppercase
micro-label rhythm, which is family-agnostic.

**4. The `@theme inline { }` block.**
Tailwind v4 syntax. Advottic is on v3 with `tailwind.config.ts`. Copying this block does
nothing. Translate values into the existing `:root` CSS variables and the config's
`extend.colors`.

**5. `.card` as raw CSS with a hardcoded `14px` radius.**
Advottic's `.card` is `@apply rounded-xl border border-ink-200 bg-white shadow-card ...`
and there is a whole variant family built on it. Adjust Advottic's card, do not replace it.

**6. Hardcoded hex in charts.**
`src/components/charts.tsx` sets the recharts tooltip to literal
`background: "#17171a", border: "1px solid #33333a", color: "#f4f4f5"`, and the Leaflet
block hardcodes `#0c0c0e`, `#17171a`, `#f4f4f5`. This directly violates Techottic's own
documented rule ("NEVER hardcode `#ffffff`/white or near-black for text or chart marks").
Port the recharts *structure* (var-driven axes, no axis lines, gradient area fills,
trailing-edge bar radius) and drive the tooltip from Advottic tokens instead.

**7. The `!important` override habit on shared button classes.**
`className="btn-ghost !border-red-500/40 !py-1 text-xs !text-red-400"` appears repeatedly.
It works, but it means the button system has no destructive or dense variant and every
call site reinvents one. If Advottic needs those, add `.btn-danger` and a `size` prop.

**8. The DEV/PROD environment badge in the sidebar.**
Correct for a self-hosted IT tool. Wrong for a SaaS product a law firm logs into.

**9. The gradient bg-clip wordmark.**
`bg-gradient-to-r from-foreground to-emerald-500 bg-clip-text text-transparent`. Advottic
has real logo assets (`BrandMark.tsx`, firm logo uploads, tenant branding). A CSS gradient
wordmark would be a downgrade.

**10. The Leaflet dark-tile CSS block.**
Advottic's map work is Google Maps and is separately blocked on an API key. Irrelevant.

**11. Arrow characters in link copy.**
`Full map →`, `← Prev`, `Next →`, `Request hardware or software →`. Not emoji, so not a
hard rule violation, but it is a tell. Advottic should use a stroke chevron SVG or nothing.

---

## (h) File pointers

Read these, in this order, when porting the look.

1. `/Users/technooptics/Techottic/src/app/globals.css` (145 lines) - the entire token
   system, `.card`, `.field`, `.btn-primary`, `.btn-ghost`, scrollbars, notices, print
2. `/Users/technooptics/Techottic/src/components/ui.tsx` (148 lines) - every primitive:
   Avatar, StatusBadge, PriorityBadge, VipBadge, HealthDot, StatCard, SectionTitle,
   PageHeader, EmptyState
3. `/Users/technooptics/Techottic/src/app/(app)/layout.tsx` (97 lines) - the shell
4. `/Users/technooptics/Techottic/src/app/(app)/nav-links.tsx` (100 lines) - grouped nav,
   active-state recipe
5. `/Users/technooptics/Techottic/src/app/layout.tsx` (44 lines) - font loading, theme
   resolution, runtime accent injection
6. `/Users/technooptics/Techottic/src/components/theme-toggle.tsx` (41 lines) - the
   flash-free theme mechanism
7. `/Users/technooptics/Techottic/src/components/command-palette.tsx` (185 lines) - overlay
   and results-list recipe
8. `/Users/technooptics/Techottic/src/app/(app)/tickets/ticket-table.tsx` (253 lines) -
   dense table, bulk bar, inline edit, column picker
9. `/Users/technooptics/Techottic/src/app/(app)/dashboard/page.tsx` - stat grids, card
   grids, density switch
10. `/Users/technooptics/Techottic/src/app/(app)/tickets/[id]/page.tsx` - the
    `lg:grid-cols-[1fr_340px]` two-pane detail pattern
11. `/Users/technooptics/Techottic/src/app/(app)/admin/tabs.tsx` (39 lines) - the nested
    radius tab tray
12. `/Users/technooptics/Techottic/src/components/charts.tsx` (93 lines) - recharts
    configuration
13. `/Users/technooptics/Techottic/ARCHITECTURE.md` - the "Theme" section states the
    authors' own rules

Advottic files the port touches:

14. `/Users/technooptics/Advottic/CounselOptics/app/globals.css` - lines 36 to 52 (`:root`
    forest ramp), 649 to 741 (`.counsel-shell` overrides), 1254 to 1500 (`@layer
    components`)
15. `/Users/technooptics/Advottic/CounselOptics/tailwind.config.ts` - colour families,
    display type scale, shadow tokens
16. `/Users/technooptics/Advottic/CounselOptics/app/counsel/layout.tsx` - shell root, lines
    230 to 300
17. `/Users/technooptics/Advottic/CounselOptics/components/counsel/CounselSidebar.tsx` -
    active/idle class strings at lines 135 to 140 and 270 to 275
18. `/Users/technooptics/Advottic/CounselOptics/components/counsel/CounselHeader.tsx` -
    header control cluster
19. `/Users/technooptics/Advottic/CounselOptics/app/portal/layout.tsx` - Hub shell, same
    treatment as counsel
20. `/Users/technooptics/Advottic/CounselOptics/docs/DESIGN_SYSTEM.md` - update alongside
    any token change
