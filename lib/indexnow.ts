/**
 * IndexNow integration. Lightweight helper that pings Bing, Yandex,
 * Seznam, and Naver to tell them a URL has changed. They typically
 * re-crawl within minutes (vs the weeks-to-months it takes for a
 * passive crawl), so fresh content lands in search results far
 * faster than relying on sitemap polling alone.
 *
 * Google does NOT participate in IndexNow as of 2026; for Google we
 * rely on the sitemap + good internal linking. But Bing covers ~3%
 * of US search and feeds DuckDuckGo + Ecosia + ChatGPT search;
 * Yandex covers Russian-language audiences; Seznam is the dominant
 * Czech engine. Combined, IndexNow probably hits 5-8% of the global
 * search audience and is essentially free.
 *
 * Key: f7b3a9d2e4c810857b6f4e3a9d2c1e8f. Published at
 *   https://advottic.com/f7b3a9d2e4c810857b6f4e3a9d2c1e8f.txt
 * which IndexNow fetches once to prove we own the host. If we ever
 * rotate the key, replace both the constant here and the file at
 * /public/<key>.txt in one commit.
 *
 * Usage:
 *   await pingIndexNow(['https://advottic.com/what-is-advottic']);
 *
 * Best-effort: never throws. A failed ping just means Bing finds the
 * change on its next passive crawl - the canonical sitemap is still
 * authoritative.
 */

const INDEXNOW_KEY = 'f7b3a9d2e4c810857b6f4e3a9d2c1e8f';
const HOST = 'advottic.com';
const KEY_LOCATION = `https://${HOST}/${INDEXNOW_KEY}.txt`;

const ENDPOINTS: ReadonlyArray<string> = [
  'https://api.indexnow.org/IndexNow',
  // Bing's host accepts the same payload and is sometimes faster
  // than the federated endpoint for English-language URLs.
  'https://www.bing.com/indexnow',
];

/**
 * Notify IndexNow that one or more URLs have changed. Returns the
 * per-endpoint response codes for observability; never throws.
 *
 * Cap of 10,000 URLs per request per the spec. We batch silently
 * if the caller passes more.
 */
export async function pingIndexNow(
  urls: string[],
): Promise<{ endpoint: string; status: number }[]> {
  if (urls.length === 0) return [];
  // Filter to URLs on our host; IndexNow requires all URLs in one
  // request to share the same host as the key.
  const ourUrls = urls.filter((u) => {
    try {
      const parsed = new URL(u);
      return parsed.hostname === HOST || parsed.hostname === `www.${HOST}`;
    } catch {
      return false;
    }
  });
  if (ourUrls.length === 0) return [];

  const results: { endpoint: string; status: number }[] = [];
  // Spec cap is 10,000 URLs/request. We batch in 5,000 to stay well
  // under any per-endpoint quota and keep payloads small.
  const BATCH = 5_000;
  for (let i = 0; i < ourUrls.length; i += BATCH) {
    const batch = ourUrls.slice(i, i + BATCH);
    const body = JSON.stringify({
      host: HOST,
      key: INDEXNOW_KEY,
      keyLocation: KEY_LOCATION,
      urlList: batch,
    });
    for (const endpoint of ENDPOINTS) {
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body,
          // IndexNow endpoints are quick (~500ms typical). 8s leaves
          // plenty of headroom without blocking the caller forever.
          signal: AbortSignal.timeout(8_000),
        });
        results.push({ endpoint, status: r.status });
      } catch {
        results.push({ endpoint, status: 0 });
      }
    }
  }
  return results;
}
