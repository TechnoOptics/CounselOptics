/**
 * Bella response sanitiser.
 *
 * Bella's underlying LLM (and any LLM, really) emits the occasional
 * markdown chrome - **bold**, _italic_, leading "- ", inline `code`,
 * an empty-anchor link `[click here](#)` - even when the system
 * prompt instructs plain prose. The rendering surfaces use
 * `whitespace-pre-wrap` and a regular `<div>`, NOT a markdown
 * renderer, so unrendered markdown shows up as visible noise:
 *
 *   "Visible asterisks: **important**" -> users see "**important**".
 *   "[Sign in](#)"                     -> users see "[Sign in](#)".
 *
 * Two ways to fix this: render markdown properly (heavyweight, opens
 * up a CSP allowlist debate), or strip the chrome and let the
 * underlying prose speak for itself. We chose stripping - the prose
 * Bella emits reads naturally without bold/italic emphasis, and the
 * empty-anchor case is a no-op link the user can't click anyway.
 *
 * Audit 2026-05-12 P1-2 traced both symptoms to /review-my-document
 * (the free contract reviewer). The fix was originally inlined
 * inside components/Bella.tsx; this module exists so the same
 * sanitiser is used everywhere Bella output is rendered, and so the
 * regex can be unit-tested via scripts/test/bella-markdown.mjs.
 */

export function stripBellaMarkdown(s: string): string {
  return (
    s
      // Empty-anchor markdown links [text](#) -> text. The model
      // emits these when it wants to gesture at a route it doesn't
      // actually have a URL for. Rendering as <a href="#"> would
      // make a "clickable" link that does nothing.
      .replace(/\[([^\]]+)\]\(\s*#\s*\)/g, '$1')
      // **bold** / __bold__ -> bold
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // *italic* / _italic_ -> italic (avoid matching bullet
      // asterisks that have whitespace around them, and avoid
      // matching the inside of **bold**).
      .replace(/(?<!\*)\*(?!\s)([^*\n]+?)(?<!\s)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_(?!\s)([^_\n]+?)(?<!\s)_(?!_)/g, '$1')
      // `inline code` -> inline code
      .replace(/`([^`\n]+)`/g, '$1')
      // Leading "### Heading" -> "Heading"
      .replace(/^#{1,6}\s+/gm, '')
      // Leading "- ", "* ", "+ " bullet markers -> remove
      .replace(/^\s*[-*+]\s+/gm, '')
      // Leading "1. ", "2. " numbered list markers -> remove
      .replace(/^\s*\d+\.\s+/gm, '')
      // Leading "> " blockquote markers
      .replace(/^>\s*/gm, '')
      // Final safety net: any orphan ** or __ marker at end-of-
      // text (model started a bold/italic but never closed it).
      // Stripping them is cosmetically safer than leaving them
      // on screen.
      .replace(/\*{1,2}$/g, '')
      .replace(/_{1,2}$/g, '')
  );
}
