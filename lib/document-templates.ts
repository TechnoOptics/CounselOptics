/**
 * Document templates Bella can draft from. Each template is a
 * lightweight spec - title, description, audience, the skeleton
 * with placeholders, and the inputs Bella should ask the user for.
 *
 * The templates are intentionally NOT a black-box prompt. Bella
 * reads the skeleton + the facts, then drafts the full document in
 * her own response. The skeleton just gives her structure so the
 * outputs are predictable and a relying attorney can spot what's
 * wrong. The "required_inputs" list is what Bella confirms with the
 * user before drafting.
 *
 * What we ship deliberately stays narrow:
 *   - Demand letters, NDA, lease termination, cease-and-desist for
 *     consumer self-help.
 *   - Engagement letter, retainer agreement, simple complaint shell,
 *     and an HR offer letter for the firm side.
 *
 * The disclaimer language at the bottom of every output is fixed.
 * Jurisdictional fit (whether a particular template can be used
 * for a particular document class in a particular state) stays a
 * question for counsel - Bella reminds the user every time.
 */

export type DocumentAudience = 'consumer' | 'firm' | 'both';

export type DocumentTemplate = {
  id: string;
  title: string;
  description: string;
  audience: DocumentAudience;
  /** Inputs Bella should confirm with the user before drafting. */
  requiredInputs: Array<{
    key: string;
    label: string;
    hint?: string;
  }>;
  /**
   * Skeleton with curly-brace placeholders Bella fills in. NOT a
   * Mustache template - Bella reads it and writes naturally, using
   * the structure as a guide.
   */
  skeleton: string;
};

export const DOCUMENT_TEMPLATES: DocumentTemplate[] = [
  {
    id: 'demand_letter',
    title: 'Demand letter',
    description:
      'A formal letter demanding the recipient do (or stop doing) something within a stated deadline, citing the legal basis. Use before suing.',
    audience: 'both',
    requiredInputs: [
      { key: 'sender', label: 'Your name (the person making the demand)' },
      { key: 'sender_address', label: 'Your mailing address' },
      { key: 'recipient', label: 'Recipient name (the person you are demanding from)' },
      { key: 'recipient_address', label: 'Recipient mailing address' },
      { key: 'demand', label: 'What exactly you are demanding (be specific - dollar amount, action, or both)' },
      { key: 'basis', label: 'The factual story + legal basis (one paragraph)' },
      { key: 'deadline', label: 'Deadline for compliance (eg. "14 days from receipt")' },
    ],
    skeleton: `[Sender name]
[Sender address]

[Today's date]

VIA [delivery method - certified mail, hand delivery, email]

[Recipient name]
[Recipient address]

Re: Demand for [one-line subject]

Dear [Recipient]:

This letter is a formal demand that you [restate the demand precisely].

[Background paragraph: what happened, when, who was involved. Stick to facts you can prove.]

[Legal basis paragraph: the contract clause, statute, or common-law doctrine that gives the sender the right to demand this. Cite plainly - "Section 4 of the lease dated [date]" or "Cal. Civ. Code Section 1942" etc.]

I demand that you [restated demand] no later than [deadline]. If you fail to do so, I will pursue every available remedy, including [eg. filing suit, reporting to the appropriate regulator, recording a lien]. Please direct all responses to me at the address above or by email at [sender email].

This letter is not a waiver of any other rights I have, all of which are expressly reserved.

Sincerely,

[Sender name]`,
  },
  {
    id: 'cease_and_desist',
    title: 'Cease-and-desist letter',
    description:
      'Demand the recipient stop a specific harmful activity (harassment, defamation, IP infringement, breach) immediately.',
    audience: 'both',
    requiredInputs: [
      { key: 'sender', label: 'Your name' },
      { key: 'recipient', label: "Recipient's name" },
      { key: 'conduct', label: 'The conduct you want stopped (be specific)' },
      { key: 'harm', label: "Why the conduct is harmful and what you'll do if it continues" },
      { key: 'deadline', label: 'When the conduct must stop by' },
    ],
    skeleton: `[Sender name]
[Sender address]

[Today's date]

VIA [delivery method]

[Recipient name]
[Recipient address]

Re: Cease and desist - [one-line subject]

Dear [Recipient]:

You are hereby instructed to cease and desist from [specific conduct] immediately and permanently.

[Facts paragraph: when, where, what you observed. Be precise. Include URLs, dates, witnesses if applicable.]

[Legal basis paragraph: the statute, contract clause, or common-law right being violated. For defamation, include why the statements are false. For IP, include the registration / first-use evidence.]

If the conduct does not stop by [deadline], I will [stated consequence: file suit for X, seek injunctive relief, report to law enforcement / platform / regulator, etc.]. I am also prepared to seek damages, including [if applicable: statutory, attorney's fees, exemplary].

Govern yourself accordingly.

Sincerely,

[Sender name]`,
  },
  {
    id: 'lease_termination',
    title: 'Notice to terminate lease',
    description:
      'Tenant or landlord notice ending a residential lease. Auto-fills the notice period required by the jurisdiction.',
    audience: 'consumer',
    requiredInputs: [
      { key: 'sender_role', label: 'Are you the tenant or landlord?' },
      { key: 'sender', label: 'Your name' },
      { key: 'recipient', label: "Other party's name" },
      { key: 'address', label: 'Property address' },
      { key: 'state', label: 'State (jurisdiction)' },
      { key: 'termination_date', label: 'Date you want the lease to end' },
      { key: 'reason', label: 'Reason for termination (optional - some states require it)' },
    ],
    skeleton: `[Sender name]
[Sender address]

[Today's date]

[Recipient name]
[Recipient address]

Re: Notice to terminate lease at [property address]

Dear [Recipient]:

Pursuant to the lease dated [lease date] for the premises at [property address], this is my formal notice that I am terminating the lease effective [termination date].

[Reason paragraph if provided. If month-to-month, note the statutory notice period being provided. If for-cause, cite the lease clause and the breach.]

[Move-out logistics: when you'll vacate, where to send the security deposit, contact information.]

[State-specific add-ons - eg. California requires the tenant be informed of their right to a pre-move-out inspection.]

Sincerely,

[Sender name]`,
  },
  {
    id: 'mutual_nda',
    title: 'Mutual non-disclosure agreement',
    description:
      'Two-party NDA where both sides may disclose confidential information. Standard term, narrow definition, carve-outs for compelled disclosure.',
    audience: 'both',
    requiredInputs: [
      { key: 'party_a', label: 'Party A name (your side)' },
      { key: 'party_b', label: 'Party B name (the counterparty)' },
      { key: 'purpose', label: 'Purpose of the disclosure (one sentence)' },
      { key: 'term_years', label: 'Confidentiality term in years (default: 3)' },
      { key: 'governing_law', label: 'Governing-law state (eg. Delaware, California)' },
    ],
    skeleton: `MUTUAL NON-DISCLOSURE AGREEMENT

This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of [Effective Date] by and between [Party A] and [Party B] (each a "Party" and together the "Parties").

1. Purpose. The Parties wish to explore [purpose] (the "Purpose") and in connection therewith may disclose to each other Confidential Information.

2. Confidential Information. "Confidential Information" means any non-public information disclosed by a Party (the "Discloser") to the other (the "Recipient") that is marked confidential or that a reasonable person would understand to be confidential under the circumstances. It does not include information that (a) is or becomes publicly available without breach of this Agreement, (b) is independently developed without use of the Discloser's Confidential Information, (c) was rightfully in the Recipient's possession without a duty of confidentiality before disclosure, or (d) is rightfully obtained from a third party without a duty of confidentiality.

3. Use and Protection. The Recipient will use Confidential Information solely for the Purpose, will not disclose it to third parties without the Discloser's prior written consent, and will protect it with at least the care it uses for its own confidential information of similar importance, but no less than reasonable care.

4. Compelled Disclosure. If the Recipient is compelled by law or court order to disclose Confidential Information, it will give the Discloser prompt written notice (where legally permitted) so the Discloser can seek a protective order, and will disclose only the portion legally required.

5. Term. This Agreement is effective on the Effective Date and continues for [term_years] years thereafter; the obligations in Section 3 survive for [term_years] years from disclosure.

6. No License. Nothing in this Agreement grants any license to the Recipient under any intellectual property right of the Discloser.

7. No Obligation. This Agreement does not obligate either Party to disclose any information or to enter into any further agreement.

8. Governing Law. This Agreement is governed by the laws of the State of [governing_law] without regard to its conflict-of-laws rules.

9. Entire Agreement. This Agreement is the entire agreement of the Parties on its subject and supersedes any prior or contemporaneous understandings.

Signed:

____________________
[Party A name]
By:
Title:
Date:

____________________
[Party B name]
By:
Title:
Date:`,
  },
  {
    id: 'engagement_letter',
    title: 'Engagement letter (firm to client)',
    description:
      'Defines scope, fee structure, and ground rules between a law firm and a new client. Required by most state bars before billing.',
    audience: 'firm',
    requiredInputs: [
      { key: 'firm_name', label: 'Firm name' },
      { key: 'client_name', label: 'Client name' },
      { key: 'matter', label: 'Description of the matter (one paragraph)' },
      { key: 'fee_structure', label: 'Fee structure (hourly with rate / flat fee / contingency)' },
      { key: 'retainer', label: 'Retainer amount (or "none")' },
      { key: 'jurisdiction', label: 'Jurisdiction / governing-law state' },
    ],
    skeleton: `[Firm name]
[Firm address]

[Today's date]

[Client name]
[Client address]

Re: Engagement letter - [matter short title]

Dear [Client]:

Thank you for engaging [Firm name] (the "Firm") to represent you in connection with [matter description] (the "Matter"). This letter confirms the terms of our engagement.

1. Scope of Representation. The Firm will represent you only with respect to the Matter as described above. We are not undertaking to represent you on any other matter unless we agree to do so in a separate writing.

2. Fee Structure. [Hourly: rates / Flat fee: amount + scope / Contingency: percentage and milestones, plus the language required by your state bar]. The fee does not include costs and disbursements (filing fees, expert fees, deposition costs, etc.), which will be billed at cost.

3. Retainer. [If retainer: amount due, where it is held, how it is applied. If trust account, identify the IOLTA account and confirm interest is paid to the bar foundation as required.]

4. Communication. We will provide you copies of significant correspondence and pleadings. We will return your calls and emails promptly, generally within one business day.

5. File Retention. After the Matter concludes, we will retain your file for [your firm's retention period - commonly 7 years] and may then destroy it. You may request the return of any original documents at any time.

6. Termination. You may terminate this engagement at any time on written notice. We may withdraw on the grounds permitted by the [state] Rules of Professional Conduct, including for non-payment.

7. Conflicts. We have run a conflict check and identified no current conflicts. If a conflict arises, we will inform you immediately and may withdraw if necessary.

8. Limitations. The law often turns on facts we cannot predict. We make no guarantees about the outcome of the Matter.

If the foregoing is acceptable, please sign and return one copy of this letter. We look forward to working with you.

Sincerely,

[Attorney name]
[Bar number, state]
[Firm name]

ACCEPTED AND AGREED:

____________________
[Client name]
Date:`,
  },
  {
    id: 'simple_complaint',
    title: 'Civil complaint shell (state court)',
    description:
      'A bare-bones civil complaint structure: parties, jurisdiction, venue, factual allegations, counts, prayer for relief. Always needs counsel review and local-rule conformity.',
    audience: 'firm',
    requiredInputs: [
      { key: 'court', label: 'Court (eg. "Superior Court of California, County of Los Angeles")' },
      { key: 'plaintiff', label: 'Plaintiff name' },
      { key: 'defendant', label: 'Defendant name' },
      { key: 'claim_type', label: 'Type of claim (breach of contract, negligence, fraud, etc.)' },
      { key: 'facts', label: 'Brief factual summary' },
      { key: 'damages', label: 'What damages or relief is sought' },
    ],
    skeleton: `IN THE [court name]

[Plaintiff name],
              Plaintiff,

       v.                                  Case No.: [TBD]

[Defendant name],                          COMPLAINT FOR [claim type]
              Defendant.                   JURY TRIAL DEMANDED

COMPLAINT

Plaintiff [Plaintiff name], by and through undersigned counsel, alleges as follows:

PARTIES

1. Plaintiff [name] is [resident of / a corporation organized under the laws of] [state].

2. Defendant [name] is [resident of / corporation organized under the laws of] [state].

JURISDICTION AND VENUE

3. This Court has subject-matter jurisdiction under [statute or rule].

4. Venue is proper in this Court under [statute or rule] because [reason - eg. the events occurred in this county, defendant resides here].

FACTUAL ALLEGATIONS

5. [Numbered paragraphs walking through what happened, in chronological order. Each paragraph one fact. Stick to facts the plaintiff can prove.]

[Continue numbering through the story.]

COUNT I - [Cause of Action]

[N]. Plaintiff repeats and re-alleges the foregoing paragraphs.

[N+1]. [Element 1 of the cause of action].

[N+2]. [Element 2].

[Continue through every element of the cause of action with supporting facts.]

PRAYER FOR RELIEF

WHEREFORE, Plaintiff respectfully requests that this Court enter judgment in Plaintiff's favor and against Defendant for:

  a. Compensatory damages in an amount to be proven at trial, but not less than $[amount];
  b. [Other relief - punitive, injunctive, declaratory, attorney's fees if available by statute];
  c. Costs of suit; and
  d. Such other and further relief as the Court deems just and proper.

JURY DEMAND

Plaintiff demands a trial by jury on all claims so triable.

Dated: [today]

                                          Respectfully submitted,

                                          [Attorney signature block]
                                          [Firm name]
                                          [Address]
                                          [Bar number]
                                          Attorney for Plaintiff`,
  },
  {
    id: 'offer_letter',
    title: 'Employment offer letter (at-will)',
    description:
      'Standard at-will employment offer with title, start date, compensation, benefits summary, and the at-will disclaimer.',
    audience: 'firm',
    requiredInputs: [
      { key: 'company_name', label: 'Company name' },
      { key: 'candidate', label: 'Candidate name' },
      { key: 'title', label: 'Job title' },
      { key: 'start_date', label: 'Proposed start date' },
      { key: 'salary', label: 'Annual salary or hourly rate' },
      { key: 'state', label: 'State of employment' },
    ],
    skeleton: `[Company name]
[Company address]

[Today's date]

[Candidate name]
[Candidate address]

Re: Offer of Employment

Dear [Candidate]:

[Company name] (the "Company") is pleased to offer you employment as [title], reporting to [manager], beginning on [start date].

1. Compensation. Your [annual salary / hourly rate] will be [amount], paid in accordance with the Company's standard payroll cycle and subject to applicable withholdings.

2. Benefits. You will be eligible to participate in the Company's standard benefit programs, including [list - health, dental, 401k match, PTO accrual, etc.], in accordance with their plan documents.

3. At-Will Employment. Your employment with the Company is at will, meaning either you or the Company may terminate the relationship at any time, with or without cause, with or without notice. Nothing in this letter or any other Company document creates a contract for any specific term of employment.

4. Confidentiality. As a condition of employment, you will be required to sign the Company's standard Confidentiality and Invention Assignment Agreement before your start date.

5. Eligibility to Work. This offer is contingent on your providing documentation establishing your authorization to work in the United States, as required by federal law.

6. Background Check. This offer is contingent on the satisfactory results of a background check.

If this offer is acceptable, please sign and return this letter no later than [response deadline].

We look forward to having you join the team.

Sincerely,

[Hiring manager name]
[Title]
[Company name]

ACCEPTED:

____________________
[Candidate name]
Date:`,
  },
  {
    id: 'terms_of_service',
    title: 'Website terms of service',
    description:
      'Generic terms-of-service for a website or app. Covers acceptance, account responsibilities, prohibited use, IP, disclaimers, dispute resolution.',
    audience: 'firm',
    requiredInputs: [
      { key: 'product_name', label: 'Product / website name' },
      { key: 'company_name', label: 'Operating company name' },
      { key: 'governing_law', label: 'Governing-law state' },
      { key: 'arbitration', label: 'Use binding arbitration? (yes/no)' },
    ],
    skeleton: `[Product name] - Terms of Service

Last updated: [today]

These Terms of Service ("Terms") govern your access to and use of [product name] (the "Service"), provided by [Company name] ("we," "us"). By accessing or using the Service you agree to these Terms.

1. Eligibility and Account. You must be at least 13 years old (and at least 16 if in the EEA) to use the Service. If you create an account, you are responsible for the activity that occurs under it and for keeping your credentials confidential.

2. Acceptable Use. You will not (a) violate any law or third-party right, (b) interfere with the Service's operation or security, (c) reverse-engineer the Service, (d) use the Service to send spam or malicious code, or (e) misrepresent your affiliation with any person.

3. User Content. You retain rights in content you submit. You grant us a worldwide, royalty-free, non-exclusive license to host, display, and process your content as needed to operate the Service.

4. Intellectual Property. The Service, including its software, design, and trademarks, is owned by us or our licensors. We grant you a limited, non-transferable license to use the Service in accordance with these Terms.

5. Subscriptions and Billing. [If applicable: how billing works, refund policy, cancellation, auto-renewal language. Otherwise: state the Service is free.]

6. Disclaimers. The Service is provided "as is" and "as available." We disclaim all warranties to the maximum extent permitted by law, including the implied warranties of merchantability, fitness for a particular purpose, and non-infringement.

7. Limitation of Liability. To the maximum extent permitted by law, we will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, revenue, or data, arising out of or in connection with the Service. Our total liability will not exceed the amount you paid us in the 12 months preceding the claim, or $100, whichever is greater.

8. Termination. We may suspend or terminate your access to the Service at any time, with or without cause, with or without notice.

9. Governing Law and Disputes. These Terms are governed by the laws of [governing_law] without regard to conflict-of-laws rules. [If arbitration: any dispute arising out of or relating to these Terms or the Service will be resolved by binding individual arbitration administered by [JAMS or AAA] under its rules. The seat of arbitration will be [city, state]. Class actions are waived to the maximum extent permitted by law.]

10. Changes. We may update these Terms from time to time; the "Last updated" date above will reflect any change. Your continued use of the Service after the change constitutes your acceptance of the updated Terms.

11. Contact. Questions about these Terms can be sent to [legal@yourcompany.com].`,
  },
];

export function getTemplate(id: string): DocumentTemplate | null {
  return DOCUMENT_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function listTemplatesForAudience(
  audience: DocumentAudience,
): DocumentTemplate[] {
  return DOCUMENT_TEMPLATES.filter(
    (t) => t.audience === audience || t.audience === 'both',
  );
}

/**
 * The fixed disclaimer Bella appends to every drafted document.
 * Editing this requires considering UPL (unauthorized practice of
 * law) implications - the language is intentionally narrow about
 * what Bella is, what she is not, and where the human attorney
 * has to step in.
 */
export const DRAFT_DISCLAIMER = `[Drafted with Advottic. This is a starting draft, not legal advice. The text reflects general patterns common to documents of this type but may not fit the specific facts, jurisdiction, or strategy of your matter. A licensed attorney should review this draft before you sign, send, or file it. Whether the document is enforceable in your jurisdiction is a question for that attorney.]`;
