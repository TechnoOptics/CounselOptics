# Advottic design specification

The rules the marketing site and the employee portal are held to. Written
because the palette already existed and the rules did not, so every surface
improvised and the surfaces drifted.

Scope: the public marketing site and `/portal` (the employee hub). The counsel
and HQ shells are deliberately out of scope; they are a different product with
a different tone and changing them was not asked for.

---

## The decision this starts from

**The identity is kept and tightened, not replaced.**

Deep forest green, cream, and a warm gold accent are already the brand, they are
already in `tailwind.config.ts` as tokens, and Zinpro's staff have learned them.
They are also, usefully, none of the looks that generative design converges on:
not cream-with-terracotta, not near-black-with-acid-green, not a purple gradient
on white.

What was wrong was never the colours. It was that nothing was written down, so a
button on one page and a button on another agreed only by luck. This file is the
agreement.

---

## Who each surface is for

The two surfaces are not the same job and must not be designed as one.

**Marketing** is read by somebody deciding whether to trust a company with a
legal problem. It persuades. It can be spacious, editorial, and slow.

**The portal** is operated by an employee who has a task and wants it done. It
is scanned, not read. Density is a kindness there; a hero is not.

The shared inheritance is tone, not layout: both are calm, both are plain, and
neither is ever jokey. People arrive at this product under stress.

---

## Colour

Use the tokens. Never a raw hex in a component.

| role | token | notes |
|---|---|---|
| ground | `cream-50`, `forest-950` in dark | paper, not white |
| ink | `forest-900` / `cream-100` | body text |
| quiet ink | `ink-600` / `cream-100/70` | secondary only, never body |
| accent | `accent` | the gold, for fills |
| accent as text | `accent-text` | NOT `accent`; see `lib/accent-text.ts` |
| edges | `edge` | one border colour, everywhere |

**The accent is spent once per view.** A gold button and a gold heading and a
gold rule in the same viewport is three claims on the eye and the reader obeys
none of them. Pick the one thing that matters on that screen.

**Semantic colour is separate from the accent.** Good, warning and critical are
their own hues and never borrow gold, or an alert stops reading as an alert.

Both themes are designed, not inverted. Redefine tokens under
`prefers-color-scheme` and `[data-theme]`, and style components through tokens
only, so a component is never written twice.

---

## Type

Two faces, already loaded: `font-display` for headings, the body sans for
everything else. `font-serif` is reserved for rendered documents, where it means
"this is the instrument", and using it as decoration anywhere else spends that
meaning.

- Body copy sits near 65 characters. Wider is unreadable, and a legal audience
  reads carefully.
- Headings take `text-wrap: balance`.
- Numbers that line up in a column take `tabular-nums`. Always.
- Uppercase labels take a little letter-spacing; uppercase body text takes none,
  because there is no uppercase body text.

**A status is not a headline.** This has already cost us once: a whole refusal
sentence was rendered in a display `<h1>` on the phone and came out as seven
lines of huge serif. Headline type is for names of things. Sentences are body.

---

## Layout

Spacing comes from flex or grid `gap`, not from per-element margins that
collapse and double.

Wide content (tables, code, diagrams, documents) scrolls inside its own
`overflow-x: auto` container. **The page body never scrolls sideways.**

Only one thing scrolls at a time. A pane with its own scrollbar inside a page
that also scrolls will capture the wheel, and the reader cannot tell which one
they are fighting. This cost a real defect: a document preview was a 530px
window over 4168px of contract, and it swallowed the page's scrolling too.

Touch targets are 44px on anything a thumb uses.

---

## Copy

Copy is design material, not a layer applied afterwards.

- **No em dashes.** Commas, periods, parentheses, colons, hyphens.
- **No emoji**, anywhere in UI chrome, buttons, headings, nav, or seed content.
  Icons are drawn: Ionicons on mobile, stroke SVGs on web.
- Name things the way a person would. An employee has *requests*, not *records*.
- A control says what will happen. "Send for review", then a confirmation that
  says it was sent.
- Errors say what went wrong and what to do next. No apologies, no blame.
- Never scary, never jokey. Somebody reading this may be having a bad month.

---

## Motion

Motion earns its place or it is not there.

One eased transform beats three simultaneous effects. Decelerating curves, so a
thing arrives rather than stops: `cubic-bezier(.22,.61,.36,1)` at 300 to 450ms.

Everything drops out under `prefers-reduced-motion`. Not reduced. Out.

---

## What "done" means for a surface

A surface is not finished when it compiles. Today alone, seven defects were
green across the full test suite and obvious the moment the page was rendered:
clipped contract text, six canvases that had never been painted, thumbnails
cropped instead of scaled, a status sentence set as a headline.

So, for every surface:

1. Render it and look at it.
2. Look at it in the other theme.
3. Look at it at 375px wide.
4. Confirm nothing but the page scrolls.
5. Confirm the accent is spent once.

The test suite proves the wiring. Only the rendered page proves the reader sees
the right thing.
