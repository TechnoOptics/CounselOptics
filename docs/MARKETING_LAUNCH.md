# Marketing launch playbook — Advottic

The technical SEO foundation is shipped. These three platform tasks
require logging into your accounts, so I cannot do them for you, but
the codebase is wired so each step is a few minutes of clicking
once you're signed in.

When in doubt, do them in this order. Each one builds on the
previous.

---

## 1. Google Search Console (≈ 10 min, free)

This tells Google your site exists, lets you submit the sitemap,
and shows you which queries you rank for. **Do this first.**

### Steps

1. Open https://search.google.com/search-console and sign in with
   the Google account you want to own the property.
2. Click **Add property → URL prefix**. Paste:
   `https://www.advottic.com`
3. Pick the **HTML tag** verification method. You'll get a snippet
   that looks like:
   ```html
   <meta name="google-site-verification" content="ABCD1234..." />
   ```
4. Copy only the `content` value (the `ABCD1234...` part).
5. In Vercel: open the **counsel-optics** project → Settings →
   Environment Variables. Add a new variable:
   - **Name**: `GOOGLE_SITE_VERIFICATION`
   - **Value**: paste the token
   - **Environments**: tick Production, Preview, Development
6. Trigger a redeploy: Vercel → Deployments → latest → ⋯ menu →
   **Redeploy** (no rebuild required).
7. Back in Search Console, click **Verify**. It should pass within
   ~30 seconds of the redeploy completing.
8. Once verified, in the left rail open **Sitemaps**, paste
   `sitemap.xml`, click **Submit**.

### Once you're in Search Console

- **Performance** report: queries, clicks, impressions, CTR. The
  single most useful page in this whole tool — check it weekly.
- **URL Inspection**: paste `https://www.advottic.com/about` (or any
  page) → **Test Live URL**. Confirms whether Google can see and
  index the page. Useful when you push a new content piece and want
  it crawled fast — click **Request indexing**.
- **Enhancements → FAQs / Sitelinks**: shows when our JSON-LD picks
  up rich-result eligibility. Wait 2–3 weeks for the first signal.

---

## 2. Bing Webmaster Tools (≈ 5 min, free)

Bing/Yahoo/DuckDuckGo all draw from this index. Smaller traffic but
also less competitive — easy wins on long-tail queries.

### Steps

1. Open https://www.bing.com/webmasters and sign in with a Microsoft
   account. (Outlook / Hotmail / your business email if you have a
   Microsoft 365 plan.)
2. Click **Add a site → Import from Google Search Console** if
   you've already verified there. Bing pulls everything across in
   one click.
3. If you skipped step 1 above, use **HTML Meta Tag** verification
   instead. Bing gives you a tag like:
   ```html
   <meta name="msvalidate.01" content="ABC123..." />
   ```
   Vercel env var: `BING_SITE_VERIFICATION` = the `content` value.
   Redeploy. Click **Verify**.
4. In Bing Webmaster: **Sitemaps → Submit sitemap**, paste
   `https://www.advottic.com/sitemap.xml`.

---

## 3. Google Business Profile (≈ 20 min, free)

Owns branded searches ("Advottic"), gets you a Knowledge Panel,
and lets you collect reviews. **You do not need a physical
storefront** — service-area businesses are eligible.

### Steps

1. Open https://www.google.com/business/ and click **Manage now**.
2. Sign in with the same Google account you used for Search Console
   (so the two link cleanly).
3. Business name: **Advottic**
4. Business category: **"Software company"** (closest match;
   "Legal services" risks Google flagging us as a law firm, which
   we are not).
5. **Add a location?** → No. Pick **"I deliver goods and services
   to my customers"** instead.
6. Service area: pick the U.S. (you can list specific states or
   the whole country).
7. Contact info:
   - Phone: `+1-925-300-1600` (the operator line already on the site)
   - Website: `https://www.advottic.com`
8. Verify: Google will mail a postcard with a 5-digit code to the
   business address Vercel/Stripe has on file for the LLC. It
   arrives in 5–14 days. Enter the code in GBP to complete
   verification.
9. After verification:
   - Add 6–10 photos (logo, mark, app screenshots, brand color
     swatches, team photo if any).
   - Pin **Walk into court prepared** as the business description.
   - Enable **Messaging** so people can DM the business.
   - Add **Services**: "Case organization", "Pre-hearing
     preparation", "Document review", "Attorney packet export".
10. Ask your first 5 happy users (the Pro subscribers) for a
    review with the **Get more reviews** link in GBP. That's the
    single biggest GBP ranking factor.

### What GBP will and won't do

- ✅ Will: dominate "Advottic" branded searches, show a Knowledge
  Panel, collect 5-star reviews.
- ❌ Won't: rank for "lawyer near me" — and we don't want it to.
  That's UPL territory and Google would eventually flag us.

---

## 4. Quick wins after the three above are live

These each take 10–15 min and stack:

- **Apple Business Connect**: https://businessconnect.apple.com —
  shows in Apple Maps and Siri results. Same data as GBP.
- **Bing Places**: same drill at https://www.bingplaces.com.
- **Product Hunt launch**: schedule for a Tuesday, post at 12:01 AM
  PT, line up 30+ supporters in advance. Pre-launch playbook:
  https://www.producthunt.com/launch
- **G2, Capterra, GetApp, Software Advice**: claim the listing,
  fill in pricing, screenshots, value props. Each is a high-DA
  backlink and gives intent traffic.
- **HARO / Connect.help**: sign up for daily journalist queries.
  Two responses per week → about one media placement per month.

---

## 5. Validating the technical foundation

Once Search Console is verified, run these checks:

1. **Google Rich Results Test**:
   https://search.google.com/test/rich-results — paste
   `https://www.advottic.com/`. Should detect `Organization`,
   `SoftwareApplication`, and `FAQPage`.
2. **Sitemap reachability**:
   `https://www.advottic.com/sitemap.xml` should return XML.
3. **Robots.txt reachability**:
   `https://www.advottic.com/robots.txt` should return rules.
4. **OpenGraph preview**:
   https://www.opengraph.xyz/?url=https%3A%2F%2Fwww.advottic.com%2F
   — check the home and /about previews look good.
5. **Mobile-Friendly Test**:
   https://search.google.com/test/mobile-friendly
6. **Lighthouse** (Chrome DevTools → Lighthouse tab) → SEO
   category should be 100.

---

## Tracking the launch

Once everything is verified, you'll want a single dashboard
view of:

- Organic clicks/week (Search Console)
- New sign-ups/week (Supabase)
- Trial → paid conversion (Stripe)
- Feedback inbox (Resend / `/feedback` table)

Spreadsheet or Notion doc, weekly Friday review. The discipline of
looking at the numbers is the single highest-leverage habit for a
solo-founder launch.
