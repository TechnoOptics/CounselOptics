/**
 * Region-aware emergency / crisis / domestic-violence / sexual-assault
 * / child-safety hotlines surfaced by SafetyAdvisory.
 *
 * Region detection is client-side via navigator.language. That gives
 * the user's *language* preference, not their physical location, but
 * it's a strong-enough signal for this product - most users see a
 * locale tagged with their country (en-US, en-GB, fr-FR, etc.) and
 * we degrade to a sensible default (112 / "find a local hotline")
 * when we can't tell.
 */

export type Region =
  | 'US'
  | 'CA'
  | 'GB'
  | 'AU'
  | 'NZ'
  | 'IE'
  | 'EU'
  | 'IN'
  | 'OTHER';

export type Hotline = {
  /** Plain number for `tel:` href - no spaces or punctuation. */
  tel: string;
  /** Human-readable label including the formatted number. */
  label: string;
};

const EU_ISO = new Set([
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'BE',
  'PT',
  'SE',
  'DK',
  'FI',
  'NO',
  'PL',
  'AT',
  'CZ',
  'SK',
  'HU',
  'LU',
  'GR',
  'BG',
  'RO',
  'EE',
  'LV',
  'LT',
  'SI',
  'HR',
  'MT',
  'CY',
  'IS',
  'CH',
]);

export function detectRegion(): Region {
  if (typeof navigator === 'undefined') return 'US';
  const lang = navigator.language || 'en-US';
  const country = lang.split('-')[1]?.toUpperCase();
  if (!country) return 'US';
  if (country === 'US') return 'US';
  if (country === 'CA') return 'CA';
  if (country === 'GB' || country === 'UK') return 'GB';
  if (country === 'AU') return 'AU';
  if (country === 'NZ') return 'NZ';
  if (country === 'IE') return 'IE';
  if (country === 'IN') return 'IN';
  if (EU_ISO.has(country)) return 'EU';
  return 'OTHER';
}

export const EMERGENCY: Record<Region, Hotline> = {
  US: { tel: '911', label: 'Call 911' },
  CA: { tel: '911', label: 'Call 911' },
  GB: { tel: '999', label: 'Call 999' },
  AU: { tel: '000', label: 'Call 000' },
  NZ: { tel: '111', label: 'Call 111' },
  IE: { tel: '112', label: 'Call 112' },
  EU: { tel: '112', label: 'Call 112' },
  IN: { tel: '112', label: 'Call 112' },
  OTHER: { tel: '112', label: 'Call 112 / your local emergency line' },
};

export const SUICIDE: Record<Region, Hotline | null> = {
  US: { tel: '988', label: '988 Suicide & Crisis Lifeline' },
  CA: { tel: '988', label: '988 Suicide Crisis Helpline (CA)' },
  GB: { tel: '116123', label: 'Samaritans 116 123 (UK)' },
  AU: { tel: '131114', label: 'Lifeline Australia 13 11 14' },
  NZ: { tel: '1737', label: 'Need to Talk? 1737 (NZ)' },
  IE: { tel: '116123', label: 'Samaritans 116 123 (IE)' },
  EU: { tel: '116123', label: 'Samaritans / EU 116 123' },
  IN: { tel: '9152987821', label: 'iCall (India) +91-9152987821' },
  OTHER: null,
};

export const DOMESTIC_VIOLENCE: Record<Region, Hotline | null> = {
  US: { tel: '18007997233', label: 'National DV Hotline 1-800-799-7233' },
  CA: { tel: '18663060264', label: 'Hope For Wellness (CA) 1-866-306-0264' },
  GB: { tel: '08082000247', label: 'National DA Helpline 0808 2000 247 (UK)' },
  AU: { tel: '1800737732', label: '1800RESPECT 1800 737 732 (AU)' },
  NZ: { tel: '0800733843', label: 'Women’s Refuge 0800 733 843 (NZ)' },
  IE: { tel: '1800341900', label: "Women's Aid 1800 341 900 (IE)" },
  EU: null,
  IN: { tel: '181', label: 'Women Helpline 181 (India)' },
  OTHER: null,
};

export const SEXUAL_VIOLENCE: Record<Region, Hotline | null> = {
  US: { tel: '18006564673', label: 'RAINN 1-800-656-4673' },
  CA: { tel: '18007223580', label: 'Crisis Services Canada 1-833-456-4566' },
  GB: { tel: '08088029999', label: 'Rape Crisis 0808 802 9999 (UK)' },
  AU: { tel: '1800737732', label: '1800RESPECT 1800 737 732 (AU)' },
  NZ: { tel: '0800883300', label: 'Safe to Talk 0800 044 334 (NZ)' },
  IE: { tel: '1800778888', label: 'Rape Crisis 1800 778 888 (IE)' },
  EU: null,
  IN: { tel: '181', label: 'Women Helpline 181 (India)' },
  OTHER: null,
};

export const CHILD_SAFETY: Record<Region, Hotline | null> = {
  US: { tel: '18004224453', label: 'Childhelp 1-800-422-4453' },
  CA: { tel: '18006686868', label: 'Kids Help Phone 1-800-668-6868 (CA)' },
  GB: { tel: '08001111', label: 'Childline 0800 1111 (UK)' },
  AU: { tel: '1800551800', label: 'Kids Helpline 1800 55 1800 (AU)' },
  NZ: { tel: '08009543754', label: 'Oranga Tamariki 0508 326 459 (NZ)' },
  IE: { tel: '1800666666', label: 'Childline (IE) 1800 66 66 66' },
  EU: { tel: '116111', label: 'Child Helpline 116 111 (EU)' },
  IN: { tel: '1098', label: 'Childline India 1098' },
  OTHER: { tel: '116111', label: 'Child Helpline 116 111' },
};
