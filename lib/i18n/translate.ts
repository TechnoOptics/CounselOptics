import crypto from 'node:crypto';
import { createAdminSupabase } from '../supabase/admin';
import { bellaGenerate } from '../bella';
import { getLocale, isLocale, type LocaleCode } from './locales';

/**
 * Runtime machine-translation engine (#14). Translates arrays of UI
 * strings to a target locale, caching each result in ui_translations
 * so a given string is translated (and paid for) once per locale.
 *
 * English (the authoring base) is a no-op passthrough. Unknown locales
 * fall back to passthrough too, so a bad locale can never blank the UI.
 *
 * The engine is the app's existing Anthropic integration (bellaGenerate)
 * - no new provider/credentials. Legal-domain strings translate better
 * with an instruction-following model than a raw phrase-table API, which
 * is why we prompt it to preserve product names and placeholders.
 */

function hashOf(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// Translate at most this many strings per model call; batches keep the
// prompt bounded and the JSON parseable.
const BATCH = 40;

export async function translateBatch(
  texts: string[],
  locale: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // Base language or unknown: identity map.
  if (!isLocale(locale) || locale === 'en') {
    for (const t of texts) out[t] = t;
    return out;
  }
  const target = getLocale(locale).translationTarget;

  // Unique, non-trivial strings only.
  const uniq = Array.from(
    new Set(
      texts
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && !/^[\d\s\p{P}\p{S}]+$/u.test(t)),
    ),
  );
  // Pass through anything we skip (pure numbers/punctuation) unchanged.
  for (const t of texts) out[t] = t;
  if (uniq.length === 0) return out;

  const admin = createAdminSupabase();
  const misses: string[] = [];

  if (admin) {
    const hashes = uniq.map(hashOf);
    const { data } = await admin
      .from('ui_translations')
      .select('source_hash, translated_text')
      .eq('locale', locale)
      .in('source_hash', hashes);
    const cached = new Map<string, string>();
    for (const r of (data ?? []) as Array<{
      source_hash: string;
      translated_text: string;
    }>) {
      cached.set(r.source_hash, r.translated_text);
    }
    for (let i = 0; i < uniq.length; i++) {
      const hit = cached.get(hashes[i]);
      if (hit != null) out[uniq[i]] = hit;
      else misses.push(uniq[i]);
    }
  } else {
    // No store: translate everything this request, no caching.
    misses.push(...uniq);
  }

  // Translate the misses in bounded batches.
  for (let i = 0; i < misses.length; i += BATCH) {
    const chunk = misses.slice(i, i + BATCH);
    const translated = await translateChunk(chunk, target, locale as LocaleCode);
    for (const [src, dst] of Object.entries(translated)) {
      out[src] = dst;
    }
    // Persist new translations (best-effort).
    if (admin) {
      const rows = chunk
        .filter((s) => translated[s] != null && translated[s] !== s)
        .map((s) => ({
          locale,
          source_hash: hashOf(s),
          source_text: s,
          translated_text: translated[s],
        }));
      if (rows.length > 0) {
        await admin
          .from('ui_translations')
          .upsert(rows, { onConflict: 'locale,source_hash' })
          .then(
            () => undefined,
            () => undefined,
          );
      }
    }
  }

  return out;
}

async function translateChunk(
  strings: string[],
  target: string,
  _locale: LocaleCode,
): Promise<Record<string, string>> {
  // Number the lines so the model returns a parseable, aligned JSON
  // object keyed by index - safer than asking it to echo the source.
  const numbered = strings.map((s, i) => `${i}: ${s.replace(/\n/g, ' ')}`);
  const system = [
    `You are a professional UI localizer translating an American legal-tech`,
    `app into ${target}. Translate naturally and formally, as a native`,
    `speaker would expect in a legal/professional product.`,
    `Rules: keep the product names "Advottic", "Counsel", "Bella", and`,
    `"Hub" untranslated. Preserve any placeholders like {name} or %s and`,
    `any URLs/emails verbatim. Do not add notes. Return ONLY a JSON object`,
    `mapping each input index (as a string) to its translation, e.g.`,
    `{"0":"...","1":"..."}.`,
  ].join(' ');
  const prompt =
    `Translate each line to ${target}. Return only the JSON object.\n\n` +
    numbered.join('\n');

  let raw = '';
  try {
    raw = await bellaGenerate({ system, prompt, maxTokens: 4000 });
  } catch {
    // On failure, pass through untranslated - never blank the UI.
    return Object.fromEntries(strings.map((s) => [s, s]));
  }

  const parsed = extractJsonObject(raw);
  const result: Record<string, string> = {};
  for (let i = 0; i < strings.length; i++) {
    const v = parsed?.[String(i)];
    result[strings[i]] = typeof v === 'string' && v.trim() ? v : strings[i];
  }
  return result;
}

function extractJsonObject(s: string): Record<string, unknown> | null {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
