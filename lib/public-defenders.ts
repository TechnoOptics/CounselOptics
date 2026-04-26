/**
 * Curated directory of public-defender / appointed-counsel resources for
 * every U.S. state, plus civil legal-aid pointers for matters where the
 * Sixth Amendment right to counsel does NOT attach (most civil cases).
 *
 * Two structural reminders the page should surface:
 *   1. The constitutional right to a public defender in CRIMINAL cases
 *      attaches when the defendant is facing actual or potential
 *      incarceration (Gideon v. Wainwright, Argersinger v. Hamlin).
 *      The user should request counsel at the FIRST court appearance.
 *   2. CIVIL matters (eviction, custody, consumer debt, immigration, etc.)
 *      generally have no right to appointed counsel. Civil legal aid
 *      orgs (LSC-funded, state bar pro bono, law-school clinics) are the
 *      fallback. We surface those alongside each state.
 *
 * Editing guidance: keep `summary` short. Use `applyHow` to walk through
 * the financial-affidavit / appointment process specific to that state.
 * Always cite the state code or rule when we know it - users print these
 * pages and bring them to court.
 */

export type PublicDefenderRecord = {
  /** Two-letter postal code; "DC", "PR" etc. for territories. */
  code: string;
  /** Display name. */
  name: string;
  /** Primary criminal-defense / public-defender office. */
  pdOffice: { name: string; url: string; phone?: string };
  /** Optional: state appellate / capital defender office where it has its own URL. */
  appellateOffice?: { name: string; url: string };
  /** Civil legal-aid orgs - the fallback for non-criminal matters. */
  civilLegalAid: { name: string; url: string }[];
  /** 1-2 sentence summary suitable for the directory list. */
  summary: string;
  /** How to apply for appointed counsel - state-specific steps. */
  applyHow: string[];
  /** Statute / rule citation for indigency standard, if we have it. */
  indigencyRule?: string;
};

export const PUBLIC_DEFENDERS: PublicDefenderRecord[] = [
  {
    code: 'AL',
    name: 'Alabama',
    pdOffice: {
      name: 'Office of Indigent Defense Services (OIDS)',
      url: 'https://oids.alabama.gov/',
    },
    civilLegalAid: [
      { name: 'Legal Services Alabama', url: 'https://www.alabamalegalhelp.org/' },
      { name: 'Alabama State Bar Volunteer Lawyers Program', url: 'https://www.alabar.org/for-the-public/get-legal-help/' },
    ],
    summary:
      'Alabama appoints counsel through county-level circuit courts; OIDS oversees the system but applications are made at the courthouse where the case is filed.',
    applyHow: [
      'At your first court appearance (or sooner if you can), tell the judge you cannot afford an attorney and ask for a court-appointed one.',
      'You will be given an Affidavit of Substantial Hardship to complete. Disclose income, expenses, dependents, and assets honestly.',
      'The court reviews the affidavit and either appoints a defender or denies the request. If denied you can appeal that ruling.',
      'A non-refundable application fee may apply (currently $25 in many counties), waivable for true indigency.',
    ],
    indigencyRule: 'Ala. Code § 15-12-5 (Substantial hardship determination).',
  },
  {
    code: 'AK',
    name: 'Alaska',
    pdOffice: {
      name: 'Alaska Public Defender Agency',
      url: 'https://publicdefender.alaska.gov/',
    },
    appellateOffice: {
      name: 'Office of Public Advocacy (conflict + civil cases)',
      url: 'https://opa.alaska.gov/',
    },
    civilLegalAid: [
      { name: 'Alaska Legal Services Corporation', url: 'https://www.alsc-law.org/' },
    ],
    summary:
      'Alaska has a unified state Public Defender Agency. The Office of Public Advocacy handles conflicts and certain civil matters (CINA, guardianship).',
    applyHow: [
      'Tell the judge at arraignment you cannot afford counsel; the court issues an order of appointment if eligible.',
      'Complete the Financial Statement (CR-203) the agency provides.',
      'OPA covers cases where the PD has a conflict or the matter is civil-but-counsel-is-required (e.g., child-in-need-of-aid).',
    ],
  },
  {
    code: 'AZ',
    name: 'Arizona',
    pdOffice: {
      name: 'County Public Defender Offices (Maricopa, Pima, etc.)',
      url: 'https://www.maricopa.gov/869/Public-Defender',
    },
    civilLegalAid: [
      { name: 'Community Legal Services', url: 'https://www.clsaz.org/' },
      { name: 'Southern Arizona Legal Aid', url: 'https://www.sazlegalaid.org/' },
    ],
    summary:
      'Arizona public defenders are organized by county, not state. Maricopa, Pima, and other large counties run their own offices; smaller counties contract.',
    applyHow: [
      'At your initial appearance the court asks if you want appointed counsel; say yes if you cannot afford one.',
      'Complete the Financial Affidavit the court provides.',
      'The court appoints the County Public Defender, Legal Defender, or contract counsel depending on county and conflicts.',
    ],
  },
  {
    code: 'AR',
    name: 'Arkansas',
    pdOffice: {
      name: 'Arkansas Public Defender Commission',
      url: 'https://arkansas.gov/apdc/',
    },
    civilLegalAid: [
      { name: 'Center for Arkansas Legal Services', url: 'https://www.arlegalservices.org/' },
      { name: 'Legal Aid of Arkansas', url: 'https://www.arlegalaid.org/' },
    ],
    summary:
      'Arkansas has a state-level Public Defender Commission overseeing trial public defenders in each judicial district.',
    applyHow: [
      'Request counsel at first appearance; complete an indigency affidavit.',
      'The court determines indigency and orders appointment.',
    ],
  },
  {
    code: 'CA',
    name: 'California',
    pdOffice: {
      name: 'County Public Defender Offices (Los Angeles, San Francisco, etc.)',
      url: 'https://www.courts.ca.gov/selfhelp-criminal.htm',
    },
    civilLegalAid: [
      { name: 'LawHelpCA / California Legal Services Trust Fund', url: 'https://www.lawhelpca.org/' },
      { name: 'Bay Area Legal Aid', url: 'https://baylegal.org/' },
      { name: 'Public Counsel (LA)', url: 'https://publiccounsel.org/' },
    ],
    summary:
      'California public defenders are county offices. San Francisco, Los Angeles, Alameda, San Diego, Santa Clara each run their own. Indigency is governed by Penal Code § 987.',
    applyHow: [
      'At arraignment the court asks if you want appointed counsel.',
      'Complete the Financial Declaration (Form CR-105) under penalty of perjury.',
      'A registration fee up to $50 may apply if convicted; the fee is waived for true indigency.',
    ],
    indigencyRule: 'Cal. Penal Code § 987.',
  },
  {
    code: 'CO',
    name: 'Colorado',
    pdOffice: {
      name: 'Colorado Office of the State Public Defender',
      url: 'https://coloradodefenders.us/',
    },
    appellateOffice: {
      name: 'Office of Alternate Defense Counsel',
      url: 'https://www.coloradoadc.us/',
    },
    civilLegalAid: [
      { name: 'Colorado Legal Services', url: 'https://www.coloradolegalservices.org/' },
    ],
    summary:
      'Colorado has a unified state OSPD. Conflicts route to the Office of Alternate Defense Counsel.',
    applyHow: [
      'Apply at any OSPD office or at the courthouse via the application packet (Form JDF 208).',
      'A $25 application fee applies; waivable for indigency.',
    ],
    indigencyRule: 'Colo. Rev. Stat. § 21-1-103.',
  },
  {
    code: 'CT',
    name: 'Connecticut',
    pdOffice: {
      name: 'Connecticut Division of Public Defender Services',
      url: 'https://portal.ct.gov/ocpd',
    },
    civilLegalAid: [
      { name: 'Connecticut Legal Services', url: 'https://www.connlegalservices.org/' },
      { name: 'Statewide Legal Services', url: 'https://slsct.org/' },
    ],
    summary:
      'Connecticut has a unified Division of Public Defender Services with offices in each judicial district.',
    applyHow: [
      'Request counsel at presentment / arraignment.',
      'Complete the Application for Appointment of Counsel (Form JD-CR-73).',
    ],
  },
  {
    code: 'DE',
    name: 'Delaware',
    pdOffice: {
      name: 'Office of Defense Services',
      url: 'https://ods.delaware.gov/',
    },
    civilLegalAid: [
      { name: 'Community Legal Aid Society', url: 'https://www.declasi.org/' },
      { name: 'Delaware Volunteer Legal Services', url: 'https://www.dvls.org/' },
    ],
    summary:
      'Delaware has a unified Office of Defense Services covering trial, appellate, and conflict matters.',
    applyHow: [
      'At arraignment, request appointed counsel; complete the indigency affidavit.',
    ],
  },
  {
    code: 'FL',
    name: 'Florida',
    pdOffice: {
      name: 'Florida Public Defender Association (20 Circuit Offices)',
      url: 'https://flpda.org/',
    },
    appellateOffice: {
      name: 'Office of Criminal Conflict and Civil Regional Counsel',
      url: 'https://www.justiceadmin.org/',
    },
    civilLegalAid: [
      { name: 'Florida Bar Foundation - LawHelp Florida', url: 'https://www.floridalawhelp.org/' },
      { name: 'Three Rivers Legal Services / regional LSC offices', url: 'https://www.lsc.gov/grants-grantee-resources/our-grantees' },
    ],
    summary:
      'Florida has 20 circuit-level Public Defender offices. Conflicts go to Regional Counsel.',
    applyHow: [
      'File the Application for Determination of Indigent Status with the Clerk of Court ($50 application fee, waivable).',
      'The court determines indigency and orders appointment.',
    ],
    indigencyRule: 'Fla. Stat. § 27.52.',
  },
  {
    code: 'GA',
    name: 'Georgia',
    pdOffice: {
      name: 'Georgia Public Defender Council',
      url: 'https://www.gapubdef.org/',
    },
    civilLegalAid: [
      { name: 'Georgia Legal Services Program', url: 'https://www.glsp.org/' },
      { name: 'Atlanta Legal Aid', url: 'https://atlantalegalaid.org/' },
    ],
    summary:
      'Georgia has a state PD Council overseeing 49 circuit public defender offices.',
    applyHow: [
      'Request appointed counsel at first appearance; complete the indigency affidavit.',
      'A $50 application fee may apply (waivable).',
    ],
  },
  {
    code: 'HI',
    name: 'Hawaii',
    pdOffice: { name: 'Office of the Public Defender', url: 'https://pubdef.hawaii.gov/' },
    civilLegalAid: [
      { name: 'Legal Aid Society of Hawaii', url: 'https://www.legalaidhawaii.org/' },
    ],
    summary: 'Hawaii has a unified state Office of the Public Defender headquartered in Honolulu, with neighbor-island branches.',
    applyHow: [
      'Apply at the OPD office in your circuit or request counsel at arraignment.',
    ],
  },
  {
    code: 'ID',
    name: 'Idaho',
    pdOffice: {
      name: 'Idaho State Public Defender',
      url: 'https://pdc.idaho.gov/',
    },
    civilLegalAid: [
      { name: 'Idaho Legal Aid Services', url: 'https://www.idaholegalaid.org/' },
    ],
    summary:
      'Idaho transitioned to a unified state Public Defender system in October 2024 (PDC Act).',
    applyHow: [
      'Request appointed counsel at your first court date; the court determines indigency.',
    ],
  },
  {
    code: 'IL',
    name: 'Illinois',
    pdOffice: {
      name: 'County Public Defender Offices (Cook, DuPage, etc.)',
      url: 'https://www.cookcountypublicdefender.org/',
    },
    civilLegalAid: [
      { name: 'Illinois Legal Aid Online', url: 'https://www.illinoislegalaid.org/' },
      { name: 'CARPLS (Cook County)', url: 'https://carpls.org/' },
    ],
    summary:
      'Illinois public defenders are county offices. Cook County has the second-largest PD office in the country.',
    applyHow: [
      'Request appointed counsel at the bond hearing or first appearance; complete the affidavit of assets and liabilities.',
    ],
  },
  {
    code: 'IN',
    name: 'Indiana',
    pdOffice: {
      name: 'Indiana Public Defender Council + County Offices',
      url: 'https://www.in.gov/publicdefender/',
    },
    civilLegalAid: [
      { name: 'Indiana Legal Services', url: 'https://www.indianalegalservices.org/' },
    ],
    summary:
      'Indiana funds public defense through a state commission with local county delivery; quality varies by county.',
    applyHow: [
      'Request counsel at initial hearing; complete the indigency questionnaire.',
    ],
  },
  {
    code: 'IA',
    name: 'Iowa',
    pdOffice: {
      name: 'Iowa State Public Defender',
      url: 'https://spd.iowa.gov/',
    },
    civilLegalAid: [
      { name: 'Iowa Legal Aid', url: 'https://www.iowalegalaid.org/' },
    ],
    summary:
      'Iowa has a unified state PD with regional offices and contract counsel for conflicts.',
    applyHow: [
      'Apply at any SPD regional office or request appointment at arraignment.',
    ],
  },
  {
    code: 'KS',
    name: 'Kansas',
    pdOffice: {
      name: 'Kansas State Board of Indigents Defense Services',
      url: 'https://www.sbids.org/',
    },
    civilLegalAid: [
      { name: 'Kansas Legal Services', url: 'https://www.kansaslegalservices.org/' },
    ],
    summary:
      'Kansas has a state Board of Indigents Defense Services overseeing trial and appellate PD offices and contract counsel.',
    applyHow: [
      'Request counsel at first appearance; complete the affidavit of indigency.',
    ],
  },
  {
    code: 'KY',
    name: 'Kentucky',
    pdOffice: {
      name: 'Department of Public Advocacy',
      url: 'https://dpa.ky.gov/',
    },
    civilLegalAid: [
      { name: 'Kentucky Legal Aid (south)', url: 'https://www.klaid.org/' },
      { name: 'Legal Aid of the Bluegrass (north/east)', url: 'https://www.lablaw.org/' },
    ],
    summary:
      'Kentucky has a unified Department of Public Advocacy covering trial, appellate, and post-conviction.',
    applyHow: [
      'Request DPA at arraignment; complete the Affidavit of Indigency.',
    ],
  },
  {
    code: 'LA',
    name: 'Louisiana',
    pdOffice: {
      name: 'Louisiana Public Defender Board',
      url: 'https://lpdb.la.gov/',
    },
    civilLegalAid: [
      { name: 'Southeast Louisiana Legal Services', url: 'https://www.slls.org/' },
      { name: 'Acadiana Legal Service', url: 'https://www.la-law.org/' },
    ],
    summary:
      'Louisiana funds public defense through a state board with district-level delivery; the system has been chronically underfunded - request a continuance if your appointed lawyer is unavailable.',
    applyHow: [
      'Request appointed counsel at first appearance; complete the financial affidavit.',
    ],
  },
  {
    code: 'ME',
    name: 'Maine',
    pdOffice: {
      name: 'Maine Commission on Public Defense Services',
      url: 'https://www.maine.gov/mcpds/',
    },
    civilLegalAid: [
      { name: 'Pine Tree Legal Assistance', url: 'https://www.ptla.org/' },
    ],
    summary:
      'Maine moved from an all-contract assigned-counsel model to a hybrid (state attorneys + rostered private counsel) starting 2022.',
    applyHow: [
      'Apply through the court at first appearance.',
    ],
  },
  {
    code: 'MD',
    name: 'Maryland',
    pdOffice: {
      name: 'Office of the Public Defender of Maryland',
      url: 'https://opd.state.md.us/',
    },
    civilLegalAid: [
      { name: 'Maryland Legal Aid', url: 'https://www.mdlab.org/' },
      { name: 'Peoples Law Library of Maryland', url: 'https://www.peoples-law.org/' },
    ],
    summary:
      'Maryland has a unified state OPD with district offices in every county.',
    applyHow: [
      'Apply in person or by phone with any OPD district office before your first court date if possible.',
      'A $50 application fee may apply (waivable).',
    ],
  },
  {
    code: 'MA',
    name: 'Massachusetts',
    pdOffice: {
      name: 'Committee for Public Counsel Services (CPCS)',
      url: 'https://www.publiccounsel.net/',
    },
    civilLegalAid: [
      { name: 'MassLegalHelp', url: 'https://www.masslegalhelp.org/' },
      { name: 'Greater Boston Legal Services', url: 'https://www.gbls.org/' },
    ],
    summary:
      'Massachusetts has a unified CPCS covering criminal, juvenile, child welfare, mental-health commitment, and civil-protection matters.',
    applyHow: [
      'Request appointment at arraignment; CPCS staff or bar advocates are appointed.',
      'A $150 indigent counsel fee applies, waivable for indigency.',
    ],
  },
  {
    code: 'MI',
    name: 'Michigan',
    pdOffice: {
      name: 'Michigan Indigent Defense Commission (MIDC) + County Offices',
      url: 'https://michiganidc.gov/',
    },
    civilLegalAid: [
      { name: 'Michigan Legal Help', url: 'https://michiganlegalhelp.org/' },
    ],
    summary:
      'Michigan funds public defense through the MIDC at the state level; trial defense is delivered by county systems that meet MIDC standards.',
    applyHow: [
      'Request appointed counsel at arraignment; complete the indigency affidavit.',
    ],
  },
  {
    code: 'MN',
    name: 'Minnesota',
    pdOffice: {
      name: 'Minnesota Board of Public Defense',
      url: 'https://www.pubdef.state.mn.us/',
    },
    civilLegalAid: [
      { name: 'LawHelpMN', url: 'https://www.lawhelpmn.org/' },
      { name: 'Mid-Minnesota Legal Aid', url: 'https://mylegalaid.org/' },
    ],
    summary:
      'Minnesota has a unified state Board with offices in every judicial district.',
    applyHow: [
      'Request counsel at first appearance; complete the financial statement.',
      'Co-pay may apply (commonly $200) - reduced or waived for indigency.',
    ],
  },
  {
    code: 'MS',
    name: 'Mississippi',
    pdOffice: {
      name: 'Mississippi Office of State Public Defender',
      url: 'https://www.ospd.ms.gov/',
    },
    civilLegalAid: [
      { name: 'Mississippi Center for Legal Services', url: 'https://www.mslegalservices.org/' },
      { name: 'North Mississippi Rural Legal Services', url: 'https://www.nmrls.com/' },
    ],
    summary:
      'Mississippi public defense is mostly county-level with a small state Office of State Public Defender for capital and appeals.',
    applyHow: [
      'Request counsel at initial appearance; the trial court appoints local counsel.',
    ],
  },
  {
    code: 'MO',
    name: 'Missouri',
    pdOffice: {
      name: 'Missouri State Public Defender',
      url: 'https://publicdefender.mo.gov/',
    },
    civilLegalAid: [
      { name: 'Legal Services of Eastern Missouri', url: 'https://www.lsem.org/' },
      { name: 'Mid-Missouri Legal Services', url: 'https://www.lsmo.org/' },
    ],
    summary:
      'Missouri has a unified MSPD that has run a waitlist due to chronic understaffing - the courts have ruled this constitutional in some districts.',
    applyHow: [
      'Apply at any MSPD district office or at the court.',
      'You may be placed on a waitlist; ask the court to delay critical hearings until counsel is assigned.',
    ],
  },
  {
    code: 'MT',
    name: 'Montana',
    pdOffice: {
      name: 'Montana Office of the State Public Defender',
      url: 'https://publicdefender.mt.gov/',
    },
    civilLegalAid: [
      { name: 'Montana Legal Services Association', url: 'https://www.mtlsa.org/' },
    ],
    summary: 'Montana has a unified state OSPD.',
    applyHow: ['Apply at any OSPD regional office or at first appearance.'],
  },
  {
    code: 'NE',
    name: 'Nebraska',
    pdOffice: {
      name: 'County Public Defender Offices + Nebraska Commission on Public Advocacy',
      url: 'https://ncpa.nebraska.gov/',
    },
    civilLegalAid: [
      { name: 'Legal Aid of Nebraska', url: 'https://www.legalaidofnebraska.org/' },
    ],
    summary:
      'Nebraska public defense is county-organized; the Commission on Public Advocacy handles capital, conflict, violent-felony, and DUI appeals.',
    applyHow: ['Request counsel at first appearance; the court appoints the county PD.'],
  },
  {
    code: 'NV',
    name: 'Nevada',
    pdOffice: {
      name: 'Nevada Department of Indigent Defense Services + County PD Offices',
      url: 'https://dids.nv.gov/',
    },
    civilLegalAid: [
      { name: 'Legal Aid Center of Southern Nevada', url: 'https://www.lacsn.org/' },
      { name: 'Nevada Legal Services', url: 'https://nlslaw.net/' },
    ],
    summary:
      'Nevada has a state Department of Indigent Defense Services overseeing county-level delivery.',
    applyHow: ['Request counsel at first appearance; complete the affidavit.'],
  },
  {
    code: 'NH',
    name: 'New Hampshire',
    pdOffice: {
      name: 'New Hampshire Public Defender',
      url: 'https://www.nhpd.org/',
    },
    civilLegalAid: [
      { name: '603 Legal Aid', url: 'https://www.603legalaid.org/' },
    ],
    summary: 'New Hampshire contracts with NHPD (a private nonprofit) for indigent defense.',
    applyHow: [
      'Apply at any NHPD office or at first appearance via the court.',
      'A $275 administrative fee applies, waivable for indigency.',
    ],
  },
  {
    code: 'NJ',
    name: 'New Jersey',
    pdOffice: {
      name: 'New Jersey Office of the Public Defender',
      url: 'https://www.nj.gov/defender/',
    },
    civilLegalAid: [
      { name: 'Legal Services of New Jersey', url: 'https://www.lsnj.org/' },
    ],
    summary:
      'New Jersey has a unified state OPD with trial regions, appellate, and the Office of Parental Representation for child-welfare matters.',
    applyHow: [
      'Apply at any OPD regional office; bring proof of income.',
      'A $50 application fee applies, waivable.',
    ],
  },
  {
    code: 'NM',
    name: 'New Mexico',
    pdOffice: {
      name: 'New Mexico Law Offices of the Public Defender',
      url: 'https://lopdnm.us/',
    },
    civilLegalAid: [
      { name: 'New Mexico Legal Aid', url: 'https://www.newmexicolegalaid.org/' },
    ],
    summary: 'New Mexico has a unified state LOPD.',
    applyHow: ['Request counsel at first appearance; complete the indigency affidavit.'],
  },
  {
    code: 'NY',
    name: 'New York',
    pdOffice: {
      name: 'County Public Defender / Legal Aid Society Offices',
      url: 'https://www.ils.ny.gov/',
    },
    civilLegalAid: [
      { name: 'LawHelpNY', url: 'https://www.lawhelpny.org/' },
      { name: 'Legal Aid Society (NYC)', url: 'https://legalaidnyc.org/' },
      { name: 'Legal Services NYC', url: 'https://www.legalservicesnyc.org/' },
    ],
    summary:
      'New York public defense is county-organized; the Office of Indigent Legal Services (ILS) sets standards. NYC uses Legal Aid Society + alternate providers.',
    applyHow: [
      'Request counsel at arraignment; complete the financial affidavit.',
      'New York is one of the few states with a recognized civil right to counsel in public-housing eviction cases (NYC).',
    ],
  },
  {
    code: 'NC',
    name: 'North Carolina',
    pdOffice: {
      name: 'North Carolina Office of Indigent Defense Services',
      url: 'https://www.ncids.org/',
    },
    civilLegalAid: [
      { name: 'Legal Aid of North Carolina', url: 'https://www.legalaidnc.org/' },
    ],
    summary:
      'North Carolina has a state Office of Indigent Defense Services overseeing trial PD offices and appointed-counsel rosters.',
    applyHow: ['Request counsel at first appearance; complete the affidavit.'],
  },
  {
    code: 'ND',
    name: 'North Dakota',
    pdOffice: {
      name: 'North Dakota Commission on Legal Counsel for Indigents',
      url: 'https://www.nd.gov/indigentdefense/',
    },
    civilLegalAid: [
      { name: 'Legal Services of North Dakota', url: 'https://www.legalassist.org/' },
    ],
    summary:
      'North Dakota has a state Commission overseeing contract defenders across judicial districts.',
    applyHow: ['Apply via Form SFN-13714 at the court or any commission office.'],
  },
  {
    code: 'OH',
    name: 'Ohio',
    pdOffice: {
      name: 'Ohio Public Defender + County Offices',
      url: 'https://opd.ohio.gov/',
    },
    civilLegalAid: [
      { name: 'Ohio Legal Help', url: 'https://www.ohiolegalhelp.org/' },
      { name: 'Legal Aid Society of Cleveland', url: 'https://lasclev.org/' },
    ],
    summary:
      'Ohio funds public defense through the state OPD; trial defense is mostly county delivery (county PDs or contract counsel).',
    applyHow: ['Request counsel at first appearance; complete the financial affidavit.'],
  },
  {
    code: 'OK',
    name: 'Oklahoma',
    pdOffice: {
      name: 'Oklahoma Indigent Defense System',
      url: 'https://www.ok.gov/oids/',
    },
    civilLegalAid: [
      { name: 'Legal Aid Services of Oklahoma', url: 'https://www.legalaidok.org/' },
    ],
    summary:
      'Oklahoma uses OIDS for most counties; Tulsa and Oklahoma counties run their own county PD offices.',
    applyHow: ['Request counsel at arraignment; complete the affidavit.'],
  },
  {
    code: 'OR',
    name: 'Oregon',
    pdOffice: {
      name: 'Oregon Public Defense Commission',
      url: 'https://www.oregon.gov/opdc/',
    },
    civilLegalAid: [
      { name: 'Oregon Law Center', url: 'https://oregonlawcenter.org/' },
      { name: 'Legal Aid Services of Oregon', url: 'https://www.lasoregon.org/' },
    ],
    summary:
      'Oregon transitioned to a state Public Defense Commission in 2023; cases are delivered by contract law firms and rostered counsel.',
    applyHow: ['Request appointed counsel at first appearance; complete the financial affidavit.'],
  },
  {
    code: 'PA',
    name: 'Pennsylvania',
    pdOffice: {
      name: 'County Public Defender Offices (PA has no state PD)',
      url: 'https://www.pacourts.us/courts/courts-of-common-pleas',
    },
    civilLegalAid: [
      { name: 'PALawHELP', url: 'https://www.palawhelp.org/' },
      { name: 'Community Legal Services of Philadelphia', url: 'https://clsphila.org/' },
    ],
    summary:
      'Pennsylvania is one of two states (with South Dakota historically) where public defense is funded entirely by counties, not the state - quality varies enormously.',
    applyHow: ['Request counsel at preliminary arraignment; complete the affidavit.'],
  },
  {
    code: 'RI',
    name: 'Rhode Island',
    pdOffice: {
      name: 'Rhode Island Office of the Public Defender',
      url: 'https://www.ripd.org/',
    },
    civilLegalAid: [
      { name: 'Rhode Island Legal Services', url: 'https://www.rils.org/' },
    ],
    summary: 'Rhode Island has a unified state OPD.',
    applyHow: ['Request counsel at arraignment; OPD staff are appointed.'],
  },
  {
    code: 'SC',
    name: 'South Carolina',
    pdOffice: {
      name: 'South Carolina Commission on Indigent Defense',
      url: 'https://www.sccid.sc.gov/',
    },
    civilLegalAid: [
      { name: 'South Carolina Legal Services', url: 'https://www.sclegal.org/' },
    ],
    summary:
      'South Carolina has a state Commission overseeing 16 circuit PD offices.',
    applyHow: ['Request counsel at first appearance; complete the affidavit.'],
  },
  {
    code: 'SD',
    name: 'South Dakota',
    pdOffice: {
      name: 'County Public Defender / Court-Appointed Counsel',
      url: 'https://ujs.sd.gov/Information/forms.aspx',
    },
    civilLegalAid: [
      { name: 'East River Legal Services', url: 'https://www.erlservices.org/' },
      { name: 'Dakota Plains Legal Services (west)', url: 'https://dpls.org/' },
    ],
    summary:
      'South Dakota public defense is county-funded; quality varies. The state has begun reform discussions.',
    applyHow: ['Request counsel at initial appearance; the judge appoints local counsel.'],
  },
  {
    code: 'TN',
    name: 'Tennessee',
    pdOffice: {
      name: 'Tennessee District Public Defenders Conference',
      url: 'https://www.tndagc.org/dpdc/',
    },
    civilLegalAid: [
      { name: 'Legal Aid Society of Middle Tennessee and the Cumberlands', url: 'https://www.las.org/' },
      { name: 'West Tennessee Legal Services', url: 'https://www.wtls.org/' },
    ],
    summary:
      'Tennessee has district public defenders covering each of 31 judicial districts; Davidson and Shelby (Nashville/Memphis) have larger offices.',
    applyHow: ['Request counsel at first appearance; complete the indigency affidavit.'],
  },
  {
    code: 'TX',
    name: 'Texas',
    pdOffice: {
      name: 'Texas Indigent Defense Commission + County PD / Managed Assigned Counsel',
      url: 'https://tidc.texas.gov/',
    },
    civilLegalAid: [
      { name: 'TexasLawHelp', url: 'https://texaslawhelp.org/' },
      { name: 'Lone Star Legal Aid', url: 'https://lonestarlegal.org/' },
      { name: 'Legal Aid of NorthWest Texas', url: 'https://www.lanwt.org/' },
    ],
    summary:
      'Texas funds public defense at the county level under TIDC oversight. Most counties use rotation appointment of private counsel; some have full PD offices (Harris, Travis, Dallas).',
    applyHow: [
      'Request appointed counsel at magistrate / Article 15.17 hearing within 48 hours of arrest.',
      'Complete the Affidavit of Indigency.',
    ],
  },
  {
    code: 'UT',
    name: 'Utah',
    pdOffice: {
      name: 'Utah Indigent Defense Commission + County PD Offices',
      url: 'https://idc.utah.gov/',
    },
    civilLegalAid: [
      { name: 'Utah Legal Services', url: 'https://www.utahlegalservices.org/' },
      { name: 'And Justice for All', url: 'https://www.andjusticeforall.org/' },
    ],
    summary:
      'Utah has a state IDC overseeing county delivery; Salt Lake Legal Defenders Association is the largest county provider.',
    applyHow: ['Request counsel at first appearance; complete the affidavit.'],
  },
  {
    code: 'VT',
    name: 'Vermont',
    pdOffice: {
      name: 'Office of the Defender General',
      url: 'https://defgen.vermont.gov/',
    },
    civilLegalAid: [
      { name: 'Vermont Legal Aid', url: 'https://www.vtlegalaid.org/' },
    ],
    summary: 'Vermont has a unified state Office of the Defender General.',
    applyHow: ['Request counsel at arraignment; complete the financial affidavit.'],
  },
  {
    code: 'VA',
    name: 'Virginia',
    pdOffice: {
      name: 'Virginia Indigent Defense Commission',
      url: 'https://www.vadefenders.org/',
    },
    civilLegalAid: [
      { name: 'VirginiaLawHelp', url: 'https://www.valegalaid.org/' },
    ],
    summary:
      'Virginia has a state Commission with PD offices in some jurisdictions; others use court-appointed counsel from a roster.',
    applyHow: ['Request counsel at first appearance; complete the affidavit.'],
  },
  {
    code: 'WA',
    name: 'Washington',
    pdOffice: {
      name: 'County Public Defender Offices + Office of Public Defense (appellate)',
      url: 'https://www.opd.wa.gov/',
    },
    civilLegalAid: [
      { name: 'WashingtonLawHelp', url: 'https://www.washingtonlawhelp.org/' },
      { name: 'Northwest Justice Project', url: 'https://nwjustice.org/' },
    ],
    summary:
      'Washington funds public defense at the county level under state Office of Public Defense oversight; OPD handles appeals + parents in dependency.',
    applyHow: ['Request counsel at first appearance; complete the affidavit.'],
  },
  {
    code: 'WV',
    name: 'West Virginia',
    pdOffice: {
      name: 'West Virginia Public Defender Services',
      url: 'https://pds.wv.gov/',
    },
    civilLegalAid: [
      { name: 'Legal Aid of West Virginia', url: 'https://www.lawv.net/' },
    ],
    summary:
      'West Virginia has a state PDS coordinating public-defender corporations and rostered counsel by judicial circuit.',
    applyHow: ['Request counsel at first appearance; complete the affidavit.'],
  },
  {
    code: 'WI',
    name: 'Wisconsin',
    pdOffice: {
      name: 'Wisconsin State Public Defender',
      url: 'https://www.wispd.gov/',
    },
    civilLegalAid: [
      { name: 'Wisconsin Judicare', url: 'https://www.judicare.org/' },
      { name: 'Legal Action of Wisconsin', url: 'https://www.legalaction.org/' },
    ],
    summary:
      'Wisconsin has a unified state Public Defender. Notable: Wisconsin uses one of the strictest indigency standards in the country (115% of federal poverty), so many low-income people are denied SPD - request court-appointed counsel as a fallback.',
    applyHow: [
      'Apply at any SPD office; bring 30 days of pay stubs.',
      'If denied, ask the trial court to appoint counsel under Wis. Stat. § 977.08(4m) - the standard is more generous.',
    ],
  },
  {
    code: 'WY',
    name: 'Wyoming',
    pdOffice: {
      name: 'Wyoming State Public Defenders Office',
      url: 'https://publicdefender.wyo.gov/',
    },
    civilLegalAid: [
      { name: 'Equal Justice Wyoming', url: 'https://www.courts.state.wy.us/equal-justice-wyoming/' },
    ],
    summary: 'Wyoming has a unified state PD with trial offices in each judicial district.',
    applyHow: ['Apply at any PD office or at first appearance.'],
  },

  // -------------------------------------------------------------------
  // D.C. + territories
  // -------------------------------------------------------------------
  {
    code: 'DC',
    name: 'District of Columbia',
    pdOffice: {
      name: 'Public Defender Service for the District of Columbia',
      url: 'https://www.pdsdc.org/',
    },
    civilLegalAid: [
      { name: 'D.C. Bar Pro Bono Center', url: 'https://www.dcbarprobono.org/' },
      { name: 'Legal Aid DC', url: 'https://www.legalaiddc.org/' },
    ],
    summary:
      'D.C. has PDS, widely considered one of the strongest public-defender offices in the country, supplemented by Criminal Justice Act panel attorneys.',
    applyHow: ['Request counsel at presentment; the court determines indigency.'],
  },
  {
    code: 'PR',
    name: 'Puerto Rico',
    pdOffice: {
      name: 'Sociedad para Asistencia Legal',
      url: 'https://www.salpr.org/',
    },
    civilLegalAid: [
      { name: 'Servicios Legales de Puerto Rico', url: 'https://www.servicioslegales.org/' },
    ],
    summary:
      'Puerto Rico provides public defense through SAL (criminal) and several civil legal-aid orgs.',
    applyHow: ['Request counsel at first appearance; complete the affidavit.'],
  },
];

export function getPublicDefenderByCode(code: string): PublicDefenderRecord | undefined {
  return PUBLIC_DEFENDERS.find((p) => p.code === code.toUpperCase());
}
