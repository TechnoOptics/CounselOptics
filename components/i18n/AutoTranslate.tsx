'use client';

import { useEffect, useRef, useState } from 'react';
import { localeDir, type LocaleCode } from '@/lib/i18n/locales';

/**
 * Runtime auto-translation provider (#14). Wrap a subtree; when the
 * user's locale isn't English, every visible text node under it is
 * machine-translated (via /api/i18n/translate, DB-cached) and swapped
 * in place. This delivers "translate everything based on the user's
 * preference" for a whole surface by wrapping it once, instead of
 * threading a t() call through every string.
 *
 * Robustness:
 *  - Originals are stashed in a WeakMap so switching locale (or back to
 *    English) restores/retranslates from the source, never compounding.
 *  - Results cache in localStorage per (locale, text) so re-visits and
 *    re-renders re-apply instantly with no network.
 *  - A debounced MutationObserver picks up nodes React adds later.
 *  - Inputs, code, [data-no-translate], and script/style are skipped.
 *  - Everything is best-effort: any failure leaves the English text.
 *
 * Switching happens without a reload: the LanguageSwitcher dispatches a
 * window 'adv-locale-change' event that this provider listens for.
 */

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'CODE',
  'PRE',
  'TEXTAREA',
  'INPUT',
  'SELECT',
]);

function cacheKey(locale: string, text: string): string {
  return `i18n:${locale}:${text}`;
}

export function AutoTranslate({
  initialLocale,
  children,
}: {
  initialLocale: LocaleCode;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const originals = useRef<WeakMap<Text, string>>(new WeakMap());
  const [locale, setLocale] = useState<LocaleCode>(initialLocale);

  // React to switcher changes (no reload).
  useEffect(() => {
    function onChange(e: Event) {
      const next = (e as CustomEvent<string>).detail;
      if (next) setLocale(next as LocaleCode);
    }
    window.addEventListener('adv-locale-change', onChange as EventListener);
    return () =>
      window.removeEventListener('adv-locale-change', onChange as EventListener);
  }, []);

  // Keep <html> lang/dir in sync so RTL locales (Arabic) lay out right.
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDir(locale);
  }, [locale]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let disposed = false;

    function collectTextNodes(node: Node): Text[] {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
          const parent = (n as Text).parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest('[data-no-translate]'))
            return NodeFilter.FILTER_REJECT;
          const text = n.nodeValue ?? '';
          if (!text.trim()) return NodeFilter.FILTER_REJECT;
          // Skip pure numbers / punctuation / symbols.
          if (/^[\d\s\p{P}\p{S}]+$/u.test(text)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const out: Text[] = [];
      let cur = walker.nextNode();
      while (cur) {
        out.push(cur as Text);
        cur = walker.nextNode();
      }
      return out;
    }

    function restoreEnglish() {
      const nodes = collectTextNodesAll(root!);
      for (const n of nodes) {
        const orig = originals.current.get(n);
        if (orig != null && n.nodeValue !== orig) n.nodeValue = orig;
      }
    }
    // Restore needs ALL text nodes we've touched, including ones whose
    // current value is a translation (so the ACCEPT filter above, which
    // skips non-letter strings, is not reused here).
    function collectTextNodesAll(node: Node): Text[] {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const out: Text[] = [];
      let cur = walker.nextNode();
      while (cur) {
        if (originals.current.has(cur as Text)) out.push(cur as Text);
        cur = walker.nextNode();
      }
      return out;
    }

    async function translateAll() {
      if (locale === 'en') {
        restoreEnglish();
        return;
      }
      const nodes = collectTextNodes(root!);
      if (nodes.length === 0) return;

      // Record originals + gather the source strings needing translation.
      const need = new Map<string, string>(); // source -> cached translation or ''
      for (const n of nodes) {
        if (!originals.current.has(n)) {
          originals.current.set(n, n.nodeValue ?? '');
        }
        const src = (originals.current.get(n) ?? '').trim();
        if (!src) continue;
        const cached = safeLocalGet(cacheKey(locale, src));
        need.set(src, cached ?? '');
      }

      const misses = [...need.entries()]
        .filter(([, v]) => !v)
        .map(([k]) => k);

      if (misses.length > 0) {
        // Chunk requests so we stay under the API's per-call cap.
        for (let i = 0; i < misses.length && !disposed; i += 150) {
          const chunk = misses.slice(i, i + 150);
          try {
            const res = await fetch('/api/i18n/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ texts: chunk, locale }),
            });
            if (res.ok) {
              const j = (await res.json()) as { map?: Record<string, string> };
              for (const [src, dst] of Object.entries(j.map ?? {})) {
                need.set(src, dst);
                safeLocalSet(cacheKey(locale, src), dst);
              }
            }
          } catch {
            /* leave English for this chunk */
          }
        }
      }

      if (disposed) return;
      // Apply translations to the live nodes.
      for (const n of nodes) {
        const src = (originals.current.get(n) ?? '').trim();
        const dst = need.get(src);
        if (dst && dst !== n.nodeValue) {
          // Preserve leading/trailing whitespace of the original node.
          const raw = originals.current.get(n) ?? '';
          const lead = raw.match(/^\s*/)?.[0] ?? '';
          const trail = raw.match(/\s*$/)?.[0] ?? '';
          n.nodeValue = `${lead}${dst}${trail}`;
        }
      }
    }

    translateAll();

    // Catch nodes React adds after the first pass (debounced).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (locale === 'en') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) translateAll();
      }, 250);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [locale]);

  // display:contents keeps this wrapper layout-neutral, so it can wrap
  // an existing flex/grid layout (a whole Counsel/Portal shell) without
  // becoming an extra box that breaks it. The TreeWalker + observer
  // still see all descendants.
  return (
    <div ref={rootRef} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}

function safeLocalGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeLocalSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota / private mode - fine, we just re-fetch */
  }
}
