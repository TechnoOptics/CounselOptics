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
    id: 'power_of_attorney',
    title: 'Durable power of attorney',
    description:
      'Authorizes an agent to act for you on financial matters, surviving incapacity. State-specific - must be witnessed and / or notarized depending on jurisdiction.',
    audience: 'consumer',
    requiredInputs: [
      { key: 'principal', label: "Your name (the principal)" },
      { key: 'principal_address', label: "Your address" },
      { key: 'agent', label: "Agent's full name" },
      { key: 'agent_address', label: "Agent's address" },
      { key: 'state', label: 'State (jurisdiction)' },
      { key: 'powers', label: 'Powers granted (general / specific - list categories)' },
      { key: 'effective', label: 'When effective (immediately / on incapacity)' },
    ],
    skeleton: `DURABLE POWER OF ATTORNEY

I, [Principal name], of [Principal address], being of sound mind, designate [Agent name] of [Agent address] as my Attorney-in-Fact ("Agent") to act for me in any lawful way with respect to the powers granted below, with full authority to bind me as if I were acting personally.

1. Powers Granted. My Agent shall have authority to act on my behalf with respect to:
[List the categories the principal has chosen - eg. real property, banking, business operations, tax matters, retirement plans, government benefits, healthcare consents (if comprehensive POA), litigation, gifts within annual exclusion, etc.]

2. Durability. This power of attorney shall not be affected by my subsequent incapacity. [If springing: This power of attorney shall become effective only upon a written determination by two licensed physicians that I am unable to manage my financial affairs.]

3. Effective Date. This power of attorney is effective [immediately upon signing / on the date of my incapacity as described above].

4. Revocation. This power of attorney may be revoked at any time by a written instrument delivered to my Agent. Any third party who acts in good faith reliance on this instrument before receiving notice of revocation shall be held harmless.

5. Indemnity. My Agent shall not be liable for any act or omission undertaken in good faith. I will indemnify my Agent against any loss arising from such good-faith acts.

6. Reliance. Any third party may rely on a copy of this instrument as if it were the original. I waive any claim against a third party who acts in reliance on this instrument.

7. Governing Law. This power of attorney is governed by the laws of the State of [state].

Signed this [day] day of [month], [year].

________________________________
[Principal name], Principal

WITNESSES
We, the undersigned, witnessed the Principal sign this instrument and confirm that the Principal appeared to be of sound mind and acting freely.

________________________________     ________________________________
Witness 1                            Witness 2

NOTARY ACKNOWLEDGEMENT
State of [state]
County of [county]

On this date, [Principal name] personally appeared before me and acknowledged signing this instrument.

________________________________
Notary Public
My commission expires:`,
  },
  {
    id: 'living_will',
    title: 'Living will / advance directive',
    description:
      'States your wishes regarding life-sustaining treatment if you become unable to communicate. State-specific witness / notarization rules apply.',
    audience: 'consumer',
    requiredInputs: [
      { key: 'declarant', label: 'Your name' },
      { key: 'state', label: 'State (jurisdiction)' },
      { key: 'preferences', label: 'Treatment preferences (eg. no extraordinary measures, comfort care only, full code, etc.)' },
      { key: 'agent', label: 'Healthcare agent name (optional)' },
    ],
    skeleton: `ADVANCE HEALTHCARE DIRECTIVE / LIVING WILL

I, [Declarant name], of sound mind, make this declaration as a directive to be followed if I am unable to communicate my wishes regarding healthcare.

1. Conditions. If I am diagnosed by my attending physician and a second physician as having a terminal condition, being permanently unconscious, or being in an end-stage condition, and if life-sustaining treatment would only artificially prolong the dying process, my wishes are as follows:

[List the user's specific preferences. Common categories:
 - Cardiopulmonary resuscitation (CPR): yes / no
 - Mechanical ventilation: yes / time-limited trial / no
 - Tube feeding / artificial nutrition: yes / no
 - Antibiotics for infections: yes / comfort only / no
 - Dialysis: yes / no
 - Comfort care and pain management: always provided
 - Organ donation: opt-in / opt-out]

2. Healthcare Agent. [If named: I designate [Agent name] as my Healthcare Agent to make medical decisions consistent with this declaration if I cannot communicate. The Agent has access to my medical records.]

3. Conscience. I understand that any healthcare provider who in conscience cannot follow these directions must transfer my care to a provider who will.

4. Effect. This declaration shall be effective until revoked. I may revoke it orally or in writing at any time.

Signed this [day] day of [month], [year].

________________________________
[Declarant name]

WITNESSES (state-specific - typically two adults who are not the agent and not entitled to inherit from the declarant)

________________________________     ________________________________
Witness 1                            Witness 2`,
  },
  {
    id: 'independent_contractor',
    title: 'Independent contractor agreement',
    description:
      "Engagement of a contractor (not an employee). Defines scope, payment, IP assignment, confidentiality, and the worker's W-9 / 1099 status.",
    audience: 'firm',
    requiredInputs: [
      { key: 'company_name', label: 'Engaging company name' },
      { key: 'contractor_name', label: "Contractor's name" },
      { key: 'scope', label: 'Scope of work (one paragraph)' },
      { key: 'fee_structure', label: 'Fee (hourly + rate / fixed / milestone-based)' },
      { key: 'term', label: 'Term (until completed / fixed end date)' },
      { key: 'governing_law', label: 'Governing-law state' },
    ],
    skeleton: `INDEPENDENT CONTRACTOR AGREEMENT

This Independent Contractor Agreement (the "Agreement") is entered into on [Effective Date] between [Company name] ("Company") and [Contractor name] ("Contractor").

1. Services. Contractor will perform the following services (the "Services"): [scope]. Contractor will determine the means and methods of performance, subject to Company's reasonable direction as to results.

2. Compensation. Company will pay Contractor [fee structure]. Invoices are due [net X]. Contractor is responsible for all taxes on amounts paid, including self-employment tax.

3. Term and Termination. This Agreement begins on the Effective Date and continues [term]. Either party may terminate on [N] days written notice; Company may terminate immediately for material breach. On termination, Company will pay for Services performed through the termination date.

4. Independent Contractor Status. Contractor is an independent contractor, not an employee. Contractor is not entitled to benefits the Company provides to its employees. Contractor will furnish a W-9; Company will issue a Form 1099 for amounts subject to reporting.

5. IP Ownership. All work product Contractor creates under this Agreement is "work made for hire" under U.S. copyright law. To the extent any work product does not so qualify, Contractor hereby assigns to Company all right, title, and interest in such work product. Contractor will execute such further documents as Company reasonably requests to perfect this assignment.

6. Confidentiality. During and after the engagement, Contractor will hold in confidence all non-public information of Company, will use it only for the Services, and will return or destroy it on termination at Company's request.

7. Warranties. Contractor represents that (a) the Services will be performed in a workmanlike manner, (b) the work product will not infringe any third-party rights, and (c) Contractor has the right to enter into this Agreement.

8. Indemnity. Each party will defend and indemnify the other from third-party claims arising out of the indemnifying party's breach of this Agreement, gross negligence, or willful misconduct, up to the amount of fees paid under this Agreement in the 12 months preceding the claim.

9. Governing Law. This Agreement is governed by the laws of [governing_law] without regard to its conflict-of-laws rules.

10. Entire Agreement. This Agreement is the entire agreement of the parties and supersedes any prior negotiations.

Signed:

____________________
[Company name]
By:
Title:
Date:

____________________
[Contractor name]
Date:`,
  },
  {
    id: 'msa_sow',
    title: 'Master services agreement + SOW shell',
    description:
      'Long-term framework agreement for ongoing professional services, with a separate Statement of Work for each engagement.',
    audience: 'firm',
    requiredInputs: [
      { key: 'client_name', label: 'Client name' },
      { key: 'provider_name', label: 'Provider name' },
      { key: 'services_summary', label: 'High-level services description' },
      { key: 'governing_law', label: 'Governing-law state' },
      { key: 'liability_cap', label: 'Liability cap (eg. fees paid in last 12 months)' },
    ],
    skeleton: `MASTER SERVICES AGREEMENT

This Master Services Agreement (the "MSA") is entered into on [Effective Date] between [Client name] ("Client") and [Provider name] ("Provider").

1. Services. Provider will perform services described in mutually-executed Statements of Work ("SOWs"). Each SOW is a separate contract; if there is any conflict between an SOW and this MSA, the SOW controls for that engagement only.

2. Fees and Payment. Each SOW will state the fees and payment schedule. Invoices are due [net 30]. Late amounts accrue interest at [1.5%] per month or the highest rate permitted by law, whichever is less.

3. Term. This MSA begins on the Effective Date and continues until terminated. Either party may terminate this MSA on [60] days written notice; outstanding SOWs continue under this MSA until completed.

4. Confidentiality. Each party will hold the other's non-public information in confidence, will use it only to perform under this MSA / an SOW, and will protect it with the same care it uses for its own confidential information of similar importance, but no less than reasonable care.

5. IP. Provider grants Client a worldwide, non-exclusive license to use Provider's pre-existing IP solely as embedded in the deliverables. Custom-developed deliverables are owned by [Client / Provider with a license to Client - choose one in the SOW].

6. Warranties. Provider warrants the Services will be performed in a professional and workmanlike manner. Provider DISCLAIMS all other warranties to the maximum extent permitted by law.

7. Limitation of Liability. EXCEPT FOR breach of confidentiality, indemnity obligations, or gross negligence / willful misconduct, neither party will be liable for indirect, incidental, special, consequential, or punitive damages, and each party's total liability under this MSA + an SOW is capped at [liability_cap].

8. Indemnity. Provider will defend Client against third-party claims that the Services as delivered infringe a U.S. patent, copyright, or trade secret, and pay damages awarded against Client. Client will defend Provider against third-party claims arising from Client's use of the Services in violation of this MSA / an SOW or applicable law.

9. Governing Law and Disputes. This MSA is governed by the laws of [governing_law] without regard to conflict-of-laws rules. Disputes will be resolved by binding arbitration in [city, state] under [JAMS / AAA] commercial rules.

10. General. This MSA is the entire agreement of the parties on its subject, may be amended only in a writing signed by both parties, and binds permitted successors and assigns. Notices must be in writing to the addresses on the signature page.

Signed:

____________________
[Client name]                         [Provider name]
By:                                  By:
Title:                                Title:
Date:                                 Date:

EXHIBIT A - STATEMENT OF WORK FORMAT

SOW No. [N]
Effective: [Date]

A. Description of Services: [project narrative]
B. Deliverables: [bulleted list with dates]
C. Schedule: [milestones]
D. Fees: [fixed / time-and-materials / milestone payments]
E. Acceptance Criteria: [how Client confirms each deliverable]
F. Project Personnel: [key staff]
G. Assumptions: [what Client provides, what could change scope]

Each SOW is signed by both parties and incorporated into the MSA.`,
  },
  {
    id: 'settlement_release',
    title: 'Settlement agreement and general release',
    description:
      'Resolves a dispute and releases all claims known and unknown. Includes 1542 waiver where applicable, confidentiality, and a no-admission clause.',
    audience: 'firm',
    requiredInputs: [
      { key: 'releasor', label: 'Releasing party (the one giving up claims)' },
      { key: 'releasee', label: 'Released party (the one being released)' },
      { key: 'dispute', label: 'One-sentence description of the dispute' },
      { key: 'consideration', label: 'Settlement amount or other consideration' },
      { key: 'governing_law', label: 'Governing-law state' },
      { key: 'confidential', label: 'Confidential? (yes/no)' },
    ],
    skeleton: `SETTLEMENT AGREEMENT AND GENERAL RELEASE

This Settlement Agreement and General Release (the "Agreement") is entered into on [Effective Date] between [Releasor] ("Releasor") and [Releasee] ("Releasee") (each a "Party").

RECITALS

A. The Parties are involved in a dispute concerning [one-sentence summary] (the "Dispute").

B. The Parties wish to resolve the Dispute without admission of liability.

NOW THEREFORE, in consideration of the promises below, the Parties agree:

1. Consideration. Releasee will pay Releasor [consideration] within [N] days of execution of this Agreement, in full and final settlement of the Dispute.

2. Release. In exchange for the consideration above, Releasor irrevocably releases Releasee, its affiliates, officers, directors, employees, agents, successors, and assigns from any and all claims, demands, damages, causes of action, debts, and liabilities, known or unknown, suspected or unsuspected, that Releasor has or may have against Releasee arising out of or in any way connected with the Dispute or any act or omission of Releasee on or before the Effective Date.

3. [Section 1542 Waiver, where applicable - California]. Releasor expressly waives the protection of any statute or common-law principle that would otherwise prevent the release of unknown claims. Without limitation, Releasor waives California Civil Code Section 1542, which provides:
"A general release does not extend to claims that the creditor or releasing party does not know or suspect to exist in his or her favor at the time of executing the release and that, if known by him or her, would have materially affected his or her settlement with the debtor or released party."

4. No Admission. This Agreement is a compromise of disputed claims. It is not, and shall not be construed as, an admission of liability by any Party.

5. Confidentiality. [If confidential: The terms and existence of this Agreement are confidential. Neither Party will disclose them except to (a) the Party's professional advisors bound by confidentiality, (b) tax authorities to the extent required, and (c) by court order, on prior written notice to the other Party where legally permitted.]

6. Non-Disparagement. Each Party agrees not to make any disparaging statements about the other concerning the matters covered by this Agreement.

7. Cooperation. Releasor will execute such further documents and take such further actions as are reasonably necessary to give effect to this Agreement (eg. dismissal with prejudice of any pending action).

8. Entire Agreement. This Agreement is the entire agreement of the Parties on its subject and supersedes any prior negotiations.

9. Governing Law. This Agreement is governed by the laws of [governing_law] without regard to its conflict-of-laws rules.

10. Voluntary. Each Party has had the opportunity to consult counsel and signs this Agreement voluntarily, understanding its terms.

Signed:

____________________
[Releasor name]
Date:

____________________
[Releasee name]
By:
Title:
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
