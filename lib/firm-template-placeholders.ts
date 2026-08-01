/**
 * Placeholder rules shared by the counsel template editor and the employee
 * fill-and-sign page. Both sides have to agree on which `{{keys}}` are the
 * firm's to fill in and which are the employee's, so they read the same file.
 */

/**
 * Placeholders every template gets for free, resolved from the firm record at
 * render time rather than typed into the body.
 *
 * `firms.name` is the only name the employee has ever seen (it brands the
 * rail, the logo and the footer), so it is the only one an agreement they sign
 * should carry. A template that writes the name into its body freezes whatever
 * the firm was called the day it was drafted, which is how a Zinpro-branded
 * hub came to serve an NDA naming "Anderson Foundation" as the Company.
 *
 * These are deliberately excluded from the editor's field extraction: they are
 * not something an employee fills in, so they must not become an input.
 */
export const RESERVED_FIRM_KEYS = ['firm_name', 'company_name'] as const;

export function isReservedFirmKey(key: string): boolean {
  return (RESERVED_FIRM_KEYS as readonly string[]).includes(key);
}

/**
 * Which fields may be pre-filled with the signed-in employee's own name.
 *
 * This used to be `/name/.test(key)`, an unanchored substring test, so every
 * key containing "name" was filled with the employee: `counterparty_name`,
 * `recipient_name`, `party_b_name`. The live NDA opened with the employee as
 * their own counterparty. Only keys that clearly denote the signer are
 * pre-filled now; the other side of an agreement is never guessed.
 */
export function isSelfNameField(key: string): boolean {
  return /^(your|employee|signer|staff|my)_?(full_?)?name$|^(full_?)?name$/.test(
    key.trim().toLowerCase(),
  );
}
