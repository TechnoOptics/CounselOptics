/**
 * Standard templates a firm can install into its own template list with one
 * click, instead of retyping a document it already uses.
 *
 * WHY THIS IS SOURCE AND NOT A DATABASE ROW
 * -----------------------------------------
 * The body below is executable legal text. A row typed into the database by
 * hand has no diff, no review and no test: nobody can see that a clause moved,
 * and nothing fails when a placeholder stops matching its field. Here the text
 * is reviewed like code, and tests/seed-templates.test.ts pins the properties
 * that would otherwise fail silently on a real signing.
 *
 * Installing a standard template COPIES it into firm_templates. The firm then
 * owns its copy and may edit it freely; later edits here never reach a firm
 * that has already installed one. That is deliberate. A document a firm has
 * signed agreements under must not change underneath them because this file
 * was edited.
 *
 * THE PLACEHOLDER CONTRACT, which the tests enforce
 * -------------------------------------------------
 *   - Every `{{key}}` in a body has a declared field, and every declared field
 *     appears in its body. A field with no placeholder renders an input that
 *     changes nothing on the page; a placeholder with no field renders the
 *     literal `{{key}}` on an executed instrument.
 *   - A field marked `party: 'counterparty'` is never merged from the
 *     employee's answers. mergeTemplateDocument replaces it with a ruled blank
 *     carrying a stable marker, which the renderer measures as it draws, so
 *     the other side's typed value has one recorded place to land.
 *   - The body carries no signature rules of its own. mergeTemplateDocument
 *     appends the execution block, and lib/signature-geometry.ts decides where
 *     the mark is stamped. A second place that decides where a signature goes
 *     is exactly the drift that module exists to prevent.
 */

/** A field on a standard template. Mirrors TemplateField in lib/firm-templates.ts. */
export type SeedTemplateField = {
  key: string;
  label: string;
  type: 'text' | 'date' | 'textarea';
  required: boolean;
  /**
   * Who supplies the value. Omitted means the employee, which is the shape
   * every template had before the counterparty flow existed.
   */
  party?: 'employee' | 'counterparty';
};

export type SeedTemplate = {
  /** Stable identifier. Used by the installer and never shown to a user. */
  slug: string;
  name: string;
  description: string;
  category: string;
  /**
   * 'signature' means the approved document is sent to the other side for
   * signature. 'share' means it is delivered as a read-only encrypted link.
   */
  deliveryMode: 'share' | 'signature';
  /** Whether legal reviews the employee's submission before it is sent. */
  requiresApproval: boolean;
  body: string;
  fields: SeedTemplateField[];
  /**
   * Shown beside the template in the installer. Says what a firm must check
   * before using it, in plain words. This is not legal advice and does not
   * claim the document is fit for any particular deal.
   */
  notes: string[];
};

/**
 * Zinpro Corporation's mutual NDA, transcribed from the executed form the
 * legal team supplied.
 *
 * TWO DECISIONS WORTH KNOWING BEFORE EDITING
 * ------------------------------------------
 * 1. "Zinpro Corporation" and the Eden Prairie address are written literally,
 *    NOT as {{firm_name}}. The reserved placeholder resolves to the workspace
 *    the template is installed in, and this workspace is not named Zinpro. A
 *    mutual NDA that names the wrong entity as a party is not a drafting
 *    nit, it is the wrong agreement, so the party names stay literal and a
 *    different firm installing this must edit them.
 * 2. The document's own signature page ends at the identity details. The
 *    ruled "By: ____" lines and the two "Date:" lines from the source are not
 *    reproduced, because mergeTemplateDocument appends exactly one execution
 *    block per party and a second set of rules would give each signer two
 *    places to sign, only one of which is stamped or recorded.
 */
export const ZINPRO_MUTUAL_NDA: SeedTemplate = {
  slug: 'zinpro-mutual-nda',
  name: 'Mutual Nondisclosure Agreement',
  description:
    'Zinpro Corporation mutual NDA. The employee names the Zinpro signatory; the other company supplies its own entity details and signs first.',
  category: 'Nondisclosure',
  deliveryMode: 'signature',
  requiresApproval: true,
  fields: [
    // Filled by the employee who raises the request.
    {
      key: 'zinpro_signatory_name',
      label: 'Zinpro signatory name',
      type: 'text',
      required: true,
      party: 'employee',
    },
    {
      key: 'zinpro_signatory_title',
      label: 'Zinpro signatory title',
      type: 'text',
      required: true,
      party: 'employee',
    },
    {
      key: 'zinpro_signatory_email',
      label: 'Zinpro signatory email',
      type: 'text',
      required: true,
      party: 'employee',
    },
    // Filled by the other company at signing. The employee does not answer
    // for the other side: section 15 makes the email in this block the
    // contractual notice address, and the recitals take the Company's legal
    // name from this block, so a guess here is a defect in the instrument.
    {
      key: 'company_legal_name',
      label: 'Company legal name',
      type: 'text',
      required: true,
      party: 'counterparty',
    },
    {
      key: 'company_signatory_name',
      label: 'Company signatory name',
      type: 'text',
      required: true,
      party: 'counterparty',
    },
    {
      key: 'company_signatory_title',
      label: 'Company signatory title',
      type: 'text',
      required: true,
      party: 'counterparty',
    },
    {
      key: 'company_address',
      label: 'Company address',
      type: 'text',
      required: true,
      party: 'counterparty',
    },
    {
      key: 'company_email',
      label: 'Company email for notices',
      type: 'text',
      required: true,
      party: 'counterparty',
    },
  ],
  notes: [
    'The other company signs first and supplies its own entity name, address and notice email. Those blanks stay ruled until they type them.',
    'Governing law is Minnesota and the term runs five years, with trade secrets protected for as long as they are treated as such.',
    'Section 9 restricts soliciting or hiring the other side\'s people for two years. Check that this is acceptable before sending.',
    'Section 15 sends a courtesy copy of every notice to legal@zinpro.com.',
  ],
  body: `MUTUAL NONDISCLOSURE AGREEMENT

This Mutual Nondisclosure Agreement (the "Agreement") is entered into as of the date of the last signature in the signature blocks below ("Effective Date") by and between Zinpro Corporation and its subsidiaries, a Minnesota business corporation, having a place of business at 7500 Flying Cloud Dr., Suite 800, Eden Prairie, MN 55344-7256 ("Zinpro Corporation"), and the entity named in the signature block executing this Agreement as the Company and its affiliates and subsidiaries (the "Company") (together, the "Parties", and each a "Party").

1. Purpose. Zinpro Corporation and the Company wish to engage in discussions to explore a possible business relationship of mutual interest (the "Discussions") in connection with which either or both of the parties has disclosed and/or may further disclose Confidential Information (as defined below) to the Receiving Party (as defined below). This Agreement is intended to allow the parties to continue the Discussions while protecting the Confidential Information (including Confidential Information previously disclosed) against unauthorized use or disclosure.

2. Definition of Confidential Information. "Confidential Information" means any oral, written, graphic or machine readable information disclosed to one party (the "Receiving Party") by the other party (the "Disclosing Party"), either directly or indirectly or by inspection of tangible objects or facilities, which Confidential Information is designated in writing or orally to be confidential or proprietary, or which information would, under the circumstances, appear to a reasonable person to be confidential or proprietary. "Confidential Information" includes, but is not limited to, any of the Disclosing Party's: (i) formulas, compounds, or compositions for mixing feed ingredients, and its use of equipment or other technology in connection with the preparation of these formulas, compounds or compositions; (ii) manufacturing technology, techniques and methods, processes and shop practices for treating chemicals; (iii) methods of doing business; (iv) customer information such as surveys, customer lists, lists of prospective customers, customer research, customer meetings, customer account records, sales records, training and servicing materials, programs, techniques, sales and contracts, special customer needs, customer credit ratings, and marketing plans, proposals, analyses, strategies, and presentations; (v) customer credit ratings; (vi) potential acquisitions under consideration; (vii) financial data including financial statements and projections, pricing information, costs, sales, budgets and profits; (viii) research information and data; (ix) inventions, designs, discoveries, works of authorship, improvements or ideas, whether or not patentable or copyrightable; (x) the subject matter of the Disclosing Party's patents, design patents, copyrights, Trade Secrets, trademarks, service marks, trade names, trade dress, manuals, operating instructions and other industrial property to the extent that such information is unavailable to the public and/or is in incomplete stages of design or research and development. For this purpose, "Trade Secret" means Confidential Information that Disclosing Party uses in its business and that is the subject of reasonable efforts by Disclosing Party to maintain its secrecy, including without limitation, any formula, pattern, compilation, program, device, method, technique, process, concept, design, or idea, that derives independent economic value, actual or potential, from not being generally known to, and not being readily ascertainable by proper means by, other persons who can obtain economic value from its disclosure or use, and is subject to efforts that are reasonable under the circumstances to maintain its secrecy; (xi) identities of and contact information for employees and consultants and their positions and compensation schedules; (xii) supplier and vendor information including lists and contracts; (xiii) Disclosing Party's manuals and policies, computer programs, software and disks, source code, systems architecture, blue prints, flow charts, and licensing agreements; and (xiv) the existence of the Discussions. Confidential Information may also include confidential information from third parties which is disclosed by the Disclosing Party.

3. Nonuse and Nondisclosure of Confidential Information.

(a) The Receiving Party agrees not to use the Disclosing Party's Confidential Information for its own use or for any purpose other than to carry out the Discussions, and, subject to Section 7, to satisfy its obligations to the Disclosing Party in connection with the relationship, if any, entered into as a result of the Discussions. The Receiving Party shall not disclose or permit disclosure of the Disclosing Party's Confidential Information to third parties without Disclosing Party's prior written consent. The Receiving Party shall only disclose or permit disclosure of the Disclosing Party's Confidential Information to the Receiving Party's, including its affiliates, employees, directors, officers and advisors ("Representatives") who are required to have the information in order to carry out the Discussions or, if applicable, to perform services for the Disclosing Party, and who are subject to a confidentiality and non-use agreement in content similar to the provisions hereof. Each Receiving Party shall be responsible for any breaches of this Agreement by any of its Representatives. The Receiving Party agrees that it shall take all reasonable measures to protect the secrecy of and avoid disclosure or use of the Disclosing Party's Confidential Information in order to prevent it from falling into the public domain or the possession of persons other than those persons authorized under this Agreement to have any such information. Such measures shall include the same degree of care that the Receiving Party utilizes to protect its own confidential information of a similar nature, but no less than reasonable care. The Receiving Party further agrees to notify the Disclosing Party in writing of any actual or suspected misuse, misappropriation or unauthorized disclosure of the Disclosing Party's Confidential Information which may come to the Receiving Party's attention. The Receiving Party agrees not to reverse engineer, disassemble or decompile any prototypes, software or other tangible objects which embody the Disclosing Party's Confidential Information and which are provided to the Receiving Party hereunder, unless otherwise agreed upon in writing.

(b) Exceptions. Notwithstanding the above, the Receiving Party shall not have liability to the Disclosing Party with regard to any Confidential Information which the Receiving Party can prove: (i) was in the public domain prior to the time it was disclosed by the Disclosing Party or has entered the public domain through no fault of the Receiving Party; (ii) was known to the Receiving Party, without restriction, at the time of disclosure, as demonstrated by files in existence at the time of disclosure; (iii) was independently developed by the Receiving Party without the use of or reference to Confidential Information, as shown by documents and other competent evidence in the Receiving Party's possession; (iv) is disclosed with the prior written approval of the Disclosing Party; or (v) becomes known to the Receiving Party, without restriction, from a source other than the Disclosing Party without breach of this Agreement by the Receiving Party and otherwise not in violation of the Disclosing Party's rights.

4. Compelled Disclosure. If the Receiving Party or any of its Representatives is requested or required by law or legal process to disclose any of the Confidential Information, and such Receiving Party or Representative is advised by counsel that it must disclose such Confidential Information, such Receiving Party or Representative shall, to the extent legally permissible, provide the Disclosing Party with prompt oral and written notice so that the Disclosing Party may seek a protective order or other appropriate remedy. The Receiving Party agrees that it will, and will cause its Representatives to, reasonably cooperate with the Disclosing Party in its efforts to obtain such remedies. In the event that such remedies are not promptly obtained, the Receiving Party or its Representatives shall furnish only that portion of the Disclosing Party's Confidential Information that, in the opinion of such person's counsel, is legally required and shall exercise its best efforts to obtain a protective order or other reliable assurance that confidential treatment shall be accorded to the Disclosing Party's Confidential Information.

5. Return of Materials. Whenever requested by the Disclosing Party, the Receiving Party shall (a) immediately return to the Disclosing Party all property including, without limitation, all papers, records, documents, summaries, samples, prototypes and other such materials received by the Receiving Party in connection with the Discussions, whether or not such property contains the Disclosing Party's Confidential Information, and (b) destroy all materials including, without limitation, all papers, records (including electronic records), documents, summaries, samples, prototypes and other such materials which the Receiving Party created based upon the Disclosing Party's Confidential Information. The taking of the actions required by this Section 5 shall be certified in writing to the Disclosing Party by an authorized officer of the Receiving Party who supervised such actions. Notwithstanding the foregoing, the Receiving Party may retain any Confidential Information for compliance purposes as may be required by law or regulation.

6. Backup Files. The parties acknowledge that, notwithstanding a party's diligent efforts to meet the obligations of Section 5, Confidential Information in digital form may remain on the Receiving Party's computer servers and storage devices because removal and deletion may be impracticable (collectively, "Backup Files"). The Receiving Party and its Representatives need not destroy Backup Files made in the ordinary course of business where it would be commercially impracticable to do so, so long as the Receiving Party uses reasonable care when disposing of any storage device that holds Backup Files. Confidential Information contained in Backup Files shall remain confidential and subject to the limitations set forth in this Agreement.

7. No Rights Granted. All Confidential Information is and shall remain the property of the Disclosing Party. Nothing in this Agreement shall be construed as granting any rights under any patent, copyright or other intellectual property right of the Disclosing Party, nor shall this Agreement grant the Receiving Party any rights in or to the Disclosing Party's Confidential Information other than the limited right to review such Confidential Information solely for the purposes of determining whether to enter into the relationship that is the subject of the Discussions and to satisfy its obligations to the Disclosing Party in connection with the relationship, if any, entered into as a result of the Discussions. The Receiving Party understands that nothing in this Agreement (a) requires the disclosure of any Confidential Information, which shall be disclosed, if at all, solely at the Disclosing Party's option, or (b) requires the Disclosing Party to proceed with the relationship that is the subject of the Discussions or any transaction in connection with which the Confidential Information may be disclosed.

8. No Warranty. All Confidential Information disclosed hereunder is disclosed on an "AS IS" basis with no warranties, express or implied, of any kind. Each party agrees (on behalf of itself and its Representatives) that the other party and its Representatives shall not have any liability relating to or resulting from the use of the Confidential Information, or any error therein or omission therefrom, except in accordance with representations or warranties contained in definitive documentation executed and delivered by the parties as a result of the Discussions.

9. Non-solicitation. Each party agrees that for a period of two (2) years from the date of this Agreement, neither party nor any of its representatives, will, directly or indirectly, solicit for employment or hire any employee or enter into any consulting arrangement with, any independent contractor of the other party or any of its subsidiaries with whom such party has had contact or who became known to such party in connection with the Discussions; provided that the foregoing provision will not prevent such party from employing or engaging any such person who either (a) contacts such party on his or her own initiative without any direct solicitation by, or encouragement (not including a general solicitation of employment not specifically directed towards employees or independent contractors of the Company) from, the other party or (b) terminated their employment or engagement with the other party prior to any such solicitation. In addition, any solicitation or hiring or engaging of any employees or independent contractors of either party by the other party's personnel or agents who perform the solicitation or hiring or engaging and who have not had access or knowledge of the Discussions or the obligations under this Agreement shall not be deemed a breach of this provision.

10. Term. The foregoing commitments of each party shall survive any termination of the Discussions between the parties, and shall continue until the five (5) year anniversary of the date first written above; provided, however, that all obligations with respect to Confidential Information that are treated by the Disclosing Party as trade secrets will continue for so long as Disclosing Party treats the Confidential Information as confidential and proprietary. To the extent that the parties enter into the relationship that is the subject of the Discussions, unless this Agreement is terminated or superseded by agreement of the parties, any and all confidentiality and nondisclosure obligations contained in agreements entered into by the parties in connection with such relationship shall be read together with the obligations contained in this Agreement so that the terms and conditions that are most protective of the Disclosing Party's Confidential Information bind the Receiving Party.

11. Successors and Assigns. Neither party may assign any of its rights or delegate any of its obligations hereunder without the prior written consent of the other Party. This Agreement shall inure to the benefit of and be binding upon the respective successors and permitted assigns of the parties. Nothing in this Agreement, express or implied, is intended to confer upon any party other than the parties hereto or their respective successors and permitted assigns any rights, remedies, obligations, or liabilities under or by reason of this Agreement, except as expressly provided in this Agreement.

12. Severability. If one or more provisions of this Agreement are held to be unenforceable under applicable law, the parties agree to renegotiate such provisions in good faith. In the event that the parties cannot reach a mutually agreeable and enforceable replacement for such provision, then (a) such provision shall be excluded from this Agreement, (b) the balance of this Agreement shall be interpreted as if such provision were so excluded and (c) the balance of this Agreement shall be enforceable in accordance with its terms.

13. Independent Contractors. The parties are independent contractors, and nothing contained in this Agreement shall be construed to constitute the parties as partners, joint ventures, co-owners or otherwise as participants in a joint or common undertaking.

14. Governing Law; Jurisdiction. This Agreement and all acts and transactions pursuant hereto and the rights and obligations of the parties hereto shall be governed, construed and interpreted in accordance with the laws of the State of Minnesota, without giving effect to principles of conflicts of law.

15. Notice and other communications provided for herein shall be in writing and shall be sent by email as noted in the signature blocks for each Party with a courtesy copy to legal@zinpro.com for Zinpro.

16. Remedies. The parties each agree that the obligations set forth in this Agreement are necessary and reasonable in order to protect each party and its business. The parties each expressly agree that due to the unique nature of each party's Confidential Information, monetary damages would be inadequate to compensate the Disclosing Party for any breach by the Receiving Party of its covenants and agreements set forth in this Agreement. Accordingly, the parties each agree and acknowledge that any such violation or threatened violation shall cause irreparable injury to the Disclosing Party and that, in addition to any other remedies that may be available, in law, in equity or otherwise, the Disclosing Party shall be entitled to obtain injunctive relief against the threatened breach of this Agreement or the continuation of any such breach by the Receiving Party, without the necessity of proving actual damages. Each party further agrees that, in the event that Disclosing Party is successful in obtaining injunctive relief against the Receiving Party, the Receiving Party shall reimburse the Disclosing Party for all reasonable costs and expenses, including attorney's fees, incurred by Discloser in seeking injunctive relief against the Receiving Party.

17. No Other Obligation. The parties agree that neither party shall be under any legal obligation of any kind whatsoever, or otherwise be obligated to enter into any business or contractual relationship, investment, or transaction, by virtue of this Agreement, except for the matters specifically agreed to herein. Either party may at any time, at its sole discretion with or without cause, terminate discussions and negotiations with the other party, in connection with the Discussions or otherwise.

18. Amendment and Waiver. This Agreement may not be amended without the written consent of each party. Any amendment or waiver affected in accordance with this Section shall be binding upon the parties and their respective successors and assigns. Failure to enforce any provision of this Agreement by a party shall not constitute a waiver of any term hereof by such party.

19. Entire Agreement. This Agreement is the product of both of the parties hereto, and constitutes the entire agreement between such parties pertaining to the subject matter hereof, and merges all prior negotiations and drafts of the parties with regard to the transactions contemplated herein. Any and all other written or oral agreements existing between the parties hereto regarding such transactions are expressly canceled.

20. Counterparts. This Agreement may be executed in two or more counterparts, each of which shall be deemed an original and all of which together shall constitute one instrument. Signing of this Agreement and transmission by electronic transmission will be acceptable and binding on the parties.

The parties have executed this Mutual Nondisclosure Agreement as of the date first above written.

THE COMPANY

Entity: {{company_legal_name}}
Name: {{company_signatory_name}}
Title: {{company_signatory_title}}
Address: {{company_address}}
Email: {{company_email}}

ZINPRO CORPORATION

Name: {{zinpro_signatory_name}}
Title: {{zinpro_signatory_title}}
Address: 7500 Flying Cloud Dr., Suite 800, Eden Prairie, MN 55344
Email: {{zinpro_signatory_email}}`,
};

/** Every standard template, in the order the installer lists them. */
export const SEED_TEMPLATES: readonly SeedTemplate[] = [ZINPRO_MUTUAL_NDA];

/** Look one up by slug. Returns null rather than throwing: the slug arrives from a request. */
export function findSeedTemplate(slug: unknown): SeedTemplate | null {
  if (typeof slug !== 'string') return null;
  return SEED_TEMPLATES.find((t) => t.slug === slug) ?? null;
}

/**
 * Every `{{key}}` in a body, in the order they appear, deduplicated.
 *
 * The pattern accepts exactly what sanitizeFields in lib/firm-templates.ts can
 * produce ([a-z0-9_], 40 characters), so a brace pair holding anything else is
 * not a placeholder and is not reported as a mismatch.
 */
export function placeholdersIn(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{([a-z0-9_]{1,40})\}\}/g;
  let m = re.exec(body);
  while (m) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
    m = re.exec(body);
  }
  return out;
}
