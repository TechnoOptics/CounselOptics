/**
 * Free legal templates. Each entry is rendered at /templates/<slug>
 * as an inline-readable / copyable / printable document. No login,
 * no email gate.
 *
 * Why this exists: free-template libraries are the most reliably
 * backlinked legal-tech surface on the internet. Legal aid orgs,
 * tenant-rights nonprofits, freelancer blogs, Reddit threads, and
 * Wikipedia "External Links" sections all link to free, reliable
 * template URLs. Every link is a PageRank vote toward advottic.com.
 *
 * Bracketed `{{tokens}}` are the user-editable spots. The page
 * renders them as inline placeholder text the user replaces in
 * their copy.
 *
 * NOT LEGAL ADVICE. Every template page closes with the same
 * "consult an attorney in your jurisdiction" line.
 */

export type Template = {
  slug: string;
  /** Title shown on the page + in metadata. */
  title: string;
  /** One-line description for snippet + JSON-LD. */
  oneLine: string;
  /** Eyebrow / category. */
  category: string;
  /** ISO date the template was last reviewed for accuracy. */
  lastReviewed: string;
  /** How a typical user would use this template - 2-4 sentences. */
  context: string;
  /** Pre-use warnings (jurisdiction quirks, notarization, etc.). */
  warnings: string[];
  /** The template body itself. Use {{tokens}} for replaceable parts. */
  body: string;
  /** Search keywords. */
  keywords: string[];
};

export const TEMPLATES: Template[] = [
  {
    slug: 'demand-letter',
    title: 'Demand Letter Template',
    oneLine:
      "A demand letter formally asks someone to fix a problem (pay back money, return property, stop doing something) before you sue. Most courts expect to see one. Sending one resolves about 60% of disputes without litigation.",
    category: 'Pre-litigation',
    lastReviewed: '2026-06-08',
    context:
      "Send a demand letter when you have a specific, dollar-quantifiable problem with a specific person or business and want them to fix it without going to court. The letter does three things: states the facts clearly, attaches a number to the harm, and gives them a deadline to respond. Keep it factual and polite - it may end up as Exhibit A in a small-claims case.",
    warnings: [
      'Send by both email AND certified mail with return receipt; keep both receipts as proof of delivery.',
      'Do not threaten anything you would not actually do. A demand letter threatening "we will sue" should be a letter you are prepared to follow through on.',
      'In some jurisdictions a demand letter starts the statute-of-limitations clock or tolls it. Check your state.',
      'Do not include any settlement offer you are not prepared to honor; an accepted offer becomes a binding contract.',
    ],
    body: `{{Your Full Name}}
{{Your Street Address}}
{{Your City, State ZIP}}
{{Your Email}}
{{Your Phone}}

{{Date}}

Via Certified Mail and Email

{{Recipient Full Name or Business Name}}
{{Recipient Street Address}}
{{Recipient City, State ZIP}}

Re: Demand for {{brief description, e.g. "Return of $5,000 Security Deposit"}}

Dear {{Recipient}},

I am writing to formally demand {{describe the action you want, e.g. "the return of my $5,000 security deposit"}}. The relevant facts are:

1. {{First fact in chronological order. Be specific - dates, dollar amounts, where, who.}}
2. {{Second fact.}}
3. {{Third fact, including the act or omission that caused the harm.}}

Despite {{describe any prior attempts to resolve, e.g. "my email of January 15, 2026 and follow-up call on February 1"}}, this matter remains unresolved.

I am owed {{exact dollar amount, e.g. "$5,000"}}. I am willing to resolve this matter without litigation if you pay this amount in full by {{deadline - typically 14-30 days from this letter, e.g. "March 15, 2026"}}.

If I do not receive payment by that date, I will pursue all available legal remedies, which may include filing a civil claim in {{court, e.g. "Hennepin County small claims court"}} where I will additionally seek court costs and statutory interest. {{Optional: "I have already begun preparing the necessary court paperwork."}}

Please send payment to the address above. I prefer payment by {{check / wire / ACH to account ending in XXXX}}.

This letter constitutes my good-faith attempt to resolve this matter informally. A copy will be retained for any subsequent legal proceedings.

Sincerely,

{{Signature}}
{{Your Printed Name}}

Enclosures: {{list any supporting documents you are attaching, e.g. "Lease agreement, security-deposit receipt, photos of property condition at move-out"}}`,
    keywords: [
      'demand letter template',
      'how to write a demand letter',
      'demand letter free',
      'pay me what you owe me letter',
      'pre-litigation demand',
    ],
  },
  {
    slug: 'nda',
    title: 'Non-Disclosure Agreement (NDA) Template',
    oneLine:
      "A mutual NDA protects confidential information shared between two parties. Use this version for business conversations where both sides will share sensitive info (a sales pitch, an investor diligence, a vendor evaluation).",
    category: 'Contracts',
    lastReviewed: '2026-06-08',
    context:
      "Use a Non-Disclosure Agreement before any business conversation where one or both sides will share confidential information you do not want public: technical roadmaps, customer lists, source code, financial figures, unreleased products. This is a mutual NDA - it protects both sides. For a one-way NDA (one side sharing, the other receiving) you would strike the mutual language and identify which party is the Disclosing Party.",
    warnings: [
      'NDAs do not cover information that becomes public on its own, was already known to the receiving party, or that the receiving party develops independently.',
      'NDAs typically have a fixed duration (1-5 years is common). Perpetual NDAs are hard to enforce.',
      'Trade secrets get separate, stronger protection under the Defend Trade Secrets Act (federal) and state UTSA. An NDA is not a substitute for trade-secret hygiene.',
      'NDAs cannot stop someone from reporting a crime, harassment, or a securities violation. Many states have explicit carveouts.',
    ],
    body: `MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement (the "Agreement") is entered into on {{Effective Date}} (the "Effective Date") by and between:

{{Party A Name}}, a {{state of incorporation}} {{entity type, e.g. "limited liability company"}} located at {{address}} ("Party A"), and

{{Party B Name}}, a {{state}} {{entity type}} located at {{address}} ("Party B").

Each party may be referred to as a "Party" and collectively as the "Parties."

1. PURPOSE. The Parties wish to explore a potential {{describe purpose, e.g. "business relationship involving a software licensing arrangement"}} (the "Purpose"). In connection with the Purpose, each Party may disclose to the other confidential information.

2. CONFIDENTIAL INFORMATION. "Confidential Information" means any non-public information, in any form, that a Party identifies as confidential or that a reasonable person would understand to be confidential under the circumstances, including but not limited to: technical data, trade secrets, know-how, research, product plans, customer lists, software, source code, financial information, business strategies, and pricing.

3. EXCLUSIONS. Confidential Information does not include information that: (a) was publicly known at the time of disclosure; (b) becomes publicly known through no fault of the receiving Party; (c) was already in the receiving Party's possession prior to disclosure; (d) is independently developed by the receiving Party without reference to the disclosing Party's Confidential Information; or (e) is rightfully obtained from a third party without breach of any confidentiality obligation.

4. OBLIGATIONS. Each Party agrees to: (a) hold the other Party's Confidential Information in strict confidence; (b) use the Confidential Information solely for the Purpose; (c) limit disclosure to its employees, contractors, and advisors who have a need to know and are bound by confidentiality obligations at least as protective as those in this Agreement; and (d) protect the Confidential Information with at least the same degree of care it uses to protect its own confidential information, but no less than reasonable care.

5. TERM. This Agreement begins on the Effective Date and continues for {{duration, e.g. "three (3) years"}}, after which the confidentiality obligations survive for an additional {{duration, e.g. "two (2) years"}} from the date of last disclosure.

6. RETURN OR DESTRUCTION. Upon written request, the receiving Party will promptly return or destroy all Confidential Information of the disclosing Party in its possession, except as required to be retained by law or its internal records-retention policies.

7. NO LICENSE. Nothing in this Agreement grants either Party any right or license in the other Party's Confidential Information, intellectual property, or technology.

8. PERMITTED DISCLOSURES. Nothing in this Agreement prevents either Party from: (a) reporting a violation of law to a government agency; (b) participating in a government investigation; or (c) complying with a valid subpoena or court order, provided that the receiving Party gives prompt notice to the disclosing Party where legally permitted.

9. NO WARRANTY. All Confidential Information is provided "AS IS." Neither Party makes any warranty about the accuracy or completeness of its Confidential Information.

10. GOVERNING LAW. This Agreement is governed by the laws of the State of {{state}}, without regard to its conflict-of-laws principles.

11. INJUNCTIVE RELIEF. The Parties acknowledge that breach of this Agreement may cause irreparable harm and that the non-breaching Party is entitled to seek injunctive relief in addition to any other remedies available.

12. ENTIRE AGREEMENT. This Agreement is the entire agreement between the Parties concerning its subject matter and supersedes all prior agreements on the same subject. Any modification must be in writing signed by both Parties.

IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.

PARTY A:

By: ______________________________
Name: {{name}}
Title: {{title}}
Date: ____________

PARTY B:

By: ______________________________
Name: {{name}}
Title: {{title}}
Date: ____________`,
    keywords: [
      'nda template',
      'non-disclosure agreement template',
      'mutual nda template',
      'free nda',
      'business nda',
    ],
  },
  {
    slug: 'cease-and-desist',
    title: 'Cease and Desist Letter Template',
    oneLine:
      "A cease and desist letter formally tells someone to stop a specific harmful action and warns of legal consequences if they continue. Common uses: trademark infringement, harassment, defamation, copyright infringement.",
    category: 'Pre-litigation',
    lastReviewed: '2026-06-08',
    context:
      "Send a cease and desist when someone is actively doing something harmful (using your brand, copying your work, harassing you, defaming you) and you want them to stop before you escalate to litigation. The letter creates a paper trail showing they were on notice - which matters for proving willfulness later and for getting enhanced damages in some areas of law.",
    warnings: [
      'Have a real legal claim before sending. A cease and desist that is itself baseless may constitute tortious interference or, in some states, abusive litigation.',
      'For trademark or copyright matters, send via counsel if possible - a lawyer-signed letter is taken more seriously and avoids accidental admissions.',
      'Do not send threats you are not prepared to carry out.',
      'In domestic situations (stalking, harassment, ex-partner), a cease and desist alone is rarely enough. Consider a protective order through your court instead, and call 1-800-799-7233 for support.',
    ],
    body: `{{Your Full Name or Counsel\'s Name and Firm}}
{{Address}}
{{City, State ZIP}}
{{Email}}
{{Phone}}

{{Date}}

Via Certified Mail with Return Receipt and Email

{{Recipient Name}}
{{Recipient Address}}
{{City, State ZIP}}

Re: CEASE AND DESIST - {{brief description of harm, e.g. "Unauthorized Use of [Trademark]"}}

Dear {{Recipient}},

This letter is written on behalf of {{yourself or your business name}} regarding {{describe the harmful conduct, e.g. "your unauthorized use of the trademark ACME™ in connection with your online store at example.com"}}.

The Facts:
1. {{Specific fact #1 - dates, URLs, screenshots, witness statements as relevant.}}
2. {{Specific fact #2.}}
3. {{Specific fact #3, including how the conduct harms you or violates your rights.}}

The Law:
Your conduct constitutes {{the legal violation, e.g. "trademark infringement under the Lanham Act, 15 U.S.C. § 1114 and § 1125"}}. {{Brief one-line explanation of why it violates that law.}}

Demand:
You are hereby demanded to immediately:

1. CEASE all use of {{describe what they must stop, e.g. "the ACME™ mark in any form, in any advertising, on any product, and on any digital surface"}};
2. REMOVE all infringing materials within {{deadline, e.g. "seven (7) days"}} of the date of this letter, including but not limited to {{specific items, e.g. "the products listed at example.com/acme, all social-media posts referencing ACME, and all packaging bearing the mark"}};
3. PROVIDE written confirmation of compliance to the undersigned by {{deadline, e.g. "May 15, 2026"}};
4. {{Additional demand if applicable, e.g. "account for and disgorge any profits derived from the infringing conduct"}}.

Consequences:
If you fail to comply by the deadline above, I will pursue all available legal remedies, including but not limited to filing suit in {{venue, e.g. "the United States District Court for the District of Minnesota"}} seeking injunctive relief, statutory damages of up to {{statutory amount, e.g. "$150,000 per infringement"}}, attorneys' fees, and costs. {{If applicable: "I have already engaged counsel and authorized the preparation of a complaint."}}

This letter constitutes formal notice of {{the violation, e.g. "the infringement"}}. It also constitutes evidence of willfulness should this matter proceed to litigation.

Nothing in this letter is a waiver of any right or remedy, all of which are expressly reserved.

Govern yourself accordingly.

Sincerely,

{{Signature}}
{{Printed Name}}

cc: {{any other recipient, e.g. counsel or relevant agency}}`,
    keywords: [
      'cease and desist template',
      'free cease and desist letter',
      'trademark cease and desist',
      'cease and desist letter sample',
      'how to write a cease and desist',
    ],
  },
  {
    slug: 'lease-termination-notice',
    title: 'Lease Termination Notice Template',
    oneLine:
      "Formal written notice that you (the tenant or landlord) intend to end a rental agreement. Most states require written notice with specific lead time (usually 30, 60, or 90 days).",
    category: 'Landlord-tenant',
    lastReviewed: '2026-06-08',
    context:
      "Use a lease termination notice when you want to end a month-to-month tenancy, a fixed-term lease that allows early termination, or a tenancy where the other party has breached. The notice period is dictated by state law and (sometimes) the lease itself - 30 days is the most common minimum, but several states require 60 or 90 days. Always send via a method that creates a delivery record (certified mail, hand delivery with a witness, or a state-permitted electronic delivery method).",
    warnings: [
      'Notice periods vary by state. California requires 60 days for tenancies over one year; New York requires 30, 60, or 90 days depending on length of tenancy.',
      'Just-cause eviction protections in California, Oregon, New York, and many cities limit when a landlord can serve a no-fault termination notice.',
      'If you are a tenant terminating during a fixed-term lease, you may owe rent through the end of the lease unless your state has an early-termination statute or your lease allows it.',
      'Military service members have additional protections under the Servicemembers Civil Relief Act allowing early lease termination.',
    ],
    body: `{{Your Name}}
{{Your Address}}
{{Your City, State ZIP}}
{{Date}}

Via Certified Mail and Email

{{Other Party Name}}
{{Other Party Address}}
{{Other Party City, State ZIP}}

NOTICE TO {{TERMINATE / VACATE}} TENANCY

Re: {{Rental Property Address}}

Dear {{Other Party}},

Pursuant to the terms of the rental agreement dated {{lease date}} (the "Lease") and {{relevant state statute, e.g. "Minnesota Statute § 504B.135"}}, this letter serves as formal notice that {{specify: "I, the tenant, intend to vacate" OR "the tenancy is being terminated"}} the property at {{rental property address}} (the "Property").

The effective date of termination will be {{date - count notice days from delivery, e.g. "thirty (30) days from receipt of this notice, no earlier than April 15, 2026"}}. {{If month-to-month: "This is at least the minimum notice required by state law and by the Lease."}}

{{If tenant terminating}}
I will return possession of the Property by {{move-out date}}. The Property will be returned in the same condition as when received, normal wear and tear excepted. I will provide a forwarding address for the return of the security deposit:

{{Forwarding Address}}

Please return the security deposit in the amount of {{deposit amount}} by {{state-required deadline, e.g. "twenty-one (21) days from the date of move-out, as required by [state] law"}}. Any deductions must be itemized in writing as required by {{state statute}}.

{{If landlord terminating}}
You must vacate the Property on or before {{move-out date}}. Please return all keys, garage remotes, and access cards. I will conduct a move-out inspection on {{date}}; please contact me at {{phone or email}} to be present. Your security deposit will be returned, less any lawful deductions itemized in writing, within {{state-required deadline}} as required by {{state statute}}.

{{Reason for termination, if applicable - some states require a stated reason for landlord-initiated terminations.}}

Sincerely,

{{Signature}}
{{Printed Name}}

cc: {{any other relevant party, e.g. co-tenant, property manager, or legal counsel}}`,
    keywords: [
      'lease termination notice',
      '30 day notice to vacate template',
      'how to break a lease',
      'notice to terminate tenancy',
      'free lease termination letter',
    ],
  },
  {
    slug: 'security-deposit-demand',
    title: 'Security Deposit Return Demand Template',
    oneLine:
      "Formal demand letter for the return of a security deposit that was not refunded within your state's statutory deadline. Most states impose 2x-3x damages on landlords who improperly withhold.",
    category: 'Landlord-tenant',
    lastReviewed: '2026-06-08',
    context:
      "Use this when you moved out, provided a forwarding address, and the landlord did not return your security deposit within the state-required deadline (typically 14-60 days). Most states impose statutory damages of 2x or 3x the wrongfully withheld amount, plus attorneys' fees in some jurisdictions. Send via certified mail with return receipt - delivery proof matters for small-claims court.",
    warnings: [
      'Confirm your state\'s deadline and damages before writing the letter. California: 21 days return deadline, statutory damages up to 2x. Texas: 30 days, damages = $100 plus 3x the wrongfully withheld portion. New York: 14 days, damages = 2x.',
      'Some states require the landlord to itemize deductions in writing within the same deadline; failure to itemize forfeits the right to withhold.',
      'Keep copies of the lease, move-out condition photos, move-in walkthrough, and the forwarding-address letter as exhibits.',
      'If the property was a multi-unit and the landlord did not hold the deposit in a separate account (some states require this), that is an additional defense - and an additional violation.',
    ],
    body: `{{Your Full Name}}
{{Your Current Address}}
{{Your City, State ZIP}}
{{Your Email}}
{{Your Phone}}

{{Date}}

Via Certified Mail with Return Receipt and Email

{{Landlord Full Name or Management Company}}
{{Landlord Address}}
{{Landlord City, State ZIP}}

Re: Demand for Return of Security Deposit - {{Rental Property Address}}

Dear {{Landlord Name}},

I rented the property at {{rental address}} from {{lease start date}} to {{move-out date}}. I paid a security deposit of {{deposit amount}} at the start of the tenancy. My forwarding address was provided to you in writing on {{forwarding-address date}}.

Under {{relevant state statute, e.g. "California Civil Code § 1950.5"}}, you were required to return my security deposit (or provide a written itemized list of deductions) within {{state-required deadline, e.g. "21 days"}} of the surrender of possession. That deadline was {{deadline date}}. As of the date of this letter, I have received {{the entire amount has been withheld OR "only [partial] amount of $X with no itemization"}}.

I am demanding return of the wrongfully withheld portion of my security deposit in the amount of {{amount withheld}} within fourteen (14) days of the date of this letter.

Your wrongful withholding subjects you to:

1. Return of the full amount of the wrongfully withheld portion: {{amount}};
2. Statutory damages of up to {{state-specific multiplier and amount, e.g. "twice the amount wrongfully withheld, or $X under California Civil Code § 1950.5(l)"}}; and
3. {{If applicable}} Attorneys' fees if the matter goes to court.

Total demand: {{total = withheld + statutory damages}}.

If you do not return the amounts demanded by {{deadline}}, I will file a claim in {{small claims court, e.g. "Hennepin County Small Claims Court"}}, where the maximum recovery is up to {{state small claims max}}. I have already prepared the necessary paperwork and will file immediately upon expiration of this deadline.

Please send payment by check to the address above or by ACH to {{account ending in last 4}}.

Sincerely,

{{Signature}}
{{Printed Name}}

Enclosures:
- Copy of lease agreement
- Move-in walkthrough and photos
- Move-out walkthrough and photos
- Forwarding-address notification (date stamped)
- Any prior correspondence about the deposit`,
    keywords: [
      'security deposit demand letter',
      'landlord did not return security deposit',
      'security deposit small claims',
      'security deposit lawsuit template',
      'how to sue for security deposit',
    ],
  },
];

export function getTemplate(slug: string): Template | null {
  return TEMPLATES.find((t) => t.slug === slug) ?? null;
}
