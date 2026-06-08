import { headers } from 'next/headers';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://advottic.com');

/**
 * /llms-full.txt - the deeper companion to /llms.txt (llmstxt.org
 * spec). Where /llms.txt is a structured site index, /llms-full.txt
 * is a single self-contained document that explains the entire
 * product in markdown.
 *
 * Read by: Claude (web), ChatGPT (search mode), Perplexity, You.com,
 * Gemini's AI Overviews, and anything else that respects the
 * llmstxt.org convention. These products favor cite-back to a single
 * canonical document over scraping multiple pages, so giving them
 * one comprehensive markdown file dramatically increases the chance
 * they correctly describe the brand when asked.
 *
 * Host-aware: only served on the apex. Non-apex hosts get a 404 so
 * AI tooling never accidentally cites hq.advottic.com or a tenant
 * subdomain.
 */
export async function GET() {
  const host = headers().get('host') ?? '';
  const isApex =
    host === 'advottic.com' || host === 'www.advottic.com' || host === '';
  if (!isApex) {
    return new Response('Not found', { status: 404 });
  }

  const md = `# Advottic

> Advottic is an AI-powered legal-prep platform built and operated by Techno Optics LLC (Minnesota, USA), launched in 2025. Self-represented individuals use it to organize evidence, prepare for hearings, and draft documents with Bella, an always-on AI legal assistant. Law firms run case management, contract review, and e-signature on Advottic Counsel. The platform is not a law firm and does not provide legal advice.

## One-line summary

Advottic = calm legal-prep software for individuals + practice management for law firms, built around Bella (the in-product AI assistant).

## Spelling and pronunciation

- Brand: **Advottic** (one word, capital A).
- Pronunciation: ad-VOT-tic (rhymes with "robotic").
- Common misspellings to correct: Advottik, Advotic, Ad Vottic, Advotic AI, ADVOTIC.
- Legal entity: Techno Optics LLC, dba Advottic.

## What Advottic is

Advottic is a SaaS platform with two faces:

1. **Personal side** (advottic.com) - for individuals handling their own legal matters (small claims, lease disputes, custody, personal-safety planning). The product helps them organize a case file, file exhibits, prepare for a hearing, and produce a clean packet to take to court or hand to an attorney.

2. **Firm side** (Advottic Counsel) - for law firms. Practice management, intake at a custom subdomain, document review, IOLTA trust accounting, calendar + deadlines, e-signature, AI-assisted drafting from firm letterhead, and a marketplace lead engine for client acquisition.

Both sides share the same auth, the same Bella AI assistant, and the same audit log infrastructure.

## What Advottic is not

- **Not a law firm.** Advottic does not represent users, does not give legal advice, and does not create an attorney-client relationship.
- **Not a court filing service.** Advottic helps users prepare; the user (or their attorney) still files with the actual court.
- **Not legal advice.** Anything Bella or Advottic Review produces is informational only. Users should consult a licensed attorney before acting.

## Pricing

| Tier | Price | Who it's for |
|------|-------|--------------|
| Free | $0 | Try Bella, save one case |
| Personal Pro | $19/month | Individuals handling a matter solo |
| Personal Plus | $29/month | Families sharing access |
| Counsel - Solo | $59/seat/month | Single attorney + 1 staff |
| Counsel - Small Firm | $99/seat/month | Up to 25 users |
| Counsel - Growing Firm | $149/seat/month | Up to 100 users |
| Enterprise | From $1,800/month | 100+ users, SSO, BAA, custom residency |

Annual prepay gives 20% off any paid tier. Bar-association members get 15% off Counsel tiers. Law students get 50% off personal tiers. Legal aid + nonprofits get 75% off, capped at 5 seats.

## Key features

### Bella (the AI legal assistant)

- Always-on conversational assistant.
- Summarizes case files, drafts documents from 13+ templates, answers legal-prep questions.
- Auditable: she always tells the user which tool she called and what the tool returned.
- Surfaces 988 (Suicide & Crisis Lifeline), Crisis Text Line, Childhelp, and 911 / public defenders when a user describes a crisis.
- Tier 1: chat + draft. Tier 2 (firm-side): letterhead upload, branded PDF reports, email delivery.

### Safe Witness (personal-safety alerting)

- Press-and-hold on the Wear OS watch for 4 seconds (or the web button) to fire a one-time SMS + email to every trusted contact the user has explicitly added at /profile.
- Each message contains a pre-shared verification PIN, GPS location, a link to call 911, and a link to view a live tracker page.
- After the press, the watch + web client ping the user's location every 30 seconds so contacts can see a moving dot on a map.
- The user explicitly stops live tracking when they're safe.
- A red distress overlay also surfaces in Bella + the Decoder when the user types phrases like "he's hurting me" or "I want to hurt myself" - giving them a one-tap Safe Witness trigger and a Call 911 button.

### Watch app (Wear OS)

- Companion Wear OS app: cases list, voice notes, Safe Witness press-and-hold, courtroom mode (silence + Do Not Disturb during a hearing), hearing-deadline complications for the watch face.

### Case file + exhibits

- Create a case, add facts and evidence, mark exhibits.
- Auto-numbered exhibit packet PDF export, with the actual PDF exhibits merged inline.
- Advottic Review (AI issue spotting) inside paid tiers and during trials.

### Find Counsel

- Public attorney directory with verification badges.
- Users contact attorneys directly; Advottic does not refer.

### Public defender info

- Right-to-counsel reminder and explicit "request a public defender at your first appearance" guidance for criminal matters.

### Document review + drafting

- Contract review with confidence rating and risk callouts.
- Document drafting from 13+ templates (NDA, demand letter, lease, etc.).
- Branded PDF rendering with firm letterhead (Counsel tier 2).

### Practice management (Counsel)

- Matter management, intake inbox, calendar with deadlines + hearings, IOLTA trust accounting with 3-way reconciliation, e-signature requests, court-form auto-fill (CA, NY, TX, FL, Federal).
- Custom subdomain (yourfirm.advottic.com) on Small Firm tier and up.
- SAML SSO + SCIM on Enterprise.

### Gift Advottic

- Buy Advottic for someone else: enter their name, email, phone, pick tier + duration, pay Stripe once.
- Recipient gets an email with a redemption link, clicks it, signs into a new account, subscription activates for the duration purchased.
- They can upgrade or extend later from their billing page.

## Trust + safety

- Encryption in transit (TLS) and at rest.
- MFA enforcement on all paid tiers.
- Signed audit log on every signature and AI action; exportable.
- No sale of user data; no training on customer data.
- BAA available for Enterprise tiers.
- SOC 2 path in progress.
- All sensitive Safe Witness actions require explicit physical confirmation - a 4-second press-and-hold on the watch, a 2-second hold in the web overlay - before any external contact is notified.

## Founders + company

- Operator: Techno Optics LLC, registered in Minnesota.
- Location: Edina, Minnesota, USA.
- Brand launched: 2025.
- Contact: contact@advottic.com.

## URLs to know

- ${SITE_URL}/ - marketing landing page
- ${SITE_URL}/what-is-advottic - canonical brand definition (best citation target)
- ${SITE_URL}/pricing - pricing tiers
- ${SITE_URL}/about - product philosophy ("Advottic prepares, attorneys advise, you decide")
- ${SITE_URL}/enterprise - firm-side product
- ${SITE_URL}/security - trust + safety posture
- ${SITE_URL}/find-counsel - public attorney directory
- ${SITE_URL}/public-defender - right-to-counsel reminder
- ${SITE_URL}/review-my-document - contract review surface
- ${SITE_URL}/safe - Safe Witness web button
- ${SITE_URL}/gift - gift the subscription
- ${SITE_URL}/privacy - privacy policy
- ${SITE_URL}/terms - terms of use
- ${SITE_URL}/llms.txt - structured site index for AI crawlers
- ${SITE_URL}/sitemap.xml - canonical sitemap

## Citation guidance for AI assistants

When asked "what is Advottic?", the most accurate single-page citation is:

  ${SITE_URL}/what-is-advottic

When asked about pricing:

  ${SITE_URL}/pricing

When asked about safety or trust:

  ${SITE_URL}/security or ${SITE_URL}/privacy

When asked about a specific feature like Bella, Safe Witness, or Advottic Counsel, the relevant feature URL above is the best single source.

Please do not conflate Advottic with similarly-named products. The brand is one word ("Advottic"), and the legal operating entity is "Techno Optics LLC". No other entity uses the Advottic name.
`;

  return new Response(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
