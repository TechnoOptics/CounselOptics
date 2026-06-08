/**
 * High-intent legal-prep guides. Each entry is one URL at
 * /guides/<slug> with FAQPage + Article + HowTo JSON-LD designed to
 * win specific search-intent queries that lawyers' marketing teams
 * have been buying at $5-$20/click.
 *
 * Tone: not a law-firm marketing page. Calm, plain-English, action-
 * first. Surface Advottic where it genuinely helps (Bella, Find
 * Counsel, Public Defender, Safe Witness) but never pretend to give
 * legal advice. Every guide ends with the same "this is informational
 * only - consult an attorney" line.
 *
 * Adding a new guide: append an object. The /guides index + sitemap
 * + IndexNow trigger pick it up automatically.
 */

export type GuideStep = {
  /** Imperative first-step verb ("Read the summons", "Save the letter"). */
  title: string;
  detail: string;
};

export type GuideFaq = {
  question: string;
  answer: string;
};

export type Guide = {
  slug: string;
  /** Headline question - mirrors the intent query. */
  title: string;
  /** Short one-line answer for the search snippet + JSON-LD description. */
  oneLine: string;
  /** Eyebrow shown above the title on the page. */
  category: string;
  /** Date the guide was last reviewed. Shown to the user + datePublished. */
  lastReviewed: string;
  /** 1-2 paragraphs of intro context. */
  intro: string;
  /** Action steps - become HowToStep JSON-LD entries. */
  steps: GuideStep[];
  /** Short FAQ - becomes FAQPage JSON-LD entries. */
  faqs: GuideFaq[];
  /** Crisis surfaces a 988 / 911 / domestic-violence-hotline panel. */
  crisis?: boolean;
  /** Search keywords surfaced in <meta>. */
  keywords: string[];
};

export const GUIDES: Guide[] = [
  {
    slug: 'i-was-served-with-a-lawsuit',
    title: "I was served with a lawsuit. What do I do?",
    oneLine:
      "Read the complaint, calendar the deadline to respond (usually 20-30 days), decide whether to answer pro se or hire counsel, and never ignore the summons.",
    category: 'Civil defendant',
    lastReviewed: '2026-06-08',
    intro:
      "Getting served with a lawsuit is genuinely frightening. The good news: the process is structured. Every state gives you a fixed window to respond (typically 20-30 days from service), and during that window you have real options. The single most dangerous thing you can do is ignore the summons - the plaintiff can take a default judgment against you for the full amount they're asking, and from there it's a much harder fight.",
    steps: [
      {
        title: 'Read every page of the summons and complaint',
        detail:
          "The summons tells you what court, what case number, and how many days you have to respond. The complaint tells you what the plaintiff claims you did and what they want from you. Highlight three things: the deadline, the exact dollar amount, and any factual claims you flatly disagree with.",
      },
      {
        title: 'Calendar the response deadline immediately',
        detail:
          "Most states give 20-30 days from the date of service. Some federal cases give 21. Put the deadline in two different places (phone + paper) and set a reminder one week before. Missing it = default judgment = collections.",
      },
      {
        title: 'Decide whether to handle it yourself or hire counsel',
        detail:
          "If the dollar amount is under your state's small-claims ceiling (usually $5,000-$25,000) and the facts are simple, pro se is reasonable. If it's anything complex, contract dispute, employment, or anything where attorney fees are at stake, get a consultation - many lawyers offer 30 free minutes for new matters.",
      },
      {
        title: 'File an Answer with the court before the deadline',
        detail:
          "An Answer is a short document that responds to each numbered paragraph in the complaint with admit / deny / lack knowledge to admit or deny. You can write one yourself for $0 (every state's court website has templates) or have a lawyer draft one for $300-$800.",
      },
      {
        title: 'Save every document and never communicate with the plaintiff directly',
        detail:
          "Once a lawsuit is filed, all communication should go through the court or through counsel. Any text, email, or voicemail you send to the plaintiff can be used as evidence.",
      },
    ],
    faqs: [
      {
        question: 'What happens if I ignore the lawsuit?',
        answer:
          "The plaintiff can ask the court for a default judgment for the full amount they sued for, plus their court costs and (in some cases) attorney fees. That judgment is collectible: they can garnish your wages, levy your bank accounts, and in some states put a lien on your home.",
      },
      {
        question: 'Do I need a lawyer to respond?',
        answer:
          "No, but it depends. Small claims and simple matters under your state's pro se ceiling are routinely handled without counsel. For anything with significant dollar exposure, employment claims, contract disputes, or where the other side has a lawyer, a consultation is worth the money even if you ultimately handle the response yourself.",
      },
      {
        question: 'Can I just call the plaintiff and settle?',
        answer:
          "You can try, but be careful. Any admission you make can be used as evidence if the case goes to trial. If you want to settle, get the agreement in writing, signed by both sides, and either file it with the court as a stipulation or have a lawyer review it before signing.",
      },
      {
        question: 'What does Advottic do here?',
        answer:
          "Advottic organizes the case file: deadline tracking, exhibit packets, Bella to help draft a first-pass Answer, and the Find Counsel directory if you decide to hire a lawyer. The platform isn't a law firm and doesn't give legal advice; consult a licensed attorney in your jurisdiction before filing anything you didn't write yourself.",
      },
    ],
    keywords: [
      'i was served with a lawsuit',
      'how to respond to a lawsuit',
      'how many days to respond to a complaint',
      'answer to a complaint pro se',
      'default judgment',
      'served with a summons',
    ],
  },
  {
    slug: 'how-long-do-i-have-to-sue',
    title: 'How long do I have to sue? (Statute of limitations basics)',
    oneLine:
      'Most personal-injury claims have 2-3 years; most contract claims 4-6; many tort claims 2; some criminal restitution and child sexual abuse have no limit. The clock usually starts at the date of injury or discovery.',
    category: 'Statute of limitations',
    lastReviewed: '2026-06-08',
    intro:
      "Every state sets a deadline (the statute of limitations) for filing a civil lawsuit, and once the clock runs the right to sue is permanently gone. The exact length depends on what kind of claim you're bringing AND what state you're in. The rules below are the rough national landscape; your state's specific clock is the only one that actually applies to your case.",
    steps: [
      {
        title: 'Identify the type of claim',
        detail:
          "Different claims have different clocks. Personal injury (car accidents, slip-and-falls): commonly 2-3 years. Contract disputes (written): commonly 4-6 years. Contract disputes (oral): commonly 2-4 years. Property damage: commonly 2-3 years. Medical malpractice: commonly 1-3 years (with special discovery rules). Wrongful death: commonly 1-2 years from death.",
      },
      {
        title: 'Find when the clock started',
        detail:
          "For most claims the clock starts at the date of injury. For latent injuries (mold exposure, asbestos, fraud discovered years later) most states apply a discovery rule - the clock starts when you knew or should have known you were injured.",
      },
      {
        title: 'Check whether tolling applies',
        detail:
          'Tolling pauses the clock. Most common reasons: the plaintiff is a minor (clock paused until 18), the defendant left the state, the defendant fraudulently concealed the injury, or a state-wide emergency declared tolling (some COVID-era extensions still apply in CA and a few other states).',
      },
      {
        title: 'Look up your specific state and claim',
        detail:
          'The numbers above are national rough averages. Always confirm your specific state + claim with the state\'s civil practice rules or with a lawyer. Some states have unusual short windows (Louisiana has a one-year personal-injury clock; Kentucky has a one-year deadline for libel/slander).',
      },
      {
        title: 'File before the deadline even if you do not have a lawyer yet',
        detail:
          "If the deadline is close, you can file a one-page complaint yourself to stop the clock, then add detail and hire counsel after. A filed-but-imperfect complaint is recoverable; a missed deadline is not.",
      },
    ],
    faqs: [
      {
        question: 'What happens if I miss the statute of limitations?',
        answer:
          "Your right to sue is permanently gone. The defendant will file a motion to dismiss on statute-of-limitations grounds and win it, regardless of how strong your underlying claim is. There are rare exceptions for tolling or fraudulent concealment but they're hard to win.",
      },
      {
        question: 'Does the statute of limitations apply to criminal cases?',
        answer:
          "Most criminal charges have their own (usually longer) statute of limitations. Some - notably murder and, in many states, child sexual abuse - have no limit. Statute of limitations on criminal charges is set by the prosecutor's office, not by the victim.",
      },
      {
        question: 'Can I extend the deadline by talking to the other side?',
        answer:
          "Only with a written tolling agreement signed by both sides. Informal conversations, settlement talks, even formal offers do NOT stop the clock unless paperwork is signed.",
      },
      {
        question: 'How does Advottic help?',
        answer:
          "Advottic's Deadline Radar tracks statute-of-limitations clocks across every case in your file, including jurisdiction-specific tolling. Bella can answer plain-English questions about which clock applies to your specific facts. Neither replaces a consultation with a licensed attorney in your state.",
      },
    ],
    keywords: [
      'statute of limitations',
      'how long do i have to sue',
      'statute of limitations by state',
      'tolling',
      'discovery rule',
      'personal injury statute of limitations',
    ],
  },
  {
    slug: 'my-landlord-is-evicting-me',
    title: "My landlord is evicting me. What are my rights?",
    oneLine:
      "Landlords must follow a specific legal process: written notice, court filing, hearing, and a sheriff's writ. You have defenses at every step. Self-help eviction (changing the locks, shutting off utilities) is illegal in every state.",
    category: 'Tenant defense',
    lastReviewed: '2026-06-08',
    intro:
      "Eviction is a legal process, not a private decision the landlord can make on their own. Every state requires the landlord to follow specific steps in order - written notice, lawsuit filed in court, hearing where you get to be heard, and only then a writ of possession that lets the sheriff (not the landlord) physically remove you. You have real defenses at every step, and you don't lose them just because you're behind on rent.",
    steps: [
      {
        title: 'Save every notice you receive in writing',
        detail:
          "The notice has to specify the reason (non-payment, lease violation, holdover) and the deadline to cure or vacate. Without a valid notice the eviction case can be dismissed. If you only got a verbal warning, that's not enough in most states.",
      },
      {
        title: 'Calendar the court date',
        detail:
          "Eviction cases (unlawful detainer) move fast - in most states, 7-30 days from service of the summons to the hearing. Missing the hearing = default judgment = you lose. Calendar it immediately.",
      },
      {
        title: 'Identify defenses',
        detail:
          'Common defenses: improper notice, retaliation (you complained about repairs or reported a code violation), habitability (the unit was uninhabitable), discrimination (race, family status, disability, source of income), partial payment that the landlord accepted, or anti-eviction protection for renters under certain federal programs.',
      },
      {
        title: 'Pay or negotiate before the hearing if you can',
        detail:
          "If the eviction is for non-payment and you can pay all back rent plus court costs before the hearing (called paying it in full or 'pay and stay' in some states), most states require the court to dismiss. Negotiating a payment plan in writing also helps - get any agreement signed and filed with the court.",
      },
      {
        title: 'Show up to the hearing prepared',
        detail:
          'Bring every document: lease, notices, rent receipts, repair requests, photos of conditions, communications with the landlord. Be polite. Address the judge as "Your Honor." Tell your side in calm, factual language. Most evictions are won or lost on documents, not testimony.',
      },
    ],
    faqs: [
      {
        question: 'Can my landlord change the locks or shut off utilities?',
        answer:
          "No. Self-help eviction - changing locks, removing your possessions, shutting off water/power/gas, or any tactic to force you out without a court order - is illegal in every state. If your landlord does this, document it (photos, video, texts) and call your local tenants' rights hotline immediately. Many states impose significant penalties (often 2-3x damages) on landlords who self-help evict.",
      },
      {
        question: 'Will an eviction stay on my record?',
        answer:
          "Filed eviction cases stay on tenant-screening databases for 7+ years in most states, even if you won. Some states (CA, NY, IL, etc.) seal records when the tenant wins. Talk to a tenant lawyer about sealing as soon as the case ends.",
      },
      {
        question: 'I cannot afford a lawyer. What now?',
        answer:
          "Legal aid offices in every state handle eviction defense for tenants below an income threshold (usually 200-400% of federal poverty line). Tenant-rights nonprofits often have walk-in clinics on hearing days. Use Advottic's Find Counsel directory to filter for legal aid and pro-bono attorneys in your area.",
      },
    ],
    keywords: [
      'my landlord is evicting me',
      'eviction defense',
      'tenant rights eviction',
      'self-help eviction',
      'unlawful detainer',
      'eviction process',
    ],
  },
  {
    slug: 'im-being-sued-for-credit-card-debt',
    title: "I'm being sued for credit card debt. What do I do?",
    oneLine:
      'Read the complaint and check the math, demand the original creditor chain (often the debt buyer cannot produce it), file an Answer before the deadline, raise statute-of-limitations and standing defenses, and negotiate from the courthouse steps if needed.',
    category: 'Consumer debt defense',
    lastReviewed: '2026-06-08',
    intro:
      "Most credit-card lawsuits are filed by debt-buyer companies that purchased the account from the original creditor for pennies on the dollar. They often cannot produce the chain of ownership documents the court requires. About 70% of credit-card collection cases end in default judgment because the defendant did not respond - and the simple act of showing up and demanding proof flips the dynamics dramatically.",
    steps: [
      {
        title: 'Read the complaint and verify the numbers',
        detail:
          "Check the principal, interest rate, fees, and total. Cross-check against any statements you have. Errors are common: wrong account, wrong amount, fees stacked on top of fees. List every discrepancy.",
      },
      {
        title: 'File an Answer before the deadline',
        detail:
          "Most states give 20-30 days. The Answer should: deny every paragraph you cannot verify, demand strict proof, and raise affirmative defenses. Common affirmative defenses for debt cases: statute of limitations (most states are 3-6 years from last payment), lack of standing (the plaintiff cannot prove it owns the debt), and FDCPA violations (improper collection conduct).",
      },
      {
        title: 'Send a written demand for proof of ownership and accounting',
        detail:
          "Under the federal Fair Debt Collection Practices Act and most state rules of civil procedure, you can demand: the original signed credit agreement, every bill of sale showing the chain of ownership from the original creditor to the plaintiff, and a complete accounting from the date of last payment. Debt buyers often cannot produce these.",
      },
      {
        title: 'Raise statute of limitations if applicable',
        detail:
          "Each state has its own clock for credit-card debt (3-6 years in most states), usually running from the date of last payment OR last activity on the account. If it has been more than 4 years since you last paid anything on this account, the statute of limitations defense is worth raising. Be careful: making a partial payment or even confirming the debt in writing can restart the clock in some states.",
      },
      {
        title: 'Negotiate from a position of strength',
        detail:
          "Once you have filed an Answer and demanded proof, the debt buyer's economics shift - they paid pennies on the dollar and now have to spend lawyer time. Settlements at 10-30 cents on the dollar are common. Get any settlement in writing, include a satisfaction-of-judgment clause, and confirm the plaintiff will dismiss the case with prejudice.",
      },
    ],
    faqs: [
      {
        question: 'Should I just pay the full amount to make it go away?',
        answer:
          'Almost never. Most cases settle for 10-30% of the demanded amount once you demand proof. Paying in full also confirms the debt and can restart the statute of limitations on related accounts.',
      },
      {
        question: 'Will this affect my credit?',
        answer:
          "A filed lawsuit by itself doesn't show on consumer credit reports (those changed in 2017). A judgment also doesn't show. But the underlying delinquency does. Settling the judgment in writing with 'paid in full' or 'satisfaction of judgment' language helps a lot.",
      },
      {
        question: "What if the debt is mine and they have all the documents?",
        answer:
          "Then negotiate. Debt buyers settle even strong cases because they paid pennies on the dollar and want to close the file. A reasonable opener is 30 cents on the dollar with a structured payment plan. Always get the agreement in writing and file it with the court.",
      },
    ],
    keywords: [
      'sued for credit card debt',
      'debt buyer lawsuit',
      'fdcpa defense',
      'statute of limitations credit card debt',
      'midland funding lawsuit',
      'credit card collection lawsuit',
    ],
  },
  {
    slug: 'i-need-help-domestic-violence',
    title: "I'm in a situation where someone is hurting me. What do I do?",
    oneLine:
      "Get to safety, call 911 if it's an emergency or 1-800-799-7233 (National Domestic Violence Hotline) for confidential support, document what you can, and file for a protective order at your local courthouse - hearings are typically same-day or next-day.",
    category: 'Personal safety',
    lastReviewed: '2026-06-08',
    crisis: true,
    intro:
      "If you are reading this from a safe place: thank you for trusting the internet enough to look. If you are reading this and the person hurting you might see your screen, close this tab and call 1-800-799-7233 (National Domestic Violence Hotline) from a phone they don't have access to, or text START to 88788. Help is real, free, and confidential.\n\nWhat follows is a calm, practical checklist for the days after you are physically safe. None of it is legal advice. Every step here is meant to give you back a sense of control.",
    steps: [
      {
        title: 'Get to physical safety first',
        detail:
          "If you are in immediate danger, call 911. If you can leave, leave - to a friend's house, a shelter, a hospital, or a hotel. The National Domestic Violence Hotline (1-800-799-7233) can help you find a shelter and a safety plan in your area, 24/7, in 200+ languages.",
      },
      {
        title: 'Document what you can, when you can',
        detail:
          "Photos of injuries (with date stamps). Screenshots of threats. Voicemails. Texts. Hospital records. Police report numbers. Save everything to cloud storage the abuser does not have access to (a new Gmail account, a Dropbox the abuser does not know about, even a USB stick at a friend's house). Documentation matters for protective orders, custody, and criminal cases later.",
      },
      {
        title: 'File for a protective order at your local courthouse',
        detail:
          "Every state offers emergency protective orders (sometimes called restraining orders or orders of protection) that you can request without a lawyer, usually same-day or next-day. The clerk's office has the forms. The hearing is in front of a judge; the abuser does not have to be present for the initial (ex parte) order. A typical emergency order lasts 14-30 days; a longer-term order is set at a follow-up hearing.",
      },
      {
        title: 'Connect with a victim advocate',
        detail:
          "Every district attorney's office has victim advocates whose job is to help you navigate the system. They are free and confidential. They can help with safety planning, court accompaniment, finding housing, finding counseling, and applying for victim's compensation funds.",
      },
      {
        title: 'Plan for the medium term',
        detail:
          "Safe Witness (in Advottic) sends a one-tap location-attached SMS to trusted contacts when you press and hold the button. Change passwords, account recovery contacts, and 2FA settings on every account. If you have shared finances, consult with a financial counselor (the hotline can refer you). If kids are involved, talk to a family-law attorney about custody options - most legal aid organizations prioritize these cases.",
      },
    ],
    faqs: [
      {
        question: "Will the police take my report seriously?",
        answer:
          "By federal and state law, yes - and law enforcement training has improved dramatically in the last decade. Bring a list of dates, locations, witnesses, and any documentation. Ask for the report number before you leave. If you feel a specific officer is not taking you seriously, you can ask to speak to a supervisor or to the domestic-violence detail.",
      },
      {
        question: "Do I need a lawyer for a protective order?",
        answer:
          "No. Protective-order petitions are designed for pro se (self-represented) filers. The clerk's office has the forms. Many local domestic-violence organizations provide free help filling them out. If the abuser hires a lawyer for the follow-up hearing, ask for legal aid - many states fast-track DV cases.",
      },
      {
        question: "I'm afraid to leave. Is there anyone who can help me plan?",
        answer:
          "Yes. The National Domestic Violence Hotline (1-800-799-7233) and the Crisis Text Line (text HOME to 741741) are both 24/7, free, and confidential. They specialize in safety planning. If you cannot make a call, the hotline has a chat option at thehotline.org.",
      },
      {
        question: 'What does Advottic do here?',
        answer:
          "Advottic offers Safe Witness (a press-and-hold button on your watch or in the web app that sends a one-time alert to your trusted contacts with your location), case organization for any related legal matters, and the Find Counsel directory to help you find a family-law or domestic-violence attorney. Advottic is not a law firm and does not provide legal advice. The crisis hotlines above will always be your first call.",
      },
    ],
    keywords: [
      "domestic violence help",
      "restraining order how to get",
      "protective order",
      "national domestic violence hotline",
      "i am being abused",
      "safe witness",
    ],
  },
];

export function getGuide(slug: string): Guide | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}
