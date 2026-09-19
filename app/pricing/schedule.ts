/**
 * The pricing schedule's data: the two tier ladders and the two comparison
 * matrices. It lives beside the page rather than in it because an App Router
 * `page.tsx` may export only the route's own reserved names, and
 * tests/schedule-of-fees.test.ts has to read these arrays to hold them to
 * lib/personal-tiers.ts and lib/firm-pricing.ts rather than to a regex.
 */
import { FIRM_TIER_PRICING, formatFirmTierPrice } from '@/lib/firm-pricing';
import type { ScheduleRow } from '@/components/marketing/file';

export type Tier = {
  id: string;
  name: string;
  price: string;
  cadence: string;
  features: string[];
  cta: { label: string; href: string };
  emphasized?: boolean;
};

// Consumer ("personal") ladder. Kept in lockstep with lib/personal-tiers.ts:
// case caps 1/3/8/15/40, Bella unlocks at Plus ($29), Advottic Review + invite-
// firm at Pro ($59), and the case timeline + group cases at Ultra ($99).
export const CONSUMER_TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    features: [
      '1 case',
      'Court-ready PDF export',
      'Safe Witness personal-safety alerts',
      'Receive e-signature requests as a signer',
      'Find counsel + public defender directories',
    ],
    cta: { label: 'Sign up free', href: '/sign-in?next=/cases' },
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$19',
    cadence: '/ month',
    features: [
      '3 cases',
      'Court-ready PDF export',
      'Safe Witness with SMS delivery',
      'E-sign as a signer, always free',
      'Priority support',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing' },
  },
  {
    id: 'plus',
    name: 'Plus',
    price: '$29',
    cadence: '/ month',
    features: [
      'Everything in Starter, plus:',
      '8 cases',
      'Bella AI assistant: chat + document drafting from templates',
      '500K Bella tokens / month',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing' },
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$59',
    cadence: '/ month',
    features: [
      'Everything in Plus, plus:',
      '15 cases',
      'Advottic Review: AI plain-English document review',
      'Invite your law firm to collaborate on a case',
      '1.5M Bella tokens / month',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing' },
    emphasized: true,
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: '$99',
    cadence: '/ month',
    features: [
      'Everything in Pro, plus:',
      '40 cases',
      'Case Timeline: turn evidence into a court-ready chronology',
      'Group / community cases',
      '3M Bella tokens / month (highest grant)',
    ],
    cta: { label: 'Start 7-day trial', href: '/billing' },
  },
];

export const FIRM_TIERS: Tier[] = [
  {
    id: 'solo',
    name: 'Solo',
    price: formatFirmTierPrice(FIRM_TIER_PRICING.solo),
    cadence: '/ user / month',
    features: [
      'Up to 1 attorney + 1 staff',
      '30 matters per attorney (matches typical solo caseload)',
      '2.5M Bella tokens / month',
      'Practice management: time, invoicing, IOLTA, intake, conflict check',
      'Bella (tier 1): docs, search, schedule, meetings, intake, conflict check, time + invoice',
      'Branded document drafting (13+ templates) with text-banner PDF header',
      'Counsel calendar: meetings, deadlines, hearings, integrations',
      'Send-to-sign with reminders + status tracking',
      'Court-form auto-fill (CA, NY, TX, FL, Federal)',
      'CSV + bulk doc import from Clio / MyCase / PracticePanther',
      'Action Center hub: War Room, Deadline Radar, Decode a document, Safe Witness',
      '25 GB document storage',
      '10 e-sign requests / month',
      'Extras: 50K tokens / matter / month past the cap',
    ],
    cta: { label: 'Start 7-day trial', href: '/counsel/onboarding' },
  },
  {
    id: 'firm',
    name: 'Small Firm',
    price: formatFirmTierPrice(FIRM_TIER_PRICING.small_firm),
    cadence: '/ user / month',
    features: [
      'Up to 25 users',
      '50 matters per attorney',
      '4M Bella tokens / month per seat (firm pool)',
      'Bella (tier 2): firm letterhead painted on every generated PDF',
      'Employee Hub: power-but-limited portal for non-attorney staff (requests, intakes, calendar, action items)',
      'Roles & groups with progressive feature unlock',
      'Customizable dashboard tiles (default + optional)',
      'IOLTA trust accounting with 3-way reconciliation',
      'Co-counsel referral network with fee-split tracking',
      'Marketplace lead boost (3x match rate)',
      'Custom firm subdomain (yourfirm.advottic.com)',
      'Branded e-sign emails with your logo',
      '250 GB document storage',
      '100 e-sign requests / month',
      'Discovery document review (250 docs / mo)',
      'Priority email support',
      'Extras: 50K tokens / matter / month past the cap',
    ],
    cta: { label: 'Start 7-day trial', href: '/counsel/onboarding' },
    emphasized: true,
  },
  {
    id: 'growing',
    name: 'Growing Firm',
    price: formatFirmTierPrice(FIRM_TIER_PRICING.growing_firm),
    cadence: '/ user / month',
    features: [
      '26 - 100 users',
      'Everything in Small Firm, plus:',
      '100 matters per attorney',
      '6M Bella tokens / month per seat (firm pool)',
      'Advanced analytics (matter profitability, attorney ROI)',
      'Enterprise menu customization (hide / rename / reorder the sidebar per role)',
      'Dedicated customer success manager',
      '1 TB document storage',
      '500 e-sign requests / month',
      'Discovery review (1,000 docs / mo)',
      'Custom Bella training on firm drafting style + voice',
      'SAML SSO',
      'Quarterly business review',
      'Extras: 30K tokens / matter / month past the cap',
    ],
    cta: { label: 'Start 7-day trial', href: '/counsel/request' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: formatFirmTierPrice(FIRM_TIER_PRICING.enterprise),
    cadence: '/ month',
    features: [
      '100+ users, no per-seat ceiling',
      'Negotiated matter ceiling (typically uncapped)',
      '15M+ tokens / month per seat (firm pool)',
      'SAML / OIDC SSO',
      '99.9% uptime SLA',
      'Dedicated infrastructure',
      'White-label tenant subdomain + full brand override',
      'Multi-firm group billing (M&A scenarios)',
      'Sandbox + staging environments',
    ],
    cta: { label: 'Contact sales', href: '/counsel/request?tier=enterprise' },
  },
];

/**
 * The two matrices, declared.
 *
 * These used to be derived by substring-matching a row label against a
 * tier's marketing `features[]`. Those arrays express inheritance as prose
 * ("Everything in Starter, plus:"), which a matcher cannot read, so every
 * inherited feature rendered as a middle dot meaning "not included" and the
 * public page told visitors that Plus, Pro and Ultra lose court-ready
 * export, Safe Witness, e-sign and priority support. A schedule of fees is
 * a commercial statement; every cell is written out and
 * tests/schedule-of-fees.test.ts holds the ladder to lib/personal-tiers.ts
 * and the seat bands to lib/firm-pricing.ts.
 *
 * Where a tier's `features[]` says "Everything in X, plus", the cell
 * inherits X's value.
 */
export const CONSUMER_ROWS: ScheduleRow[] = [
  { label: 'Cases', cells: ['1', '3', '8', '15', '40'] },
  { label: 'Court-ready PDF export', cells: ['Yes', 'Yes', 'Yes', 'Yes', 'Yes'] },
  // Free and Starter carry a token grant for item overage, but Bella herself
  // is locked below Plus, so a token count in those two cells would read as
  // an assistant the tier does not include.
  { label: 'Bella tokens / month', cells: ['Bella from Plus', 'Bella from Plus', '500K', '1.5M', '3M'] },
  { label: 'Advottic Review', cells: ['No', 'No', 'No', 'Yes', 'Yes'] },
  { label: 'Invite your law firm', cells: ['No', 'No', 'No', 'Yes', 'Yes'] },
  { label: 'Case timeline, group cases', cells: ['No', 'No', 'No', 'No', 'Yes'] },
  { label: 'Safe Witness', cells: ['Alerts', 'With SMS', 'With SMS', 'With SMS', 'With SMS'] },
  { label: 'E-sign as a signer', cells: ['Yes', 'Yes', 'Yes', 'Yes', 'Yes'] },
  { label: 'Priority support', cells: ['No', 'Yes', 'Yes', 'Yes', 'Yes'] },
];

export const FIRM_ROWS: ScheduleRow[] = [
  { label: 'Users', cells: ['1 attorney + 1 staff', 'Up to 25', '26 to 100', '100+'] },
  { label: 'Matters per attorney', cells: ['30', '50', '100', 'Negotiated'] },
  { label: 'Bella tokens / month', cells: ['2.5M', '4M per seat', '6M per seat', '15M+ per seat'] },
  { label: 'Firm letterhead on PDFs', cells: ['No', 'Yes', 'Yes', 'Yes'] },
  { label: 'Employee Hub', cells: ['No', 'Yes', 'Yes', 'Yes'] },
  { label: 'Custom subdomain', cells: ['No', 'Yes', 'Yes', 'White-label'] },
  { label: 'SSO', cells: ['No', 'No', 'SAML', 'SAML / OIDC'] },
  { label: 'Uptime SLA', cells: ['No', 'No', 'No', '99.9%'] },
  { label: 'Multi-firm group billing', cells: ['No', 'No', 'No', 'Yes'] },
];
