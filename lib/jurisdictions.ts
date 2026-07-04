/**
 * Curated directory of court e-filing portals for the federal system and
 * every U.S. state + D.C. + territories. Use this to point pro-se users
 * at the right place to file exhibits.
 *
 * IMPORTANT: court rules drift. The links below are the top-level entry
 * points (court home pages or e-filing landing pages), which are the
 * stable URLs - the deeper "filing instructions" pages get renamed
 * frequently. Anything stamped to a date (filing fees, waiver forms)
 * needs to be re-verified against the court's site before relying on it.
 *
 * For each jurisdiction we capture:
 *   - main e-filing entry point (URL)
 *   - whether pro-se litigants can file electronically (varies by state)
 *   - typical accepted formats / size limits
 *   - service-of-process expectations
 *   - any jurisdiction-specific notes worth surfacing
 *
 * Editing guidance: keep `summary` to 1-2 short sentences. Put deeper
 * detail in `notes`. Anything that requires a court login / payment
 * should be flagged so we never imply free filing is universal.
 */

export type FilingProvider =
  | 'tyler-odyssey' // Tyler Technologies (most populous deployment - File & Serve, Odyssey, Re:SearchTX)
  | 'court-native'  // Court built/owns the portal (e.g. NYSCEF, MyCase Indiana)
  | 'pacer-cmecf'   // Federal CM/ECF + PACER
  | 'efilenj'       // NJ-specific eCourts
  | 'turbocourt'    // TurboCourt (CA forms in some counties)
  | 'efile-illinois'
  | 'mixed'         // Multiple vendors across counties (common in CA, TX, MO)
  | 'paper-only';   // Pro se still files on paper (a handful of jurisdictions)

export type Jurisdiction = {
  /** Two-letter postal code; "FED" for federal, "DC", "PR", "VI", "GU" etc. */
  code: string;
  /** Display name. */
  name: string;
  /** Court system label (e.g. "California Superior Court", "U.S. District Courts"). */
  courtName: string;
  /** Top-level e-filing portal URL. Always the stable landing page. */
  portalUrl: string;
  /** Optional secondary URL: pro-se help center, self-help center, etc. */
  selfHelpUrl?: string;
  /** Filing technology backing the portal. */
  provider: FilingProvider;
  /** Whether unrepresented (pro se) litigants can file through the portal. */
  proSeAllowed: 'yes' | 'limited' | 'no' | 'paper-fallback';
  /** Accepted file formats - "PDF/A" + size limit + redaction expectations. */
  formats: string;
  /** How service of filed documents works in that system. */
  service: string;
  /** Filing-fee waiver pointer (form name + URL if we have one). */
  feeWaiver?: { label: string; url?: string };
  /** 1-2 sentence summary suitable for the page list. */
  summary: string;
  /** Multi-line richer guidance, surfaced when the user expands the row. */
  notes: string[];
};

export const JURISDICTIONS: Jurisdiction[] = [
  // -------------------------------------------------------------------
  // Federal
  // -------------------------------------------------------------------
  {
    code: 'FED',
    name: 'Federal courts (U.S. District + Bankruptcy + Appellate)',
    courtName: 'United States Courts',
    portalUrl: 'https://pacer.uscourts.gov/',
    selfHelpUrl: 'https://www.uscourts.gov/about-federal-courts/types-cases',
    provider: 'pacer-cmecf',
    proSeAllowed: 'limited',
    formats:
      'Text-searchable PDF, generally 35 MB per document (some districts allow up to 50 MB). Each judge may set additional formatting in chambers rules.',
    service:
      'CM/ECF auto-serves registered counsel via NEF (Notice of Electronic Filing). Pro se filers usually still must serve unrepresented parties by mail or personal service unless the court grants e-service.',
    feeWaiver: {
      label: 'AO 239 - Application to Proceed In Forma Pauperis',
      url: 'https://www.uscourts.gov/forms/fee-waiver-application-forms/application-proceed-district-court-without-prepaying-fees-or',
    },
    summary:
      'Federal courts use CM/ECF for filing and PACER for viewing. Many districts now let pro se litigants register for filing accounts; check your district court site.',
    notes: [
      'PACER is for VIEWING dockets and documents (per-page fee, with quarterly fee caps).',
      'CM/ECF is for FILING; access varies by district court. Most districts require a brief pro se e-filing registration, sometimes with judge approval.',
      'Bankruptcy courts use a parallel CM/ECF deployment and have their own local rules.',
      'Sealing, redaction, and chambers copies are governed by the local rules of each district. Read your judges chambers rules before filing.',
      'For appeals (Circuit Courts), use the same CM/ECF system at the circuit-court level (e.g., ca9.uscourts.gov for Ninth Circuit).',
    ],
  },

  // -------------------------------------------------------------------
  // States (alphabetical)
  // -------------------------------------------------------------------
  {
    code: 'AL',
    name: 'Alabama',
    courtName: 'Alabama Unified Judicial System',
    portalUrl: 'https://efile.alacourt.gov/',
    selfHelpUrl: 'https://judicial.alabama.gov/library/Forms',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF, generally under 15 MB per document.',
    service:
      'AlaFile sends an email confirmation; opposing counsel registered with AlaFile is served automatically. Self-represented parties served by mail.',
    summary:
      'Alabama uses AlaFile (alacourt.gov) statewide. Pro se filing is allowed in many counties but you may need to register and pay convenience fees.',
    notes: [
      'AlaFile is required for attorneys; pro se is permitted in most counties but the local circuit clerk can still require paper.',
      'Walk-in filing at the circuit clerk is the fallback if you cannot get an AlaFile account.',
    ],
  },
  {
    code: 'AK',
    name: 'Alaska',
    courtName: 'Alaska Court System',
    portalUrl: 'https://courts.alaska.gov/efile/index.htm',
    selfHelpUrl: 'https://courts.alaska.gov/shc/',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; max ~25 MB per document via TrueFiling.',
    service:
      'TrueFiling sends e-service to opposing counsel. Pro se opponents must usually be served by mail.',
    summary:
      'Alaska uses TrueFiling for trial-court e-filing. Pro se filing is permitted, with paper fallback at any clerks office.',
    notes: [
      'The Alaska Self-Help Center has guided forms for family, civil, small claims, and trust matters.',
      'Some specialty cases (e.g. CINA, mental commitments) still require paper.',
    ],
  },
  {
    code: 'AZ',
    name: 'Arizona',
    courtName: 'Arizona Supreme Court / Superior Courts',
    portalUrl: 'https://www.azcourts.gov/efilinginformation',
    selfHelpUrl: 'https://www.azcourts.gov/selfservicecenter',
    provider: 'mixed',
    proSeAllowed: 'limited',
    formats: 'PDF; size limits vary by county system (commonly 10-25 MB).',
    service:
      'AZTurboCourt or eAccess (varies by county) sends a Notice of Electronic Filing to registered users.',
    summary:
      'Arizona uses AZTurboCourt for forms and several county-specific portals (e.g. eAccess in Maricopa). Pro se filing depends on the county.',
    notes: [
      'Maricopa County (Phoenix) uses eAccess; Pima County (Tucson) uses AZTurboCourt.',
      'Arizona Self-Service Center has fillable forms for divorce, guardianship, eviction, and small claims.',
    ],
  },
  {
    code: 'AR',
    name: 'Arkansas',
    courtName: 'Arkansas Judiciary',
    portalUrl: 'https://efile.arcourts.gov/',
    selfHelpUrl: 'https://arcourts.gov/forms-and-publications',
    provider: 'tyler-odyssey',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB cap per document on eFlex.',
    service: 'eFlex serves registered users automatically; others must be served by mail.',
    summary:
      'Arkansas uses Tyler eFlex. Pro se filing is allowed for many case types; some counties still prefer paper for family matters.',
    notes: [
      'Arkansas Court Help (arcourts.gov) has form packets for divorce, name change, and protective orders.',
    ],
  },
  {
    code: 'CA',
    name: 'California',
    courtName: 'California Superior Courts (county-by-county)',
    portalUrl: 'https://selfhelp.courts.ca.gov/jcc-form/FW-001',
    selfHelpUrl: 'https://selfhelp.courts.ca.gov/',
    provider: 'mixed',
    proSeAllowed: 'limited',
    formats: 'PDF/A preferred; max varies (commonly 25 MB) by county vendor.',
    service:
      'Each county vendor (One Legal, File & ServeXpress, Odyssey, GreenFiling) handles e-service to registered users; CRC 2.251 governs pro se e-service consent.',
    feeWaiver: {
      label: 'Form FW-001 - Request to Waive Court Fees',
      url: 'https://selfhelp.courts.ca.gov/jcc-form/FW-001',
    },
    summary:
      'California is county-by-county - 58 superior courts with several different e-filing vendors. Start at courts.ca.gov to find your county portal.',
    notes: [
      'Mandatory e-filing in many counties for represented parties; pro se litigants may opt in.',
      'Each county has its own local rules on caption format, exhibit numbering, and judges courtesy copies.',
      'Self-Help (selfhelp.courts.ca.gov) hosts statewide JC forms for family, civil, eviction, and probate matters - free PDFs.',
    ],
  },
  {
    code: 'CO',
    name: 'Colorado',
    courtName: 'Colorado Judicial Branch',
    portalUrl: 'https://www.jbits.courts.state.co.us/efiling/web/login.htm',
    selfHelpUrl: 'https://www.coloradojudicial.gov/self-help-resources',
    provider: 'court-native',
    proSeAllowed: 'yes',
    formats: 'PDF; CCEF accepts up to 35 MB per document.',
    service:
      'Colorado Courts E-Filing (CCEF) serves registered users; pro se counterparties without accounts must be served by mail or personal service.',
    summary:
      'Colorado uses Colorado Courts E-Filing (CCEF) statewide. Pro se filing is fully supported.',
    notes: [
      'Self-Represented Litigant (SRL) forms (JDF series) cover divorce, custody, evictions, name change, probate, civil.',
    ],
  },
  {
    code: 'CT',
    name: 'Connecticut',
    courtName: 'Connecticut Judicial Branch',
    portalUrl: 'https://www.jud.ct.gov/external/super/E-Services/efile/default.htm',
    selfHelpUrl: 'https://www.jud.ct.gov/selfhelp.htm',
    provider: 'court-native',
    proSeAllowed: 'yes',
    formats: 'PDF; 80 MB cap per document.',
    service:
      'E-Services notice; most pro se exclusions apply (still file paper). Self-represented parties should request e-services access.',
    summary:
      'Connecticut Judicial Branch e-filing is mandatory for attorneys; pro se can request e-services access, otherwise paper at the clerks office.',
    notes: [
      'Pro Se electronic filing requires a separate request and approval; paper is the default for self-represented parties.',
    ],
  },
  {
    code: 'DE',
    name: 'Delaware',
    courtName: 'Delaware Courts',
    portalUrl: 'https://courts.delaware.gov/efiling/',
    selfHelpUrl: 'https://courts.delaware.gov/help/',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; File & ServeXpress and CourtLink each accept up to 25 MB.',
    service: 'File & ServeXpress / Lexis CourtLink auto-serve registered counsel.',
    summary:
      'Delaware courts use File & ServeXpress (Chancery, Superior, Supreme) and CourtLink (Court of Common Pleas, Justice of the Peace). Pro se can register but most file paper.',
    notes: [
      'Court of Chancery and Superior Court have mandatory e-filing for represented parties; pro se can ask the court to e-file.',
    ],
  },
  {
    code: 'FL',
    name: 'Florida',
    courtName: 'Florida State Courts',
    portalUrl: 'https://www.myflcourtaccess.com/',
    selfHelpUrl: 'https://help.flcourts.gov/',
    provider: 'court-native',
    proSeAllowed: 'yes',
    formats:
      'PDF/A strongly preferred; 25 MB per document, 50 MB per submission via the ePortal.',
    service:
      'eService through the Florida Courts E-Filing Portal serves all designated email addresses on the case.',
    feeWaiver: {
      label: 'Application for Determination of Civil Indigent Status',
      url: 'https://help.flcourts.gov/Get-Started/Application-for-Determination-of-Civil-Indigent-Status',
    },
    summary:
      'Florida uses the statewide ePortal (myflcourtaccess.com). Pro se filing is fully supported and free of convenience fees.',
    notes: [
      'Florida Courts Help (help.flcourts.gov) has approved family-law forms and step-by-step instructions.',
      'Sealed / confidential filings use the "Confidential Information Form" - read AOSC under Rule 2.420 before filing exhibits with PII.',
    ],
  },
  {
    code: 'GA',
    name: 'Georgia',
    courtName: 'Georgia Judicial Council',
    portalUrl: 'https://georgiacourts.gov/efile-court-records/',
    selfHelpUrl: 'https://www.georgialegalaid.org/',
    provider: 'tyler-odyssey',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB cap per document on PeachCourt / Tyler.',
    service: 'PeachCourt / Tyler eFile sends NEF; service is electronic for registered users.',
    summary:
      'Most Georgia superior courts use PeachCourt (Tyler). Pro se filing is supported in most counties; some still require paper.',
    notes: [
      'Civil case e-filing is mandatory in superior courts under O.C.G.A. 15-6-77.4. Pro se litigants are not required but may opt in.',
    ],
  },
  {
    code: 'HI',
    name: 'Hawaii',
    courtName: 'Hawaii State Judiciary',
    portalUrl: 'https://www.courts.state.hi.us/legal_references/efiling',
    selfHelpUrl: 'https://www.courts.state.hi.us/self-help',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 30 MB per document via JEFS / JIMS.',
    service: 'Judiciary Electronic Filing System (JEFS) serves registered participants.',
    summary:
      'Hawaii uses JEFS for circuit court filings. Pro se can file electronically on consent or paper at the clerks office.',
    notes: [
      'Self-help forms cover divorce, paternity, name change, traffic, and small claims.',
    ],
  },
  {
    code: 'ID',
    name: 'Idaho',
    courtName: 'Idaho Supreme Court',
    portalUrl: 'https://idaho.tylertech.cloud/OfsEfsp/ui/landing',
    selfHelpUrl: 'https://courtselfhelp.idaho.gov/',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 35 MB per document on iCourt File & Serve.',
    service: 'iCourt File & Serve sends NEF; electronic service to registered users.',
    summary:
      'Idaho uses iCourt File & Serve (Tyler). Pro se filing is fully supported statewide.',
    notes: [
      'iCourt Self-Help has guided interview-based forms for family, eviction, name change, and small claims.',
    ],
  },
  {
    code: 'IL',
    name: 'Illinois',
    courtName: 'Illinois Courts',
    portalUrl: 'https://efile.illinoiscourts.gov/',
    selfHelpUrl: 'https://www.illinoislegalaid.org/',
    provider: 'efile-illinois',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document, 50 MB per submission via eFileIL.',
    service:
      'eFileIL (Tyler) sends NEF to registered participants. Pro se litigants without accounts must be served by mail.',
    feeWaiver: {
      label: 'Application for Waiver of Court Fees',
      url: 'https://www.illinoiscourts.gov/Resources/2c33fd5b-2cad-4b06-aef7-f0c54b50abd3/IL_AOC_FW1.pdf',
    },
    summary:
      'Illinois mandates e-filing through eFileIL (Tyler). Pro se filing is supported and free if you choose the no-fee Electronic Filing Service Provider (EFSP).',
    notes: [
      'Free EFSPs include Odyssey eFileIL (the official, no-fee option). Paid EFSPs add convenience fees.',
      'Illinois Legal Aid Online has guided interviews and downloadable forms in English and Spanish.',
    ],
  },
  {
    code: 'IN',
    name: 'Indiana',
    courtName: 'Indiana Courts',
    portalUrl: 'https://courts.in.gov/efiling/',
    selfHelpUrl: 'https://courts.in.gov/help/',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document on the Indiana E-Filing System (IEFS).',
    service: 'IEFS sends NEF; e-service to registered users.',
    summary:
      'Indiana mandates e-filing through IEFS (Tyler). Pro se filing is supported statewide.',
    notes: [
      'MyCase (mycase.in.gov) is the public docket viewer.',
      'Self-Help has Trial Rule 87 form packets for protective orders, name change, and small claims.',
    ],
  },
  {
    code: 'IA',
    name: 'Iowa',
    courtName: 'Iowa Judicial Branch',
    portalUrl: 'https://www.iowacourts.gov/efile',
    selfHelpUrl: 'https://www.iowacourts.gov/for-the-public/representing-yourself/',
    provider: 'court-native',
    proSeAllowed: 'yes',
    formats: 'PDF; 50 MB per document on EDMS.',
    service: 'EDMS sends NEF to registered counsel and pro se filers.',
    summary:
      'Iowa uses EDMS for statewide e-filing. Pro se filing is fully supported.',
    notes: [
      'Self-help packets cover small claims, dissolution, custody, and tenant-landlord disputes.',
    ],
  },
  {
    code: 'KS',
    name: 'Kansas',
    courtName: 'Kansas Judicial Branch',
    portalUrl: 'https://kscourts.gov/eCourt/Kansas-Courts-eFiling',
    selfHelpUrl: 'https://self-help.kscourts.gov/',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 35 MB per document on the District Court e-filing system.',
    service: 'NEF via the e-filing system. Service on non-participants by mail.',
    summary:
      'Kansas uses the statewide District Court e-filing system (Tyler). Pro se filing is supported.',
    notes: [
      'Local rules differ on courtesy copies for judges; check your district before filing exhibits.',
    ],
  },
  {
    code: 'KY',
    name: 'Kentucky',
    courtName: 'Kentucky Court of Justice',
    portalUrl: 'https://www.kycourts.gov/AOC/Information-and-Technology/Pages/File_Serve(eFiling).aspx',
    selfHelpUrl: 'https://www.kycourts.gov/Legal-Forms/Pages/default.aspx',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document on KYeCourts.',
    service: 'KYeCourts sends NEF to registered counsel; pro se opponents served by mail.',
    summary:
      'Kentucky e-filing (KYeCourts) is mandatory for attorneys statewide. Pro se filing is allowed but most still file paper.',
    notes: [
      'AOC forms cover protective orders, eviction, small claims, and dissolution.',
    ],
  },
  {
    code: 'LA',
    name: 'Louisiana',
    courtName: 'Louisiana District + Appellate Courts',
    portalUrl: 'https://www.lasc.org/index.php?fuseaction=Page.View&page=public-records',
    selfHelpUrl: 'https://www.lacourt.org/laselfhelp/UI/index.aspx?model=1',
    provider: 'mixed',
    proSeAllowed: 'limited',
    formats: 'PDF; vendor-dependent (commonly 25 MB).',
    service: 'Vendor-specific NEF; many parishes still require paper service.',
    summary:
      'Louisiana e-filing is parish-by-parish (Orleans, East Baton Rouge, Caddo each have their own portals). Most pro se filings still go to paper at the clerks office.',
    notes: [
      'Civil District Court (Orleans) has its own e-filing system; check the parish clerks website.',
      'Lousiana State Bar Association maintains a self-help legal library.',
    ],
  },
  {
    code: 'ME',
    name: 'Maine',
    courtName: 'Maine Judicial Branch',
    portalUrl: 'https://www.courts.maine.gov/ecourts/efile.html',
    selfHelpUrl: 'https://www.courts.maine.gov/help/index.html',
    provider: 'tyler-odyssey',
    proSeAllowed: 'limited',
    formats: 'PDF; 35 MB per document on Tyler.',
    service: 'NEF via Tyler; pro se opponents served by mail.',
    summary:
      'Maine is rolling out Tyler e-filing county by county. Until your county is on the system, file paper at the clerks office.',
    notes: [
      'Self-Help Center has form packets for divorce, parental rights, and small claims.',
    ],
  },
  {
    code: 'MD',
    name: 'Maryland',
    courtName: 'Maryland Judiciary',
    portalUrl: 'https://mdcourts.gov/mdec/about',
    selfHelpUrl: 'https://www.peoples-law.org/',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF/A required; 35 MB per document, 50 MB per submission on MDEC.',
    service: 'MDEC service applies to filer-served users; pro se opponents served by mail.',
    feeWaiver: {
      label: 'Form CC-DC-085 - Request for Waiver of Prepayment',
      url: 'https://www.mdcourts.gov/legalhelp/filingfeewaivers',
    },
    summary:
      'Maryland uses MDEC (Tyler) for e-filing in all but Baltimore City, which has been migrating in. Pro se filing is supported.',
    notes: [
      'Peoples-Law.org is the Maryland Legal Aid public-facing self-help library.',
      'PDF/A is mandatory and the system rejects standard PDFs in many case types.',
    ],
  },
  {
    code: 'MA',
    name: 'Massachusetts',
    courtName: 'Massachusetts Trial Court',
    portalUrl: 'https://www.mass.gov/info-details/electronic-filing-e-filing',
    selfHelpUrl: 'https://www.mass.gov/courts/court-info/courthouses/court-service-centers',
    provider: 'tyler-odyssey',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document.',
    service: 'NEF via Tyler; pro se opponents served by mail or personal service.',
    summary:
      'Massachusetts e-filing is rolling out by department (Land Court, Probate & Family, Housing, District). Pro se filing is allowed where the system is live.',
    notes: [
      'Court Service Centers (free, walk-in) help unrepresented parties prep filings.',
      'MassLegalHelp has self-guided form packets.',
    ],
  },
  {
    code: 'MI',
    name: 'Michigan',
    courtName: 'Michigan State Courts',
    portalUrl: 'https://www.courts.michigan.gov/mifile-systems/',
    selfHelpUrl: 'https://michiganlegalhelp.org/',
    provider: 'court-native',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document via MiFILE.',
    service: 'MiFILE sends NEF to registered users.',
    summary:
      'Michigan is rolling out MiFILE (TrueFiling) statewide. Pro se filing is supported in MiFILE counties.',
    notes: [
      'Michigan Legal Help (michiganlegalhelp.org) is the SCAO self-help library with guided interview-based form packets.',
    ],
  },
  {
    code: 'MN',
    name: 'Minnesota',
    courtName: 'Minnesota Judicial Branch',
    portalUrl: 'https://www.mncourts.gov/Help-Topics/eFile-and-eServe.aspx',
    selfHelpUrl: 'https://www.mncourts.gov/Help-Topics/Self-Help-Center.aspx',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF/A preferred; 25 MB per document, 50 MB per submission via eFile and eServe.',
    service: 'eFile and eServe sends NEF; pro se opponents must be served by mail unless they consent.',
    feeWaiver: {
      label: 'In Forma Pauperis (IFP) Application',
      url: 'https://www.mncourts.gov/GetForms.aspx?c=15',
    },
    summary:
      'Minnesota uses eFile and eServe (Tyler) statewide. Pro se filing is mandatory in most case types; paper is allowed only with court permission.',
    notes: [
      'Pro se must register at "File-Self" rather than "File-Attorney"; the form set differs.',
      'Self-Help Center has guided interviews for divorce, custody, harassment restraining orders, conciliation court, and name change.',
    ],
  },
  {
    code: 'MS',
    name: 'Mississippi',
    courtName: 'Mississippi Electronic Courts',
    portalUrl: 'https://courts.ms.gov/mec/mec.php',
    selfHelpUrl: 'https://courts.ms.gov/research/research.php',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 35 MB per document via MEC (modeled on federal CM/ECF).',
    service: 'MEC sends NEF; counsel registered with MEC are served electronically.',
    summary:
      'Mississippi runs its own MEC system (built on CM/ECF). Pro se accounts require court approval; otherwise paper at the clerks office.',
    notes: [
      'Chancery, Circuit, and County courts are on MEC; Justice and Municipal courts file paper.',
    ],
  },
  {
    code: 'MO',
    name: 'Missouri',
    courtName: 'Missouri Judiciary',
    portalUrl: 'https://www.courts.mo.gov/page.jsp?id=518',
    selfHelpUrl: 'https://www.courts.mo.gov/page.jsp?id=4225',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 4 MB per document, 8 MB per submission via Case.net eFiling.',
    service: 'Case.net sends NEF; service on non-participants by mail.',
    summary:
      'Missouri e-files through Case.net. Pro se litigants without an attorney generally file paper unless granted Case.net access.',
    notes: [
      'The 4 MB cap is unusually small - large exhibits must be split.',
      'Case.net is also the public docket viewer.',
    ],
  },
  {
    code: 'MT',
    name: 'Montana',
    courtName: 'Montana Judicial Branch',
    portalUrl: 'https://courts.mt.gov/courts/efile/',
    selfHelpUrl: 'https://courts.mt.gov/selfhelp',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document on Tyler.',
    service: 'Tyler NEF; pro se opponents served by mail.',
    summary:
      'Montana uses Tyler e-filing across district and supreme courts. Pro se filing is supported.',
    notes: [
      'Self-Help Law Program has divorce, parenting, name change, and protective-order packets.',
    ],
  },
  {
    code: 'NE',
    name: 'Nebraska',
    courtName: 'Nebraska Judicial Branch',
    portalUrl: 'https://nebraskajudicial.gov/e-services/efiling',
    selfHelpUrl: 'https://nebraskajudicial.gov/self-help/general-court-forms',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 35 MB per document.',
    service: 'NEF via JUSTICE; service on non-participants by mail.',
    summary:
      'Nebraska e-files through the JUSTICE system. Pro se filing requires an account request; otherwise paper.',
    notes: [
      'Self-Help has SC forms for protective orders, name change, eviction, and small claims.',
    ],
  },
  {
    code: 'NV',
    name: 'Nevada',
    courtName: 'Nevada Courts',
    portalUrl: 'https://nvcourts.gov/supreme/how_do_i/file_a_document',
    selfHelpUrl: 'https://www.civillawselfhelpcenter.org/',
    provider: 'mixed',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document; vendor varies (Odyssey, File & ServeXpress).',
    service: 'NEF via vendor; service on non-participants by mail.',
    summary:
      'Nevada e-filing is county-by-county. Clark County (Las Vegas) uses File & ServeXpress; Washoe (Reno) uses Odyssey. Pro se filing is supported in both.',
    notes: [
      'Civil Law Self-Help Center (Clark County) is one of the strongest pro-se resource centers in the country.',
    ],
  },
  {
    code: 'NH',
    name: 'New Hampshire',
    courtName: 'New Hampshire Judicial Branch',
    portalUrl: 'https://www.courts.nh.gov/our-courts/circuit-court/efile',
    selfHelpUrl: 'https://www.courts.nh.gov/self-help-information',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document on Tyler.',
    service: 'Tyler NEF; pro se opponents served by mail.',
    summary:
      'New Hampshire uses Tyler e-filing for circuit and superior courts. Pro se filing is supported.',
    notes: ['NH Court Help has form packets for family, civil, and small claims matters.'],
  },
  {
    code: 'NJ',
    name: 'New Jersey',
    courtName: 'New Jersey Courts',
    portalUrl: 'https://www.njcourts.gov/attorneys/ecourts-and-efiling',
    selfHelpUrl: 'https://www.njcourts.gov/self-help',
    provider: 'efilenj',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document on eCourts.',
    service: 'eCourts sends NEF; non-registered parties served by mail.',
    summary:
      'New Jersey uses its own eCourts platform. Most case types are mandatory e-file for attorneys; pro se can request access or file paper.',
    notes: [
      'eCourts Jury and JEDS (Judiciary Electronic Document Submission) are different paths - JEDS is for one-off pro se submissions.',
    ],
  },
  {
    code: 'NM',
    name: 'New Mexico',
    courtName: 'New Mexico Courts',
    portalUrl: 'https://www.nmcourts.gov/electronic-filing/',
    selfHelpUrl: 'https://selfrepresentation.nmcourts.gov/',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document on Tyler File & Serve.',
    service: 'NEF via Tyler.',
    summary:
      'New Mexico uses Tyler File & Serve statewide. Pro se filing is supported.',
    notes: [
      'Self-Help Guides cover family, eviction, name change, and small claims.',
    ],
  },
  {
    code: 'NY',
    name: 'New York',
    courtName: 'New York State Courts',
    portalUrl: 'https://iapps.courts.state.ny.us/nyscef/HomePage',
    selfHelpUrl: 'https://www.nycourts.gov/courthelp/',
    provider: 'court-native',
    proSeAllowed: 'yes',
    formats: 'PDF; 100 MB per document on NYSCEF (one of the larger limits nationally).',
    service: 'NYSCEF sends NEF to all consenting users; non-consenting parties served by mail.',
    feeWaiver: {
      label: 'Poor Person (CPLR 1101) Application',
      url: 'https://www.nycourts.gov/courthelp/GoingToCourt/poorPerson.shtml',
    },
    summary:
      'New York runs its own NYSCEF system. Most case types are mandatory e-file in NYC; consensual e-file in many upstate counties. Pro se can register.',
    notes: [
      'NYSCEFs 100 MB cap is generous - usually no need to split exhibits.',
      'CourtHelp (DIY Forms) has interview-based packets for divorce, family, eviction, and small claims.',
    ],
  },
  {
    code: 'NC',
    name: 'North Carolina',
    courtName: 'North Carolina Judicial Branch',
    portalUrl: 'https://www.nccourts.gov/ecourts',
    selfHelpUrl: 'https://www.nccourts.gov/help-topics',
    provider: 'tyler-odyssey',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document on eCourts.',
    service: 'eCourts NEF; pro se opponents served by mail.',
    summary:
      'North Carolina is migrating counties onto Tyler eCourts. Pro se filing depends on whether your county is live; otherwise paper at the clerk.',
    notes: [
      'eCourts rollout is ongoing as of 2025; many small counties still file paper.',
    ],
  },
  {
    code: 'ND',
    name: 'North Dakota',
    courtName: 'North Dakota Courts',
    portalUrl: 'https://www.ndcourts.gov/district-courts/e-filing-portal',
    selfHelpUrl: 'https://www.ndcourts.gov/legal-self-help',
    provider: 'court-native',
    proSeAllowed: 'yes',
    formats: 'PDF; 35 MB per document.',
    service: 'NEF via Odyssey eFile; pro se opponents served by mail.',
    summary:
      'North Dakota uses Odyssey eFile. Pro se filing is supported statewide.',
    notes: ['Self-Help has guided pleading packets for divorce, custody, and small claims.'],
  },
  {
    code: 'OH',
    name: 'Ohio',
    courtName: 'Ohio Courts (county-by-county)',
    portalUrl: 'https://www.supremecourt.ohio.gov/courts/services-to-courts/case-management-section/',
    selfHelpUrl: 'https://www.supremecourt.ohio.gov/courts/services-to-courts/court-services/access-to-justice-resources/',
    provider: 'mixed',
    proSeAllowed: 'limited',
    formats: 'PDF; vendor-dependent (commonly 35 MB).',
    service: 'NEF via vendor; service on non-participants by mail.',
    summary:
      'Ohio e-filing is county-by-county. Each common pleas court runs its own portal (CourtView, Tyler, or homegrown). Start at your county clerks site.',
    notes: [
      'The Supreme Court Help Center has approved domestic relations forms.',
    ],
  },
  {
    code: 'OK',
    name: 'Oklahoma',
    courtName: 'Oklahoma Courts',
    portalUrl: 'https://www.oscn.net/applications/oscn/start.asp?viewType=EFILING',
    selfHelpUrl: 'https://www.oscn.net/static/forms/AOCforms.asp',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document on OSCN e-filing.',
    service: 'OSCN sends NEF; non-registered parties served by mail.',
    summary:
      'Oklahoma e-files through OSCN. Pro se filing requires an account request; otherwise file paper.',
    notes: ['AOC forms include divorce, custody, eviction, and small claims packets.'],
  },
  {
    code: 'OR',
    name: 'Oregon',
    courtName: 'Oregon Judicial Department',
    portalUrl: 'https://www.courts.oregon.gov/services/online/Pages/ojd-ecourt.aspx',
    selfHelpUrl: 'https://www.courts.oregon.gov/help/Pages/default.aspx',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF/A required; 25 MB per document via Odyssey File & Serve (OFS).',
    service: 'OFS NEF; pro se opponents served by mail.',
    summary:
      'Oregon uses Odyssey File & Serve (Tyler) for OJD eCourt statewide. Pro se filing is fully supported.',
    notes: [
      'PDF/A enforcement is strict - convert via Acrobat or LibreOffice export.',
    ],
  },
  {
    code: 'PA',
    name: 'Pennsylvania',
    courtName: 'Pennsylvania Unified Judicial System',
    portalUrl: 'https://ujsportal.pacourts.us/',
    selfHelpUrl: 'https://www.pacourts.us/learn/representing-yourself',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; vendor + court level dependent.',
    service: 'UJS Web Portal sends NEF where available; service on non-participants by mail.',
    summary:
      'Pennsylvania e-filing varies by court level (Magisterial District, Common Pleas, Commonwealth, Supreme). The UJS Portal is the public docket; PACFile is for filings where available.',
    notes: [
      'Philadelphia and Allegheny (Pittsburgh) Common Pleas have their own e-filing portals.',
    ],
  },
  {
    code: 'RI',
    name: 'Rhode Island',
    courtName: 'Rhode Island Judiciary',
    portalUrl: 'https://www.courts.ri.gov/Legal-Resources/Pages/electronic-filing.aspx',
    selfHelpUrl: 'https://www.courts.ri.gov/Public-Resources/Pages/eServices.aspx',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document on Tyler.',
    service: 'NEF via Tyler.',
    summary:
      'Rhode Island uses Tyler e-filing. Pro se filing is supported.',
    notes: ['Self-Represented Litigant Center has form packets for divorce, custody, and traffic.'],
  },
  {
    code: 'SC',
    name: 'South Carolina',
    courtName: 'South Carolina Judicial Branch',
    portalUrl: 'https://www.sccourts.org/efiling/',
    selfHelpUrl: 'https://www.sccourts.org/forms/',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 35 MB per document on E-Filing.',
    service: 'NEF; service on non-participants by mail.',
    summary:
      'South Carolina e-files through its own E-Filing system. Pro se accounts require court approval; otherwise paper at the clerk.',
    notes: ['SC Judicial Branch publishes approved forms for civil, family, and probate matters.'],
  },
  {
    code: 'SD',
    name: 'South Dakota',
    courtName: 'South Dakota Unified Judicial System',
    portalUrl: 'https://ujs.sd.gov/for-attorneys/attorney-resources/',
    selfHelpUrl: 'https://ujs.sd.gov/form-file-search/',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document.',
    service: 'NEF via Odyssey eFile.',
    summary:
      'South Dakota e-files through Odyssey. Pro se filing requires registration; otherwise paper.',
    notes: ['UJS forms cover divorce, custody, protection orders, and small claims.'],
  },
  {
    code: 'TN',
    name: 'Tennessee',
    courtName: 'Tennessee Courts',
    portalUrl: 'https://www.tncourts.gov/Appellate_E-Filing',
    selfHelpUrl: 'https://www.tncourts.gov/programs/self-help-center',
    provider: 'mixed',
    proSeAllowed: 'limited',
    formats: 'PDF; vendor varies.',
    service: 'NEF via vendor; service on non-participants by mail.',
    summary:
      'Tennessee e-filing is county-by-county. Knox, Shelby, Davidson, and Hamilton run their own portals; smaller counties file paper.',
    notes: ['Help Center has resources for self-represented parties.'],
  },
  {
    code: 'TX',
    name: 'Texas',
    courtName: 'Texas Courts',
    portalUrl: 'https://efiletexas.gov/',
    selfHelpUrl: 'https://www.txcourts.gov/programs-services/self-help/',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document, 35 MB per submission on eFileTexas.',
    service: 'eFileTexas sends NEF; pro se opponents served by mail or personal service.',
    feeWaiver: {
      label: 'Statement of Inability to Afford Payment of Court Costs',
      url: 'https://www.txcourts.gov/media/1456942/statement-of-inability-to-afford-payment-of-court-costs-or-an-appeal-bond-bilingual.pdf',
    },
    summary:
      'Texas uses eFileTexas (Tyler) statewide. Pro se filing is mandatory in civil cases at the district level and supported through free EFSPs.',
    notes: [
      'TexasLawHelp.org has guided interview-based form packets.',
      'eFileTexas free EFSP is "eFile.TXCourts.gov"; paid EFSPs add fees.',
    ],
  },
  {
    code: 'UT',
    name: 'Utah',
    courtName: 'Utah State Courts',
    portalUrl: 'https://www.utcourts.gov/efiling/',
    selfHelpUrl: 'https://www.utcourts.gov/en/self-help.html',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 35 MB per document via MyCase.',
    service: 'MyCase NEF; pro se opponents served by mail unless they consent.',
    summary:
      'Utah uses MyCase (Tyler) statewide. Pro se filing is supported.',
    notes: ['Online Court Assistance Program (OCAP) has interview-based forms.'],
  },
  {
    code: 'VT',
    name: 'Vermont',
    courtName: 'Vermont Judiciary',
    portalUrl: 'https://www.vermontjudiciary.org/about-vermont-judiciary/electronic-access',
    selfHelpUrl: 'https://www.vtcourts.gov/self-help',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 25 MB per document on Odyssey File & Serve.',
    service: 'OFS NEF.',
    summary:
      'Vermont uses Odyssey File & Serve. Pro se filing is supported statewide.',
    notes: ['Self-help packets cover divorce, parental rights, and stalking orders.'],
  },
  {
    code: 'VA',
    name: 'Virginia',
    courtName: 'Virginia Judicial System',
    portalUrl: 'https://www.vacourts.gov/online/home',
    selfHelpUrl: 'https://selfhelp.vacourts.gov/',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document.',
    service: 'CMS / VJEFS NEF; non-participants served by mail.',
    summary:
      'Virginia uses CMS (Circuit) and VJEFS (Supreme/Court of Appeals). Pro se filing in Circuit is limited; most still file paper at the clerks office.',
    notes: ['Virginia Self-Represented Litigants page has approved forms by case type.'],
  },
  {
    code: 'WA',
    name: 'Washington',
    courtName: 'Washington Courts',
    portalUrl: 'https://www.courts.wa.gov/court_dir/?fa=court_dir.efiling',
    selfHelpUrl: 'https://www.courts.wa.gov/forms/',
    provider: 'mixed',
    proSeAllowed: 'limited',
    formats: 'PDF; vendor varies.',
    service: 'NEF via vendor; non-participants served by mail.',
    summary:
      'Washington e-filing is county-by-county. King (Seattle) uses ECR Online; Pierce uses LINX; Spokane uses its own portal.',
    notes: ['WashingtonLawHelp has self-help packets.'],
  },
  {
    code: 'WV',
    name: 'West Virginia',
    courtName: 'West Virginia Judiciary',
    portalUrl: 'https://www.courtswv.gov/legal-community/e-filing/circuit-family-courts/about',
    selfHelpUrl: 'https://www.courtswv.gov/public-resources/court-forms',
    provider: 'tyler-odyssey',
    proSeAllowed: 'limited',
    formats: 'PDF; 35 MB per document on Tyler.',
    service: 'NEF; non-participants served by mail.',
    summary:
      'West Virginia is rolling out Tyler e-filing. Pro se filing is allowed where the system is live; otherwise paper.',
    notes: ['Self-Help has divorce, parenting, and small-claims packets.'],
  },
  {
    code: 'WI',
    name: 'Wisconsin',
    courtName: 'Wisconsin Court System',
    portalUrl: 'https://www.wicourts.gov/ecourts/index.htm',
    selfHelpUrl: 'https://www.wicourts.gov/services/public/selfhelp/',
    provider: 'court-native',
    proSeAllowed: 'yes',
    formats: 'PDF; 50 MB per document on the WI eFiling system.',
    service: 'NEF via WI eFiling; pro se opponents served by mail unless opted in.',
    summary:
      'Wisconsin uses its own eFiling system. Pro se filing is fully supported in nearly all counties.',
    notes: ['Self-Help Center forms cover family, eviction, civil, and small claims.'],
  },
  {
    code: 'WY',
    name: 'Wyoming',
    courtName: 'Wyoming Judicial Branch',
    portalUrl: 'https://www.courts.state.wy.us/efiling/',
    selfHelpUrl: 'https://www.wyocourts.gov/self-help-forms/',
    provider: 'tyler-odyssey',
    proSeAllowed: 'limited',
    formats: 'PDF; 35 MB per document.',
    service: 'NEF via Tyler.',
    summary:
      'Wyoming uses Tyler e-filing for district and circuit courts. Pro se filing is allowed with registration.',
    notes: ['Self-Help packets cover family and small claims matters.'],
  },

  // -------------------------------------------------------------------
  // D.C. + territories (commonly missed)
  // -------------------------------------------------------------------
  {
    code: 'DC',
    name: 'District of Columbia',
    courtName: 'D.C. Courts',
    portalUrl: 'https://www.dccourts.gov/services/efiling',
    selfHelpUrl: 'https://www.dccourts.gov/services/legal-resources',
    provider: 'tyler-odyssey',
    proSeAllowed: 'yes',
    formats: 'PDF; 35 MB per document on CaseFileXpress.',
    service: 'NEF via CaseFileXpress.',
    summary:
      'D.C. Superior Court uses CaseFileXpress. Pro se filing is supported in most divisions.',
    notes: ['D.C. Bar Pro Bono Center walk-in clinics help unrepresented filers.'],
  },
  {
    code: 'PR',
    name: 'Puerto Rico',
    courtName: 'Tribunal General de Justicia de Puerto Rico',
    portalUrl: 'https://unired.ramajudicial.pr/sumac/',
    selfHelpUrl: 'https://poderjudicial.pr/servicios-a-la-comunidad/',
    provider: 'court-native',
    proSeAllowed: 'limited',
    formats: 'PDF; 25 MB per document on SUMAC.',
    service: 'NEF via SUMAC; non-participants served by mail.',
    summary:
      'Puerto Rico uses SUMAC. Pro se filing is allowed but most pro se filers still walk into the clerks office.',
    notes: ['Forms are in Spanish; English-only filers should plan for translation.'],
  },
];

export function getJurisdictionByCode(code: string): Jurisdiction | undefined {
  return JURISDICTIONS.find((j) => j.code === code.toUpperCase());
}
