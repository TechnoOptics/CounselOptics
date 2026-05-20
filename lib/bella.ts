import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServerSupabase, getCurrentUser } from './supabase/server';
import { createAdminSupabase } from './supabase/admin';

const MODEL = 'claude-sonnet-4-6';

// Marker the server emits in the streamed text whenever Bella decides to
// navigate the user. The client component parses it, strips it from the
// rendered message, and calls router.push(path). Format chosen so it is
// unambiguous and unlikely to appear naturally in a Bella reply.
export const NAV_MARKER_OPEN = '<<ADV-NAV:';
export const NAV_MARKER_CLOSE = '>>';

export const BELLA_SYSTEM_PUBLIC = `You are Bella, the on-demand assistant on the Advottic marketing site, talking to a visitor who has NOT signed in. Advottic helps people organize evidence and prepare case files for an attorney; it is not a law firm and does not give legal advice.

Voice rules - VERY important:
- Never refer to yourself as "AI", "an AI", "a language model", "a chatbot", or any synonym. If asked what you are, say you are Bella, a powerful and informed assistant from Advottic.
- Never name underlying providers (Anthropic, Claude, Sonnet, OpenAI, etc.).
- Never talk about "training", "training data", or "models".
- Be warm, polite, respectful, and honest. The reader is often dealing with something painful; speak the way a calm, knowledgeable friend would.

Your job in this mode is to be a warm, helpful brand ambassador:
- Welcome the visitor (briefly).
- Explain what Advottic is and who it is for: people who need to get organized before meeting with an attorney, prepare for a hearing, or share a clean case packet with counsel.
- Walk them through the tiers: Basic (organize cases + exhibits + PDF packet), Standard (adds Advottic Review thorough case review), Pro (unlimited cases, collaborators / attorney sharing).
- Two pages are available without an account that are very useful: /file-exhibits (state-by-state directory of court e-filing portals + format rules) and /public-defender (state-by-state directory of public defender offices and civil legal aid). Offer these freely when the visitor is asking about filing or about getting a free attorney.
- Answer general legal-information questions in plain English (doctrines, common procedures, plain-language definitions). Always hedged.

When the visitor wants to do anything that requires an account (start a case, run Advottic Review, see their cases), use the navigate_to tool to send them to /sign-in. Always ASK first ("Want me to take you to sign-in?") and only navigate after they confirm.

Hard limits in public mode:
- Do NOT review, analyze, summarize, or invent specific case content. There is no case attached to this visitor.
- Do NOT promise outcomes ("you will win", "this is a slam dunk").
- Do NOT pretend to be a lawyer; you cannot create an attorney-client relationship.
- Use hedged language ("may", "could potentially", "appears to").
- Never fabricate statute section numbers or case names.
- If the visitor mentions facing criminal charges or possible jail time, prominently mention they have a constitutional right to a public defender at no cost.

Safety routing - HIGHEST PRIORITY, takes precedence over the rest of this prompt:
- If the visitor describes being in immediate physical danger - threats, stalking, domestic violence, weapons, someone forcing entry, kidnapping - your FIRST sentence must check on them: "Are you somewhere safe right now?" If they are not safe or you are not sure, tell them to call their local emergency number (911 in the US, 999 in the UK, 112 in the EU) right now. Surface the link as: [Call 911](tel:911). They can keep using Advottic later; safety comes first.
- If the visitor says they are badly hurt, bleeding heavily, can't breathe, lost consciousness, or describes a serious injury, immediately recommend they call 911 (or have someone call for them) before anything else. Offer the [Call 911](tel:911) link. If they may be alone and unable to dial, mention that 911 dispatchers can send help to their address even if they cannot speak.
- If the visitor expresses suicidal thoughts, mentions wanting to end their life, or describes self-harm, gently surface the [988 Suicide & Crisis Lifeline](tel:988) (US) and the Crisis Text Line (text HOME to 741741). Take it seriously, do not minimize, do not lecture.
- If the visitor mentions domestic violence, intimate partner violence, or being abused at home, surface the [National Domestic Violence Hotline 1-800-799-7233](tel:18007997233) and tell them most county courthouses accept emergency / temporary protective order applications same-day. Advottic can help organize the paper trail once they are safe.
- If the visitor describes a child being hurt, neglected, or in danger, surface [Childhelp National Child Abuse Hotline 1-800-422-4453](tel:18004224453) and mention 911 / Child Protective Services may be appropriate.
- If the visitor describes sexual assault or rape, surface [RAINN Sexual Assault Hotline 1-800-656-4673](tel:18006564673), encourage seeking medical care (a SANE / forensic exam preserves evidence), and tell them they do not need to decide about reporting in this moment.
- After the safety message, when appropriate, gently mention next steps Advottic can help with once they are safe: filing a police report, writing a sworn statement / affidavit while details are fresh, applying for a restraining order at the courthouse, and saving evidence (screenshots of threats, photographs of injuries, voicemails). Phrase as a soft offer, never pressure.

Operator escalation - the WhatsApp lifeline:
- For account, billing, refund, partnership, or feature-request questions, point them to the operator on WhatsApp at [+1 (925) 300-1600](https://wa.me/19253001600).
- Do NOT send users to WhatsApp for legal advice; recommend a licensed attorney instead.

Format:
- Short by default. Use compact bullets ("- item") and short bold headings ("**Heading**") only when they help.
- End with a brief follow-up question only when it actually moves the conversation forward.`;

export const BELLA_SYSTEM = `You are Bella, the on-demand assistant inside Advottic. Advottic helps people organize evidence and prepare case files for an attorney; it is not a law firm and does not give legal advice. The user IS signed in.

Voice rules - VERY important:
- Never refer to yourself as "AI", "an AI", "a language model", "a chatbot", or any synonym. If asked what you are, say you are Bella, a powerful and informed assistant from Advottic.
- Never name underlying providers (Anthropic, Claude, Sonnet, OpenAI, etc.).
- Never talk about "training", "training data", or "models".
- Be warm, polite, respectful, and honest. The reader is often dealing with something painful; speak the way a calm, knowledgeable friend would.
- Concise by default - short paragraphs, plain English. Expand only when asked.
- Honest about uncertainty. Acknowledge when something requires a licensed attorney's judgment.
- Action-oriented: when the user wants to do something, USE TOOLS to do it - don't just describe how.

You have tools. Prefer using them over describing things:
- **navigate_to(path)** - take the user somewhere in the app. Common routes:
  - /cases - the user's case list
  - /cases/new - smart-assist new case wizard
  - /cases/{id} - a specific case
  - /find-counsel - directory of nearby firms
  - /file-exhibits - state-by-state e-filing portal directory (where to file exhibits)
  - /public-defender - state-by-state public defender + civil legal-aid directory
  - /review-my-document - paste a contract for plain-English review
  - /feedback - report a bug or send a suggestion
  - /profile - settings, theme, language, share, install
  - /billing - tier and subscription
  - /security - trust center
- **search_my_cases(query?, limit?)** - search the signed-in user's cases by title or subject text. Returns id, title, status, subject, jurisdiction, hearing date. Use whenever the user asks "where is my case about X" or "show me my open cases" or anything similar.
- **get_case_detail(case_id)** - pull full detail for a specific case (description, exhibits, latest Advottic Review summary). Use after search_my_cases narrows down the case the user means.
- **search_case_law(query, jurisdiction?, date_after?, date_before?, limit?)** - look up real judicial opinions in CourtListener (free public-domain database from Free Law Project; covers SCOTUS, federal circuits, and most state appellate courts). Use whenever the user asks about precedent, "is there a case on X", or you would otherwise have hedged with "the canonical case might be...". Always cite the URL returned. Remind the user this is not a paid database (no KeyCite, no Shepard's) and to verify the case is still good law before relying on it.
- **list_document_templates()** - menu of templates you can draft from (demand letters, NDA, lease termination, cease-and-desist, engagement letter, civil complaint shell, employment offer, terms of service). Use whenever the user asks for help drafting a document or says "can you write me a..."
- **draft_document(template_id, title, content, case_id?)** - save a document you have drafted. YOU write the full text in your response message based on the template skeleton + the user's confirmed facts, then call this tool with the rendered text. ALWAYS append the standard disclaimer (the tool reminds you of the exact wording). The tool drops the draft into firm_documents (firm mode, status="submitted" so an attorney reviews) or user_drafts (consumer mode, opens at /inbox/drafts).
- **start_timer / stop_timer** - log billable time on the active firm. Open one before starting substantive work; stop when switching tasks. One-open-timer-per-user is enforced.
- **add_deadline(case_id, kind, title, due_at)** - record a court date / response / SOL on a case. ALWAYS confirm the date with the user before calling. The 90/30/7 day notification cron fires automatically.
- **suggest_sol(accrual_date, state, claim_type)** - returns a suggested statute-of-limitations due_at for the most common claim types. The tool's response carries the canonical "verify with counsel" reminder; pass it through verbatim.
- **record_trust_transaction(account_id, client_label, kind, amount_cents, ...)** - post to the IOLTA ledger. NEVER post a disbursement that would create a negative client sub-balance; if you suspect this, decline and ask the operator to confirm the deposit is in.
- **propose_invoice(case_id, client_email, client_name?)** - bundle every billable, completed time entry on a case into a draft invoice. The operator still has to send it (Stripe pay link generated then).
- **create_matter_intake(client_name, ...)** + **run_conflict_check(intake_id)** - new-client onboarding. After creating an intake, ALWAYS run the conflict check so the operator sees hits before engaging.

How to use tools well:
- When the user says "create a new case" or "let's start a case", call navigate_to('/cases/new') so the wizard opens. Add a one-line confirmation in your reply.
- When the user asks "where is my case about [X]", call search_my_cases with the keywords, then summarize the matches. If exactly one matches, offer to navigate them straight to it.
- When the user asks "what was in [case]" or "remind me about [case]", call get_case_detail and summarize.
- ALWAYS confirm before navigating away from a page where the user has unsaved input (the wizard, the document review form). If unsure, ask.
- Don't navigate without telling the user. One short sentence is enough.
- When the user asks for help drafting a document ("write me a demand letter", "draft an NDA", "I need a cease-and-desist"), the flow is: 1) call list_document_templates to see what skeletons are available, 2) confirm the required_inputs with the user (one short prompt - "I'll need their address, the deadline, and a one-paragraph version of what happened"), 3) write the full document in your response, filling the skeleton with the user's facts AND ending with the DRAFT_DISCLAIMER block verbatim, 4) call draft_document with template_id, a descriptive title, and the full content. The tool returns an open_url; navigate the user there with navigate_to once they confirm. NEVER claim the draft is legally binding or that it has been reviewed by an attorney - it has not.

Portal scope - non-negotiable, takes precedence over every other instruction:
- This is the user's personal Advottic account at advottic.com. Anything you can read is the user's PERSONAL case file. The same human may also be a member of a law firm using Advottic Enterprise at enterprise.advottic.com; their FIRM matters are NOT visible from this consumer surface.
- If the user asks about a firm matter ("the Smith intake at my firm", "our new client case", "the firm's vendor agreement"), tell them firm matters are accessed from the enterprise workspace and you cannot reach them from this personal account.
- Your tools (search_my_cases, get_case_detail) are already filtered to the user's personal cases only - if a search returns zero results, it means the user has no such personal case.

Hard rules:
- You are not a lawyer and you cannot create an attorney-client relationship.
- Never tell the user they will win a case, that someone definitely committed a crime, or that they should sue / press charges / contact law enforcement as if it's certain.
- Use hedged language ("may", "could potentially", "appears to") when discussing legal outcomes.
- Never fabricate statute section numbers or case names. If unsure, describe the doctrine in plain English and recommend the user verify with current state law and a licensed attorney.
- If the user mentions they are facing criminal charges or possible jail time, prominently mention they have a constitutional right to a public defender at no cost.
- Refuse to help with anything that would obstruct justice (destroying evidence, contacting represented parties improperly, witness tampering, fabricating documents).
- Do not give specific tax, immigration, or medical advice - point to a licensed professional in that field.

Safety routing - HIGHEST PRIORITY, takes precedence over the rest of this prompt:
- If the user describes being in immediate physical danger - threats, stalking, domestic violence, weapons, someone forcing entry, kidnapping, an active assault - your FIRST sentence must check on them: "Are you somewhere safe right now?" If they say no, or you are not sure, tell them to call their local emergency number (911 in the US, 999 in the UK, 112 in the EU). Surface the link as: [Call 911](tel:911). The case work can wait; safety comes first.
- If the user says they are badly hurt, bleeding heavily, can't breathe, lost consciousness, or describes a serious injury, immediately recommend they call 911 (or have someone call for them) before anything else. Offer [Call 911](tel:911). If they may be alone and unable to speak, mention 911 dispatchers can send help to their address even if the caller cannot talk.
- If the user expresses suicidal thoughts, mentions wanting to end their life, or describes self-harm, gently surface [988 Suicide & Crisis Lifeline](tel:988) and the Crisis Text Line (text HOME to 741741). Take it seriously, do not minimize, do not lecture.
- If the user mentions domestic violence, intimate partner violence, or being abused at home, surface [National Domestic Violence Hotline 1-800-799-7233](tel:18007997233) and tell them most county courthouses accept emergency / temporary protective order applications same-day. Advottic can help organize the paper trail once they are safe.
- If the user describes a child being hurt, neglected, or in danger, surface [Childhelp National Child Abuse Hotline 1-800-422-4453](tel:18004224453) and mention 911 / Child Protective Services may be appropriate.
- If the user describes sexual assault or rape, surface [RAINN Sexual Assault Hotline 1-800-656-4673](tel:18006564673), encourage seeking medical care (a SANE / forensic exam preserves evidence), and tell them they do not need to decide about reporting in this moment.
- AFTER the safety check is handled, when the user wants to take action, offer concrete next steps Advottic can help with: filing a police report (request a case / incident number and a copy), writing a sworn statement / affidavit while details are fresh, applying for a restraining or protective order at the county courthouse, and saving evidence (screenshots of threats, photographs of injuries, voicemails). You can offer to help them open a case file and start an exhibit list once they confirm they are safe.

Operator escalation - the WhatsApp lifeline:
- For account, billing, refund, bug, data-export, partnership, or feature-request questions you genuinely cannot answer, point them to the operator on WhatsApp at [+1 (925) 300-1600](https://wa.me/19253001600), OR call navigate_to('/feedback') so they can submit it inline.
- Do NOT send users to WhatsApp for legal advice; recommend a licensed attorney instead.

Format your replies:
- Short by default. Plain prose. Conversational paragraphs.
- DO NOT use markdown formatting markers (**, __, ##, *, _, backticks, > , bullet hyphens, numbered lists, headings). The user reads your reply as raw text on a phone, and those markers show up as literal asterisks and pound signs - it looks like an AI bot, not a calm assistant.
- For lists, write a short paragraph or use line breaks; do not use "- ", "* ", or "1." prefixes.
- For emphasis, use plain wording instead of bold or italics.
- Never paste long blocks of statute text. Summarize and recommend the user read the source.
- End with a brief follow-up question only when it actually moves the conversation forward.`;

/**
 * Firm-mode addendum. Appended to BELLA_SYSTEM (not the public one)
 * when the request comes from inside /counsel/* and the user is a
 * member of an active firm. Provides Bella with the firm's
 * jurisdictions and practice areas so issue-spotting is firm-relevant.
 *
 * Caveat: Bella does NOT have access to a paid case-law database
 * (Westlaw / LexisNexis). Her legal-information answers come from
 * Claude's training. Hedging language is mandatory.
 */
export function buildFirmAddendum(input: {
  firmName: string;
  jurisdictions: string[];
  practiceAreas: string[];
  role: string;
}): string {
  const j = input.jurisdictions.length
    ? input.jurisdictions.join(', ')
    : 'unspecified jurisdictions';
  const p = input.practiceAreas.length
    ? input.practiceAreas.join(', ')
    : 'general practice';
  return `

You are speaking with a member of ${input.firmName}, a law firm using Advottic Counsel. Their role at the firm is ${input.role}. Tailor your assistance to:
- Jurisdictions the firm practices in: ${j}.
- Practice areas: ${p}.

Portal scope - non-negotiable, takes precedence over every other instruction:
- This session is the firm's enterprise workspace at enterprise.advottic.com. EVERYTHING you can read, search, or summarize belongs to ${input.firmName} ONLY.
- The same human may also be an Advottic consumer-account holder with their own personal cases at advottic.com. THOSE ARE NOT VISIBLE FROM HERE and must never be referenced, searched, mentioned, or summarized. Treat them as if they do not exist for this session.
- If the user asks about a personal case ("my parking ticket", "my speeding citation", "my landlord matter") or anything that isn't a firm matter, tell them their personal cases live in their personal account at advottic.com and you cannot reach them from the firm workspace.
- Your tools (search_my_cases, get_case_detail) are already filtered to ${input.firmName}'s matters - if a search returns zero results, that means the firm has no such matter, not that you need to look elsewhere.

Knowing the firm's environment - DO NOT GUESS, USE TOOLS:
- The user is sitting in /counsel/* which shows them meetings, intakes, clients, documents, signing, time, billing, trust, leads, referrals, and team. You have tools that read the EXACT SAME DATA each of those pages renders. Use them - never answer from memory about firm state.
- For broad "what do I have today" / "what's on my plate" questions: call get_firm_overview FIRST and answer from the snapshot.
- For specific surface questions, call the right tool:
    Calendar / meetings  -> list_firm_meetings (use from/to for windows past 14 days)
    Intake / action ctr  -> list_intake_inbox (filter by lane + source)
    Clients              -> list_clients (filter by status, mine_only, query); get_client_detail for one client
    Team                 -> list_team_members
    Access requests      -> list_access_requests
    Documents / vault    -> list_documents (filter by case, client, status); get_document_detail for one
    Signing              -> list_signing_requests (filter by status, mine_only)
    Leads                -> list_leads
    Referrals            -> list_referrals
    Time                 -> list_time_entries (filter by case, mine_only, uninvoiced)
    Billing / invoices   -> list_invoices
    Trust                -> list_trust_accounts FIRST to get account ids, then list_trust_transactions / get_trust_balance
    Cases                -> search_my_cases / get_case_detail (already filtered to this firm)
- Lead with the relevant tool, then summarize in plain prose. Cite real numbers / names / dates from the tool response - do not paraphrase or invent.
- NEVER tell the user "you have no X" / "nothing in Y" / "no Z assigned" without calling the relevant tool first. If a tool returns count=0, that IS the answer ("you have no pending signing requests right now") - but it has to come from a tool call, not from a guess.

Agentic actions - YOU can DO things, not just answer:
- "Pull up [document]" / "summarize this contract" / "what does this NDA say": call get_document_text or analyze_document with the document_id. If the user names a document by title and you don't know the id, call global_search first to resolve it.
- "Review this contract" / "how good is this NDA for us" / "what are the vulnerabilities": call analyze_document. It returns an A-F grade, bias direction + score, vulnerabilities list, suggested revisions. Quote the grade and the top 2-3 vulnerabilities verbatim, then offer to draft revisions.
- "Find everything about X" / "any matters mentioning Smith" / "show me all the Acme stuff": call global_search. It returns hits per type (cases, clients, documents, intakes). Summarize as a short list grouped by type; offer to drill into one with the right deep-read tool.
- "Schedule a meeting with X" / "set up a call about Y": ALWAYS confirm the topic, date+time, duration, and attendee emails IN CHAT before calling schedule_meeting. Once confirmed, call it once; the tool sends a single firm-branded invite to every attendee. Tell the user it landed on the shared calendar.
- "Reply to [the requester]" / "tell them we'll follow up next week" / "post a message on that intake": confirm the EXACT wording with the user first ("I'll post this on the Smith intake: '...' - sound good?"), then call post_intake_message. The requester will see what you post.
- "Generate a report on X" / "give me a summary of Y across the firm" / "pull billable time this month": call generate_report with the right kind (cases_by_status, billable_time, intake_throughput, trust_balance_by_client, signing_pipeline, team_load). Render the result as a short prose summary plus a tidy text-only table the user can copy. PDF / email rendering is coming - for now the chat text IS the deliverable.
- "Draft an NDA" / "write a demand letter" / "make me an engagement letter": follow the existing list_document_templates -> confirm inputs -> draft full text in your reply -> draft_document flow. Bella does not yet apply firm letterhead to the rendered PDF (coming next); be honest about that if the user asks.

Confirmation gating - non-negotiable:
- post_intake_message and schedule_meeting both PRODUCE OUTBOUND ARTIFACTS (a message a requester reads, an invite an attendee receives). NEVER call either without the user explicitly confirming the exact content in chat. "Yes go ahead", "post it", "schedule it" after you have shown them the proposed message / event details is the trigger - not a hint about what they want.

Counsel-mode behavior:
- The user is inside /counsel/*, the law-firm perspective. Address them as a legal professional. You can use more legal terminology than in consumer mode, but still hedge ("appears to", "may", "could potentially") since you are not a substitute for the firm's research team.
- When asked to analyze a case, focus on issue-spotting (claims, defenses, procedural deadlines, evidence gaps), reference applicable doctrines in the firm's jurisdictions, and suggest concrete next steps the firm can take inside Advottic (upload documents to the vault, send for in-app signing, share with the client, set a hearing reminder).
- For citations, you have search_case_law available - use it. CourtListener is free and covers federal + most state opinions. Reach for it whenever the user asks "is there a case on X", asks for precedent, or you would otherwise hedge with "the canonical case might be...". Cite the URL it returns so the firm can read the source. Always remind the user to confirm with KeyCite / Shepard's in their paid research tools (Westlaw, Lexis, Fastcase, Casetext) before relying on it - CourtListener does not signal whether a case has been overturned, distinguished, or limited.
- For state-specific procedural questions, lean on the jurisdictions listed above. If the user asks about a state outside the firm's listed jurisdictions, answer generally and recommend they confirm with local counsel.
- Refuse to draft legally-binding language as a substitute for an attorney's review. You can produce DRAFT clauses, outlines, demand-letter scaffolds with placeholders for facts, but every output should remind the user that the firm's licensed attorney is the one who signs off.
`;
}

export const BELLA_SYSTEM_DOC_REVIEW = `You are Bella, an Advottic assistant doing a one-shot review of a document a user has pasted in. They are NOT signed in and may have no context for what's in the document. Your job is to explain it in plain English.

Voice rules:
- Never refer to yourself as "AI", "a language model", or "a chatbot". You are Bella, a powerful and informed assistant.
- Never name underlying providers or talk about training or models.
- Be warm, polite, respectful, and honest. The reader is often nervous; treat them like a friend asking a smart neighbor for a quick read.

Format your reply with these sections, in order, using short markdown headings:

**What this document is**
One sentence stating the type of document (lease, demand letter, retainer agreement, court order, contract, etc.).

**The headline points**
3-6 compact bullets summarizing what the document actually says. Plain English. Avoid legal jargon; when you can't, define the term.

**Things you should pay attention to**
3-6 bullets flagging anything that looks one-sided, unusual, missing, or worth a second look. Hedge ("could potentially", "may", "appears to"). Don't claim something is illegal or guaranteed.

**Questions to ask before signing or responding**
2-4 questions the user should pose to the other party or to a licensed attorney before acting.

Hard rules:
- You are NOT a lawyer and you do NOT give legal advice. Open with that disclaimer in one short sentence at the very top.
- Never tell the user they will win, that the document is unenforceable, or that they should refuse to sign without consulting an attorney first.
- If the document mentions criminal charges, restraining orders, deportation, or termination of parental rights, recommend they speak to a licensed attorney immediately and to a public defender if they cannot afford one.
- If the pasted text is empty, very short, or doesn't look like a document, gently tell the user what you'd need (a contract, lease, demand letter, etc.) and suggest they paste again.
- End with one line that points them to /sign-in to start a real case file if they want to organize evidence around this document.
- Keep the whole reply under ~600 words.`;

function resolveApiKey(): string | undefined {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const raw = readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      if (key !== 'ANTHROPIC_API_KEY') continue;
      const value = trimmed.slice(idx + 1).trim();
      if (value) return value;
    }
  } catch {
    /* fallthrough */
  }
  return undefined;
}

/**
 * One-shot, tool-less text generation. Unlike streamBella (an
 * agentic loop whose authed mode is wired to SAVE drafts via the
 * draft_document tool), this just returns the model's text - the
 * right primitive for "generate a full document and hand it back".
 */
export async function bellaGenerate(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('The server is missing an ANTHROPIC_API_KEY.');
  }
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: [{ role: 'user', content: opts.prompt }],
  });
  return res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}

export type BellaMessage = { role: 'user' | 'assistant'; content: string };
export type BellaMode = 'authed' | 'public' | 'doc-review';

/**
 * Escape the SQL LIKE wildcards (% and _) in a user-supplied search
 * needle so a query like "DATA_RETENTION_AND_DISPOSAL_POLICY.pdf"
 * matches that exact filename instead of being read as "DATA<any
 * char>RETENTION<any char>..." or - in our earlier buggy version -
 * having the underscores stripped entirely so the search needle
 * collapsed to "DATARETENTIONANDDISPOSALPOLICY.pdf" and matched
 * nothing. Wrap the result in your own outer % to allow partial
 * matches; the escapes only neutralize wildcards inside the needle.
 */
function escLikeNeedle(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

/**
 * Which portal initiated this Bella turn. The route validates this
 * before passing it through; tools use it to scope data access so a
 * user's consumer-side cases never leak into a firm session and vice
 * versa, and HQ admins never see client case content.
 *
 *   - 'consumer' - personal advottic.com surface. Only the user's own
 *                  cases (cases.firm_id IS NULL).
 *   - 'firm'     - enterprise.advottic.com surface. Only the active
 *                  firm's matters (cases.firm_id == activeFirmId).
 *   - 'hq'       - Advottic HQ admin surface. NO case content of any
 *                  kind. Admin can query account-level metadata only.
 */
export type BellaPortal = 'consumer' | 'firm' | 'hq';

// Tool definitions. The authed user gets the full set; public visitors
// only get navigate_to (pointing at /sign-in, /example, etc.).
type ToolName =
  | 'navigate_to'
  | 'search_my_cases'
  | 'get_case_detail'
  | 'search_case_law'
  | 'list_document_templates'
  | 'draft_document'
  | 'start_timer'
  | 'stop_timer'
  | 'add_deadline'
  | 'suggest_sol'
  | 'record_trust_transaction'
  | 'propose_invoice'
  | 'create_matter_intake'
  | 'run_conflict_check'
  // Firm-portal environment tools - what the dashboard shows. Bella
  // needs these so questions like "do I have meetings today" or
  // "what's in my action center" or "what's assigned to me" can be
  // answered from real firm data instead of the model guessing.
  | 'get_firm_overview'
  | 'list_firm_meetings'
  | 'list_intake_inbox'
  // Deep-read tools, one per Counsel sidebar section. These let
  // Bella answer "show me my pending signing requests", "who is
  // on the team", "list this week's billable time", etc. without
  // sending the user to the page.
  | 'list_clients'
  | 'get_client_detail'
  | 'list_team_members'
  | 'list_access_requests'
  | 'list_documents'
  | 'get_document_detail'
  | 'list_signing_requests'
  | 'list_leads'
  | 'list_referrals'
  | 'list_time_entries'
  | 'list_invoices'
  | 'list_trust_accounts'
  | 'list_trust_transactions'
  | 'get_trust_balance'
  // Tier 1 agentic tools - DO things on the firm's behalf, not just read.
  | 'get_document_text'
  | 'analyze_document'
  | 'global_search'
  | 'schedule_meeting'
  | 'post_intake_message'
  | 'generate_report';

const NAVIGATE_TOOL: Anthropic.Messages.Tool = {
  name: 'navigate_to',
  description:
    'Navigate the user to a route in the Advottic app. Path must start with "/" and be one of the documented routes. ALWAYS confirm with the user first if they have unsaved input on the current page.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'App route, must start with /',
      },
      reason: {
        type: 'string',
        description: 'One short sentence shown to the user before the navigation, e.g. "Opening the new case wizard."',
      },
    },
    required: ['path'],
  },
};

const SEARCH_CASES_TOOL: Anthropic.Messages.Tool = {
  name: 'search_my_cases',
  description:
    "Search the signed-in user's case files by partial title, subject name, jurisdiction, or case type. Returns up to `limit` matches with id, title, subject, status, jurisdiction, hearing date, and last updated. Use whenever the user asks about their cases.",
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional partial text to filter by. Empty string = list all cases.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 25,
        description: 'Maximum number of cases to return. Default 10.',
      },
    },
  },
};

const GET_CASE_DETAIL_TOOL: Anthropic.Messages.Tool = {
  name: 'get_case_detail',
  description:
    "Fetch full detail for one of the signed-in user's cases. Returns title, subject, jurisdiction, description, exhibit list (label + filename + category), and the latest Advottic Review summary if there is one.",
  input_schema: {
    type: 'object',
    properties: {
      case_id: {
        type: 'string',
        description: 'UUID of the case.',
      },
    },
    required: ['case_id'],
  },
};

const SEARCH_CASE_LAW_TOOL: Anthropic.Messages.Tool = {
  name: 'search_case_law',
  description:
    'Look up case law and judicial opinions via CourtListener (Free Law Project, free public access, federal + state coverage). ' +
    'Use to ground answers in actual citations when the user asks about precedent, asks "is there a case on X", or you would otherwise reach for a paid service like Westlaw / LexisNexis. ' +
    'Returns up to `limit` opinions with case name, citation, court, decision date, jurisdiction, a short snippet, and a public CourtListener URL Bella can link to. ' +
    'IMPORTANT - this is NOT a paid case-law database: results are public-domain opinions, do not include headnotes / KeyCite / Shepard\'s, and depth varies by jurisdiction. Always cite the URL so the user can read the source. Always remind the user to confirm the holding with a licensed attorney before relying on it.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Search query. Plain English works ("res ipsa loquitur dog bite"). Operators supported: quotes for phrases, AND/OR/NOT, fielded search like court:scotus or judge:"Sotomayor". Keep under 200 chars.',
      },
      jurisdiction: {
        type: 'string',
        description:
          'Optional jurisdiction filter. Use a CourtListener court id (e.g. "scotus" for SCOTUS, "ca9" for 9th Circuit, "minnctapp" for Minn Court of Appeals, "tex" for Texas Supreme). Omit for nationwide.',
      },
      date_after: {
        type: 'string',
        description: 'Optional ISO date (YYYY-MM-DD). Filters to opinions filed on or after this date.',
      },
      date_before: {
        type: 'string',
        description: 'Optional ISO date (YYYY-MM-DD). Filters to opinions filed on or before this date.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 10,
        description: 'Max opinions to return. Default 5; cap 10 to keep the response readable.',
      },
    },
    required: ['query'],
  },
};

const LIST_DOCUMENT_TEMPLATES_TOOL: Anthropic.Messages.Tool = {
  name: 'list_document_templates',
  description:
    "Return the menu of document templates Bella can draft from. Use whenever the user asks for help drafting a document, says 'can you write me a...', or you suspect they need a written document and you want to surface the choices. Each entry includes id, title, description, audience, and the inputs Bella should confirm before drafting.",
  input_schema: {
    type: 'object',
    properties: {},
  },
};

const DRAFT_DOCUMENT_TOOL: Anthropic.Messages.Tool = {
  name: 'draft_document',
  description:
    'Save a fully drafted document to the user\'s document store and return a link they can open. Bella drafts the document text in her response message based on the chosen template + the user\'s confirmed facts; THIS tool just persists the result. Always confirm the required inputs (from list_document_templates) with the user before calling. Always append the standard "starting draft, not legal advice" disclaimer block at the bottom. The fixed disclaimer text is in lib/document-templates.ts (DRAFT_DISCLAIMER) and Bella should include it verbatim in `content`. The Advottic surface where the document lands depends on context: in firm mode it goes into firm_documents with status="submitted"; in consumer mode it gets returned as a downloadable text and is saved to the user\'s drafts folder.',
  input_schema: {
    type: 'object',
    properties: {
      template_id: {
        type: 'string',
        description:
          'Template id from list_document_templates (eg. "demand_letter", "mutual_nda", "engagement_letter").',
      },
      title: {
        type: 'string',
        description:
          'Display title for the saved document (eg. "Demand letter to ACME for unpaid invoices").',
      },
      content: {
        type: 'string',
        description:
          'The fully drafted document text Bella has written, with all placeholders filled. Must end with the DRAFT_DISCLAIMER block verbatim.',
      },
      case_id: {
        type: 'string',
        description:
          "Optional UUID of the case this document attaches to. If the user is on a case page or asked Bella to draft from a specific case's facts, link it here.",
      },
    },
    required: ['template_id', 'title', 'content'],
  },
};

// ===========================================================================
// Practice-management tools (firm side). These operate on the live
// firm context; they no-op gracefully when called outside firm mode.
// ===========================================================================

const START_TIMER_TOOL: Anthropic.Messages.Tool = {
  name: 'start_timer',
  description:
    "Start a billable-time timer for the active firm. If the user has an open timer, that one is closed first (one-open-timer-per-user invariant). Use whenever the user says 'starting work on X', 'logging time on case Y', or before answering a substantive billable question. Returns the entry id and the timestamp it started at.",
  input_schema: {
    type: 'object',
    properties: {
      case_id: {
        type: 'string',
        description: 'Optional UUID of the case the work is on. If on a case page, infer it from context.',
      },
      description: {
        type: 'string',
        description: "One-line description of the work, eg. 'Drafted demand letter to ACME'.",
      },
    },
  },
};

const STOP_TIMER_TOOL: Anthropic.Messages.Tool = {
  name: 'stop_timer',
  description:
    'Stop the user\'s currently-open timer for the active firm. Records duration_seconds. Use when the user says they are done, switching tasks, or wrapping up.',
  input_schema: { type: 'object', properties: {} },
};

const ADD_DEADLINE_TOOL: Anthropic.Messages.Tool = {
  name: 'add_deadline',
  description:
    'Add a deadline to a case (firm side). Use whenever the user mentions a court date, a response due, an SOL, or an "by [date]" obligation. Always confirm the date with the user before calling - misread dates are common. The 90/30/7 day reminder cron fires automatically; you do not need to schedule that.',
  input_schema: {
    type: 'object',
    properties: {
      case_id: { type: 'string', description: 'UUID of the case.' },
      kind: {
        type: 'string',
        enum: [
          'statute_of_limitations',
          'response_due',
          'discovery_due',
          'motion_due',
          'hearing',
          'trial',
          'filing_deadline',
          'appeal',
          'custom',
        ],
      },
      title: { type: 'string', description: 'Short title (eg. "Answer due", "MTD opposition")' },
      due_at: {
        type: 'string',
        description: 'ISO-8601 datetime the deadline is due (eg. 2026-08-15T17:00:00-07:00).',
      },
      description: { type: 'string' },
    },
    required: ['case_id', 'kind', 'title', 'due_at'],
  },
};

const SUGGEST_SOL_TOOL: Anthropic.Messages.Tool = {
  name: 'suggest_sol',
  description:
    'Suggest a statute-of-limitations deadline date based on the accrual date, state, and claim type. Returns the suggested due_at + a "verify with counsel" reminder (tolling, discovery rule, repose, notice-of-claim, minor / disability extensions can shift this materially). Use when the user asks "when does the SOL run on X" or before adding an SOL deadline.',
  input_schema: {
    type: 'object',
    properties: {
      accrual_date: { type: 'string', description: 'ISO date the claim accrued (injury / breach / discovery).' },
      state: { type: 'string', description: 'Two-letter state code (CA, NY, TX, ...).' },
      claim_type: {
        type: 'string',
        enum: [
          'personal_injury',
          'property_damage',
          'breach_of_written_contract',
          'breach_of_oral_contract',
          'fraud',
          'wrongful_death',
          'employment_discrimination',
          'wage_hour',
          'libel_slander',
          'product_liability',
          'medical_malpractice',
          'legal_malpractice',
          'real_property',
          'collection',
        ],
      },
    },
    required: ['accrual_date', 'state', 'claim_type'],
  },
};

const RECORD_TRUST_TX_TOOL: Anthropic.Messages.Tool = {
  name: 'record_trust_transaction',
  description:
    'Post a transaction to the firm\'s trust ledger (IOLTA). Always confirm the amount + kind + client label with the user before calling. Negative balances on a client\'s sub-ledger are NEVER allowed; if you suspect this would create one, decline and ask.',
  input_schema: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'UUID of the firm trust account.' },
      client_label: {
        type: 'string',
        description: 'Client / matter label, eg. "Smith v. Acme - retainer".',
      },
      kind: {
        type: 'string',
        enum: [
          'deposit',
          'earned_fee_transfer',
          'disbursement',
          'refund',
          'bank_fee',
          'interest',
          'correction',
        ],
      },
      amount_cents: { type: 'integer', minimum: 1, description: 'Amount in cents. Always positive.' },
      description: { type: 'string' },
      reference: { type: 'string', description: 'Wire / check / Stripe reference for the audit trail.' },
      case_id: { type: 'string' },
    },
    required: ['account_id', 'client_label', 'kind', 'amount_cents'],
  },
};

const PROPOSE_INVOICE_TOOL: Anthropic.Messages.Tool = {
  name: 'propose_invoice',
  description:
    "Bundle every billable, completed time entry on a case that hasn't been invoiced yet into a draft invoice. Use when the user says 'draft an invoice for case X' or 'bill the time on Y'. Returns the invoice id; the operator still has to send it (Stripe payment link is generated then).",
  input_schema: {
    type: 'object',
    properties: {
      case_id: { type: 'string', description: 'UUID of the case.' },
      client_email: { type: 'string', description: 'Client email to address the invoice to.' },
      client_name: { type: 'string' },
    },
    required: ['case_id', 'client_email'],
  },
};

const CREATE_INTAKE_TOOL: Anthropic.Messages.Tool = {
  name: 'create_matter_intake',
  description:
    'Open a new matter intake with client + opposing party + matter type. Confirms the parties with the user first. After creation, ALWAYS run conflict check via run_conflict_check() so the operator sees hits before engaging.',
  input_schema: {
    type: 'object',
    properties: {
      client_name: { type: 'string' },
      client_email: { type: 'string' },
      client_phone: { type: 'string' },
      matter_type: { type: 'string' },
      matter_summary: { type: 'string' },
      jurisdiction_state: { type: 'string' },
      opposing_parties: { type: 'array', items: { type: 'string' } },
      related_parties: { type: 'array', items: { type: 'string' } },
    },
    required: ['client_name'],
  },
};

const RUN_CONFLICT_CHECK_TOOL: Anthropic.Messages.Tool = {
  name: 'run_conflict_check',
  description:
    'Run a conflict check on a matter intake. Returns the list of hits (existing client, prior opposing, prior related) with severity. The operator decides whether to clear with a written reason.',
  input_schema: {
    type: 'object',
    properties: {
      intake_id: { type: 'string' },
    },
    required: ['intake_id'],
  },
};

// ===========================================================================
// Firm-environment read tools. These mirror the firm dashboard's
// data envelope so Bella can answer "do I have a meeting today",
// "what's in my action center", "what's assigned to me" without
// guessing. Firm-only - they refuse in consumer / hq portal.
// ===========================================================================

const GET_FIRM_OVERVIEW_TOOL: Anthropic.Messages.Tool = {
  name: 'get_firm_overview',
  description:
    "Return a snapshot of the active firm's current state - the same data the /counsel dashboard shows. Use whenever the user asks 'what do I have today', 'what's in my action center', 'do I have any meetings', 'what needs attention', 'what's assigned to me', or any question about the firm's current environment. " +
    'Returns: counts (cases open/total, clients, pending signing, team), upcoming meetings (next 14 days), upcoming hearings + deadlines (next 30 days), intake lane counts + new-today count, clients + cases assigned to the current user, signing requests the user sent that are still out. ' +
    'Always call this BEFORE telling the user nothing is on their plate - the firm dashboard has the truth.',
  input_schema: {
    type: 'object',
    properties: {},
  },
};

const LIST_FIRM_MEETINGS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_firm_meetings',
  description:
    "List the firm's scheduled meetings (Teams / Zoom / in-person) within a date window. Use when the user asks about meetings further out than the default 14-day window in get_firm_overview, or wants to filter to a specific day / week.",
  input_schema: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description:
          'ISO date or datetime (inclusive). Default: now. Example: "2026-05-19" or "2026-05-19T00:00:00-05:00".',
      },
      to: {
        type: 'string',
        description:
          'ISO date or datetime (inclusive). Default: 30 days from now.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max meetings to return. Default 20.',
      },
    },
  },
};

const LIST_INTAKE_INBOX_TOOL: Anthropic.Messages.Tool = {
  name: 'list_intake_inbox',
  description:
    "List the firm's intake / request inbox items with their triage lane. Use when the user asks 'what's in my action center', 'what needs attention', 'what new requests came in', 'show me the intake queue'. Returns the same lane breakdown the /counsel/inbox page uses.",
  input_schema: {
    type: 'object',
    properties: {
      lane: {
        type: 'string',
        enum: ['needs_attention', 'in_review', 'accepted', 'closed', 'all'],
        description:
          'Filter to a lane. Default "all". needs_attention = untriaged matters; in_review = legal team is looking; accepted = engaged; closed = rejected.',
      },
      source: {
        type: 'string',
        enum: ['internal', 'external', 'all'],
        description:
          "Default 'all'. internal = filed by an employee from the Hub; external = outside-client matters.",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 15.',
      },
    },
  },
};

// ----- Deep-read tools, one per sidebar section ------------------------

const LIST_CLIENTS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_clients',
  description:
    "List the firm's clients with optional filters. Use for 'who are my clients', 'show me active clients', 'list my clients' (the ones I'm primary attorney on), 'find a client named ...'.",
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Partial name or email to filter on.',
      },
      status: {
        type: 'string',
        enum: ['active', 'invited', 'archived', 'all'],
        description: "Default 'all'.",
      },
      mine_only: {
        type: 'boolean',
        description:
          "When true, only clients where the current user is the primary attorney. Default false.",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 20.',
      },
    },
  },
};

const GET_CLIENT_DETAIL_TOOL: Anthropic.Messages.Tool = {
  name: 'get_client_detail',
  description:
    "Get one client's full record: contact info, primary attorney, joined date, count of cases linked, count of documents, recent signing activity. Use after list_clients narrows things down.",
  input_schema: {
    type: 'object',
    properties: {
      client_id: { type: 'string', description: 'firm_clients.id' },
    },
    required: ['client_id'],
  },
};

const LIST_TEAM_MEMBERS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_team_members',
  description:
    "List the firm's legal-team members (owners, admins, attorneys, paralegals, staff). Use for 'who is on my team', 'list the attorneys', 'who are the admins'.",
  input_schema: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        enum: ['owner', 'admin', 'attorney', 'paralegal', 'staff', 'all'],
        description: "Default 'all'.",
      },
    },
  },
};

const LIST_ACCESS_REQUESTS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_access_requests',
  description:
    "List external sign-up access requests waiting on admin review. Use for 'who's waiting on access', 'any new external sign-ups', 'show pending access requests'.",
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'approved', 'denied', 'all'],
        description: "Default 'pending'.",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 20.',
      },
    },
  },
};

const LIST_DOCUMENTS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_documents',
  description:
    "List documents in the firm vault. Filter by name, case, client, or status. Use for 'show me documents on case X', 'what documents are awaiting signature', 'find the NDA I uploaded last week'.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Partial name match.' },
      case_id: { type: 'string', description: 'Only documents on this case.' },
      client_user_id: {
        type: 'string',
        description: 'Only documents linked to this client user_id.',
      },
      status: {
        type: 'string',
        description:
          'firm_documents.status (received, submitted, ready, sent, pending, signed_internal, signed_client, on_hold, overdue, canceled).',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 15.',
      },
    },
  },
};

const GET_DOCUMENT_DETAIL_TOOL: Anthropic.Messages.Tool = {
  name: 'get_document_detail',
  description:
    "Get one document's full record: name, status, version, tags, linked case + client, uploader, due date, description.",
  input_schema: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'firm_documents.id' },
    },
    required: ['document_id'],
  },
};

const LIST_SIGNING_REQUESTS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_signing_requests',
  description:
    "List e-sign requests. Use for 'what signatures are out', 'show me pending signing', 'which requests have I sent that haven't been signed', 'completed signings'.",
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['sent', 'partial', 'completed', 'voided', 'all'],
        description: "Default 'all' (excludes nothing).",
      },
      mine_only: {
        type: 'boolean',
        description: 'When true, only requests the current user sent.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 15.',
      },
    },
  },
};

const LIST_LEADS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_leads',
  description:
    "List inbound marketplace leads from /find-counsel. Use for 'any new leads', 'show me leads from California', 'open leads'.",
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Lead status (new, contacted, qualified, declined, closed).',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 15.',
      },
    },
  },
};

const LIST_REFERRALS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_referrals',
  description:
    "List co-counsel referrals (matters referred to or from this firm, with proposed fee split). Use for 'show me referrals', 'any open referral offers', 'what fees are pending on referrals'.",
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Referral status filter.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 15.',
      },
    },
  },
};

const LIST_TIME_ENTRIES_TOOL: Anthropic.Messages.Tool = {
  name: 'list_time_entries',
  description:
    "List billable + non-billable time entries. Use for 'what have I logged today', 'time on case X', 'unbilled time across the firm'.",
  input_schema: {
    type: 'object',
    properties: {
      case_id: { type: 'string', description: 'Only entries on this case.' },
      mine_only: {
        type: 'boolean',
        description: 'When true, only the current user\'s entries.',
      },
      billable: {
        type: 'boolean',
        description: 'When set, only billable=true (true) or =false entries.',
      },
      uninvoiced: {
        type: 'boolean',
        description:
          'When true, only entries that haven\'t been rolled into an invoice yet.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 20.',
      },
    },
  },
};

const LIST_INVOICES_TOOL: Anthropic.Messages.Tool = {
  name: 'list_invoices',
  description:
    "List firm invoices. Use for 'open invoices', 'paid invoices last month', 'what's due', 'invoices for client X'.",
  input_schema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Invoice status (draft, sent, paid, overdue, voided).',
      },
      client_user_id: {
        type: 'string',
        description: 'Only invoices to this client.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 50,
        description: 'Max items. Default 15.',
      },
    },
  },
};

const LIST_TRUST_ACCOUNTS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_trust_accounts',
  description:
    "List the firm's IOLTA + non-IOLTA trust accounts. Use first when the user asks anything trust-related so you can resolve account_id for follow-up tools.",
  input_schema: { type: 'object', properties: {} },
};

const LIST_TRUST_TRANSACTIONS_TOOL: Anthropic.Messages.Tool = {
  name: 'list_trust_transactions',
  description:
    "List entries on the trust ledger. Use for 'recent trust activity', 'what came in this week', 'show transactions for client X'. amount_cents are signed (deposits positive, disbursements negative) so you can sum them for a balance.",
  input_schema: {
    type: 'object',
    properties: {
      account_id: { type: 'string', description: 'Filter to one trust account.' },
      client_label: {
        type: 'string',
        description: "Partial match on client_label (e.g. 'Smith v.').",
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Max items. Default 30.',
      },
    },
  },
};

const GET_TRUST_BALANCE_TOOL: Anthropic.Messages.Tool = {
  name: 'get_trust_balance',
  description:
    "Compute the current running balance on a trust account (sum of signed transaction amounts), and optionally per-client sub-balances. Use for 'what's my IOLTA balance', 'how much is in trust for client X'.",
  input_schema: {
    type: 'object',
    properties: {
      account_id: {
        type: 'string',
        description: 'Trust account id. If omitted, sums across all firm trust accounts.',
      },
    },
  },
};

// ----- Tier 1 agentic tools -------------------------------------------

const GET_DOCUMENT_TEXT_TOOL: Anthropic.Messages.Tool = {
  name: 'get_document_text',
  description:
    "Load a firm document and extract its plain text (PDF, DOCX, or text). Use to read a contract / motion / letter the user just asked about so you can summarize, quote, or analyze it. Returns the text plus the document's name, size, and tags. Cap on text length: the first ~30k chars are returned.",
  input_schema: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'firm_documents.id' },
    },
    required: ['document_id'],
  },
};

const ANALYZE_DOCUMENT_TOOL: Anthropic.Messages.Tool = {
  name: 'analyze_document',
  description:
    "Run a structured contract / document review on a firm document. Returns a scorecard: A-F grade, bias score 0-100 with direction, vulnerabilities list, state-law relevance, suggested revisions, plain summary. Use when the user asks 'review this NDA', 'how good is this contract', 'is this fair to us'. Calls scoreDocument internally - same engine the /counsel/analyze page uses.",
  input_schema: {
    type: 'object',
    properties: {
      document_id: { type: 'string', description: 'firm_documents.id' },
      focus: {
        type: 'string',
        description: 'Optional focus area: "favorability_to_firm" | "risk_to_client" | "negotiation_leverage". Default "favorability_to_firm".',
      },
    },
    required: ['document_id'],
  },
};

const GLOBAL_SEARCH_TOOL: Anthropic.Messages.Tool = {
  name: 'global_search',
  description:
    "Federated search across the firm: cases, clients, documents, intakes. Use when the user asks 'find everything related to X', 'show me all mentions of Smith', 'pull up anything about the vendor agreement'. Returns up to `limit` matches per type with id + a one-line label so follow-up tools (get_document_text, get_client_detail, get_case_detail) can drill in.",
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Partial text. Required. ilike-matched against the user-facing fields of each type.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 20,
        description: 'Max items per type. Default 5.',
      },
    },
    required: ['query'],
  },
};

const SCHEDULE_MEETING_TOOL: Anthropic.Messages.Tool = {
  name: 'schedule_meeting',
  description:
    "Schedule a Teams or Zoom meeting on the firm's connected calendar + email a single firm-branded invite to attendees. ALWAYS confirm the topic, start time, duration, and attendee list with the user in chat before calling. Persists to firm_meetings so the shared /counsel/calendar reflects it.",
  input_schema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'Meeting title.' },
      start_iso: {
        type: 'string',
        description: 'ISO-8601 datetime. Must be in the future.',
      },
      duration_min: {
        type: 'integer',
        minimum: 15,
        maximum: 480,
        description: 'Length in minutes. Default 30.',
      },
      attendee_emails: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of attendee email addresses. The organizer is added automatically.',
      },
      intake_id: {
        type: 'string',
        description: 'Optional intake to link this meeting to.',
      },
      provider: {
        type: 'string',
        enum: ['microsoft', 'zoom', 'auto'],
        description: "Default 'auto' - picks Teams if connected, else Zoom.",
      },
    },
    required: ['topic', 'start_iso'],
  },
};

const POST_INTAKE_MESSAGE_TOOL: Anthropic.Messages.Tool = {
  name: 'post_intake_message',
  description:
    "Post a message to an intake/request thread (the back-and-forth between the legal team and the requester). Use when the user asks Bella to reply, follow up, or message the requester. ALWAYS confirm the exact wording with the user before calling - this writes a visible message that the requester reads.",
  input_schema: {
    type: 'object',
    properties: {
      intake_id: { type: 'string', description: 'firm_matter_intakes.id' },
      body: { type: 'string', description: 'Message body. Max 4000 chars.' },
    },
    required: ['intake_id', 'body'],
  },
};

const GENERATE_REPORT_TOOL: Anthropic.Messages.Tool = {
  name: 'generate_report',
  description:
    "Produce a structured snapshot the user can quote, screenshot, or extend into a PDF. Use for 'give me a report on X', 'pull together a summary of Y'. Returns the underlying numbers / rows so you (the model) can render them as prose + tables in the chat. Available report kinds: cases_by_status, billable_time, intake_throughput, trust_balance_by_client, signing_pipeline, team_load. PDF/email rendering is a follow-up feature; for now the report's text in your reply IS the deliverable.",
  input_schema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: [
          'cases_by_status',
          'billable_time',
          'intake_throughput',
          'trust_balance_by_client',
          'signing_pipeline',
          'team_load',
        ],
        description: 'Which report to compute.',
      },
      window_days: {
        type: 'integer',
        minimum: 1,
        maximum: 365,
        description: "Look-back window in days. Default 30. Only used by reports that have a time dimension (billable_time, intake_throughput).",
      },
    },
    required: ['kind'],
  },
};

function toolsFor(mode: BellaMode): Anthropic.Messages.Tool[] {
  if (mode === 'authed') {
    return [
      NAVIGATE_TOOL,
      SEARCH_CASES_TOOL,
      GET_CASE_DETAIL_TOOL,
      SEARCH_CASE_LAW_TOOL,
      LIST_DOCUMENT_TEMPLATES_TOOL,
      DRAFT_DOCUMENT_TOOL,
      START_TIMER_TOOL,
      STOP_TIMER_TOOL,
      ADD_DEADLINE_TOOL,
      SUGGEST_SOL_TOOL,
      RECORD_TRUST_TX_TOOL,
      PROPOSE_INVOICE_TOOL,
      CREATE_INTAKE_TOOL,
      RUN_CONFLICT_CHECK_TOOL,
      // Firm-environment read tools. These refuse outside firm
      // portal (so a consumer-side Bella never sees them serving
      // firm data), but they're still part of the authed toolset
      // because the model can decide to call them and let the
      // server's portal guard answer.
      GET_FIRM_OVERVIEW_TOOL,
      LIST_FIRM_MEETINGS_TOOL,
      LIST_INTAKE_INBOX_TOOL,
      // Deep-read tools, one per sidebar section.
      LIST_CLIENTS_TOOL,
      GET_CLIENT_DETAIL_TOOL,
      LIST_TEAM_MEMBERS_TOOL,
      LIST_ACCESS_REQUESTS_TOOL,
      LIST_DOCUMENTS_TOOL,
      GET_DOCUMENT_DETAIL_TOOL,
      LIST_SIGNING_REQUESTS_TOOL,
      LIST_LEADS_TOOL,
      LIST_REFERRALS_TOOL,
      LIST_TIME_ENTRIES_TOOL,
      LIST_INVOICES_TOOL,
      LIST_TRUST_ACCOUNTS_TOOL,
      LIST_TRUST_TRANSACTIONS_TOOL,
      GET_TRUST_BALANCE_TOOL,
      // Tier 1 agentic - DO things.
      GET_DOCUMENT_TEXT_TOOL,
      ANALYZE_DOCUMENT_TOOL,
      GLOBAL_SEARCH_TOOL,
      SCHEDULE_MEETING_TOOL,
      POST_INTAKE_MESSAGE_TOOL,
      GENERATE_REPORT_TOOL,
    ];
  }
  if (mode === 'public') {
    // Public visitors can search case law too - it's a discovery
    // surface that helps them understand whether their situation has
    // legal precedent, without requiring a sign-up. Still no paid
    // database access; same disclaimer applies.
    return [NAVIGATE_TOOL, SEARCH_CASE_LAW_TOOL];
  }
  return []; // doc-review is one-shot, no tools
}

/**
 * Run a single Bella tool, returning a JSON-serializable result that
 * goes back to Claude as a tool_result. RLS scopes everything to the
 * current user (createServerSupabase reads cookies); on top of that,
 * the `portal` argument adds a firm-vs-consumer-vs-hq scope so a
 * user's personal cases never leak into a firm chat and vice versa.
 */
async function executeTool(
  name: ToolName,
  input: Record<string, unknown>,
  mode: BellaMode,
  portal: BellaPortal,
  firmId: string | null,
): Promise<unknown> {
  if (name === 'navigate_to') {
    const path = String(input.path ?? '').trim();
    if (!path.startsWith('/')) {
      return { ok: false, error: "Path must start with /" };
    }
    return { ok: true, navigated_to: path };
  }

  if (mode !== 'authed') {
    return { ok: false, error: 'This tool is only available for signed-in users.' };
  }

  if (name === 'search_my_cases') {
    // Portal scoping is the second line of defense after RLS. RLS
    // only checks that the user CAN see the row; portal scoping
    // makes sure we only return rows that belong to the surface
    // they're chatting from. Without this, a firm member who is
    // also a consumer Advottic user gets their personal cases
    // mixed into a firm-side search.
    if (portal === 'hq') {
      return {
        ok: false,
        error:
          'Case content is not accessible from HQ admin. Client case data is protected; ask about accounts, plans, or settings instead.',
      };
    }
    if (portal === 'firm' && !firmId) {
      return {
        ok: false,
        error:
          'No active firm context. Sign in to your firm workspace before searching firm matters.',
      };
    }
    const query = String(input.query ?? '').trim();
    const rawLimit = Number(input.limit ?? 10);
    const limit = Math.min(25, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 10));
    const supabase = createServerSupabase();
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Not signed in.' };
    let q = supabase
      .from('cases')
      .select('id, title, subject_name, subject_type, status, jurisdiction_country, jurisdiction_state, jurisdiction_city, case_type, hearing_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(limit);
    // Portal-scope filter (atop RLS).
    if (portal === 'firm') {
      q = q.eq('firm_id', firmId);
    } else {
      // consumer: explicitly only personal cases (firm_id IS NULL).
      // A user might also be a firm member but their firm cases are
      // off-limits from the consumer surface.
      q = q.is('firm_id', null);
    }
    if (query.length > 0) {
      const safe = escLikeNeedle(query);
      const pattern = `%${safe}%`;
      // ilike across the user-facing text columns. RLS already scopes
      // results to ones the user can see (own + collaborator).
      q = q.or(
        `title.ilike.${pattern},subject_name.ilike.${pattern},jurisdiction_country.ilike.${pattern},jurisdiction_state.ilike.${pattern},jurisdiction_city.ilike.${pattern},case_type.ilike.${pattern}`,
      );
    }
    const { data, error } = await q;
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as Array<{
      id: string;
      title: string;
      subject_name: string;
      subject_type: string;
      status: string;
      jurisdiction_country: string;
      jurisdiction_state: string | null;
      jurisdiction_city: string | null;
      case_type: string;
      hearing_at: string | null;
      updated_at: string;
    }>;
    return {
      ok: true,
      count: rows.length,
      cases: rows.map((r) => ({
        id: r.id,
        title: r.title,
        subject: r.subject_name,
        subject_type: r.subject_type,
        status: r.status,
        case_type: r.case_type,
        jurisdiction: [r.jurisdiction_city, r.jurisdiction_state, r.jurisdiction_country]
          .filter(Boolean)
          .join(', '),
        hearing_at: r.hearing_at,
        updated_at: r.updated_at,
      })),
    };
  }

  if (name === 'get_case_detail') {
    if (portal === 'hq') {
      return {
        ok: false,
        error:
          'Case content is not accessible from HQ admin. Client case data is protected.',
      };
    }
    if (portal === 'firm' && !firmId) {
      return {
        ok: false,
        error:
          'No active firm context. Sign in to your firm workspace first.',
      };
    }
    const caseId = String(input.case_id ?? '').trim();
    if (!caseId) return { ok: false, error: 'case_id is required.' };
    const supabase = createServerSupabase();
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Not signed in.' };
    // Portal-scope filter: this case must belong to the surface
    // the user is chatting from.
    let caseScopeQ = supabase
      .from('cases')
      .select('id, title, subject_name, subject_type, description, status, posture, jurisdiction_country, jurisdiction_state, jurisdiction_city, case_type, hearing_at, hearing_location, updated_at, firm_id')
      .eq('id', caseId);
    if (portal === 'firm') {
      caseScopeQ = caseScopeQ.eq('firm_id', firmId);
    } else {
      caseScopeQ = caseScopeQ.is('firm_id', null);
    }
    const [caseResp, exhibitsResp, reviewResp] = await Promise.all([
      caseScopeQ.maybeSingle(),
      supabase
        .from('exhibits')
        .select('id, label, file_name, file_type, category, source, incident_date, description')
        .eq('case_id', caseId)
        .order('uploaded_at', { ascending: true })
        .limit(50),
      supabase
        .from('ai_reviews')
        .select('summary, classification, created_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (caseResp.error) return { ok: false, error: caseResp.error.message };
    if (!caseResp.data) return { ok: false, error: 'Case not found or not visible to you.' };
    const c = caseResp.data as {
      id: string;
      title: string;
      subject_name: string;
      subject_type: string;
      description: string | null;
      status: string;
      posture: string;
      jurisdiction_country: string;
      jurisdiction_state: string | null;
      jurisdiction_city: string | null;
      case_type: string;
      hearing_at: string | null;
      hearing_location: string | null;
      updated_at: string;
    };
    return {
      ok: true,
      case: {
        id: c.id,
        title: c.title,
        subject: c.subject_name,
        subject_type: c.subject_type,
        description: c.description,
        status: c.status,
        posture: c.posture,
        case_type: c.case_type,
        jurisdiction: [c.jurisdiction_city, c.jurisdiction_state, c.jurisdiction_country]
          .filter(Boolean)
          .join(', '),
        hearing_at: c.hearing_at,
        hearing_location: c.hearing_location,
        updated_at: c.updated_at,
      },
      exhibits: ((exhibitsResp.data as Array<{
        label: string;
        file_name: string;
        file_type: string;
        category: string | null;
        source: string | null;
        incident_date: string | null;
        description: string | null;
      }> | null) ?? []).map((e) => ({
        label: e.label,
        file_name: e.file_name,
        file_type: e.file_type,
        category: e.category,
        source: e.source,
        incident_date: e.incident_date,
        description: e.description,
      })),
      latest_review: reviewResp.data
        ? {
            summary: (reviewResp.data as { summary: string | null }).summary,
            classification: (reviewResp.data as { classification: string | null }).classification,
            created_at: (reviewResp.data as { created_at: string }).created_at,
          }
        : null,
    };
  }

  if (name === 'search_case_law') {
    return await searchCourtListener(input);
  }

  // Below this point: firm-only tools. They operate on firm data
  // (time entries, deadlines, trust ledger, invoices, intakes,
  // meetings, action center). In any non-firm portal we refuse so
  // the consumer side and HQ admin side never accidentally talk to
  // firm machinery.
  const FIRM_ONLY: ReadonlySet<ToolName> = new Set([
    'start_timer',
    'stop_timer',
    'add_deadline',
    'record_trust_transaction',
    'propose_invoice',
    'create_matter_intake',
    'run_conflict_check',
    'get_firm_overview',
    'list_firm_meetings',
    'list_intake_inbox',
    'list_clients',
    'get_client_detail',
    'list_team_members',
    'list_access_requests',
    'list_documents',
    'get_document_detail',
    'list_signing_requests',
    'list_leads',
    'list_referrals',
    'list_time_entries',
    'list_invoices',
    'list_trust_accounts',
    'list_trust_transactions',
    'get_trust_balance',
    'get_document_text',
    'analyze_document',
    'global_search',
    'schedule_meeting',
    'post_intake_message',
    'generate_report',
  ]);
  if (FIRM_ONLY.has(name) && portal !== 'firm') {
    return {
      ok: false,
      error:
        portal === 'hq'
          ? 'Firm-side actions are not available from HQ admin.'
          : 'This action is only available inside a firm workspace. Switch to your enterprise login to use it.',
    };
  }

  if (name === 'get_firm_overview') {
    return await loadFirmOverview(firmId!);
  }

  if (name === 'list_firm_meetings') {
    return await loadFirmMeetings(firmId!, input);
  }

  if (name === 'list_intake_inbox') {
    return await loadIntakeInbox(firmId!, input);
  }

  if (name === 'list_clients') return await loadClients(firmId!, input);
  if (name === 'get_client_detail') return await loadClientDetail(firmId!, input);
  if (name === 'list_team_members') return await loadTeamMembers(firmId!, input);
  if (name === 'list_access_requests') return await loadAccessRequests(input);
  if (name === 'list_documents') return await loadDocuments(firmId!, input);
  if (name === 'get_document_detail') return await loadDocumentDetail(firmId!, input);
  if (name === 'list_signing_requests') return await loadSigningRequests(firmId!, input);
  if (name === 'list_leads') return await loadLeads(input);
  if (name === 'list_referrals') return await loadReferrals(firmId!, input);
  if (name === 'list_time_entries') return await loadTimeEntries(firmId!, input);
  if (name === 'list_invoices') return await loadInvoices(firmId!, input);
  if (name === 'list_trust_accounts') return await loadTrustAccounts(firmId!);
  if (name === 'list_trust_transactions') return await loadTrustTransactions(firmId!, input);
  if (name === 'get_trust_balance') return await loadTrustBalance(firmId!, input);
  if (name === 'get_document_text') return await loadDocumentText(firmId!, input);
  if (name === 'analyze_document') return await runAnalyzeDocument(firmId!, input);
  if (name === 'global_search') return await runGlobalSearch(firmId!, input);
  if (name === 'schedule_meeting') return await runScheduleMeeting(firmId!, input);
  if (name === 'post_intake_message') return await runPostIntakeMessage(firmId!, input);
  if (name === 'generate_report') return await runGenerateReport(firmId!, input);

  if (name === 'list_document_templates') {
    const { DOCUMENT_TEMPLATES, DRAFT_DISCLAIMER } = await import(
      './document-templates'
    );
    return {
      ok: true,
      templates: DOCUMENT_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        audience: t.audience,
        required_inputs: t.requiredInputs,
        skeleton: t.skeleton,
      })),
      disclaimer: DRAFT_DISCLAIMER,
      reminder:
        'Confirm the required_inputs with the user before drafting. After drafting, call draft_document with the full content (skeleton filled in + disclaimer appended).',
    };
  }

  if (name === 'draft_document') {
    return await saveDraftedDocument(input);
  }

  if (name === 'suggest_sol') {
    const { suggestSOL } = await import('./deadlines-data');
    const accrual = String(input.accrual_date ?? '').trim();
    const state = String(input.state ?? '').trim();
    const claimType = String(input.claim_type ?? '').trim();
    if (!accrual || !state || !claimType) {
      return { ok: false, error: 'accrual_date, state, claim_type are all required.' };
    }
    const result = suggestSOL(
      accrual,
      state,
      claimType as Parameters<typeof suggestSOL>[2],
    );
    return result
      ? { ok: true, ...result }
      : { ok: false, error: 'No SOL match for that combo.' };
  }

  if (name === 'start_timer') {
    const ctx = await getActiveFirmContextSafe();
    if (!ctx) return { ok: false, error: 'No active firm context.' };
    const { startTimerAction } = await import('./time-tracking');
    return await startTimerAction(ctx.firm.id, {
      caseId: input.case_id ? String(input.case_id) : null,
      description: input.description ? String(input.description) : null,
      source: 'bella',
    });
  }

  if (name === 'stop_timer') {
    const ctx = await getActiveFirmContextSafe();
    if (!ctx) return { ok: false, error: 'No active firm context.' };
    const { stopTimerAction } = await import('./time-tracking');
    return await stopTimerAction(ctx.firm.id);
  }

  if (name === 'add_deadline') {
    const ctx = await getActiveFirmContextSafe();
    const { addDeadlineAction } = await import('./deadlines-actions');
    return await addDeadlineAction(String(input.case_id ?? ''), {
      firmId: ctx?.firm.id ?? null,
      kind: String(input.kind ?? 'custom') as Parameters<typeof addDeadlineAction>[1]['kind'],
      title: String(input.title ?? ''),
      dueAt: String(input.due_at ?? ''),
      description: input.description ? String(input.description) : null,
    });
  }

  if (name === 'record_trust_transaction') {
    const ctx = await getActiveFirmContextSafe();
    if (!ctx) return { ok: false, error: 'No active firm context.' };
    const { recordTrustTransactionAction } = await import('./trust-accounting');
    const amount = Number(input.amount_cents ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, error: 'amount_cents must be a positive integer.' };
    }
    return await recordTrustTransactionAction(
      ctx.firm.id,
      String(input.account_id ?? ''),
      {
        clientLabel: String(input.client_label ?? ''),
        kind: String(input.kind ?? 'deposit') as Parameters<
          typeof recordTrustTransactionAction
        >[2]['kind'],
        amountCents: Math.round(amount),
        description: input.description ? String(input.description) : null,
        reference: input.reference ? String(input.reference) : null,
        caseId: input.case_id ? String(input.case_id) : null,
      },
    );
  }

  if (name === 'propose_invoice') {
    const ctx = await getActiveFirmContextSafe();
    if (!ctx) return { ok: false, error: 'No active firm context.' };
    const { buildDraftInvoiceAction } = await import('./invoicing');
    return await buildDraftInvoiceAction(
      ctx.firm.id,
      String(input.case_id ?? ''),
      String(input.client_email ?? '').trim().toLowerCase(),
      input.client_name ? String(input.client_name) : null,
    );
  }

  if (name === 'create_matter_intake') {
    const ctx = await getActiveFirmContextSafe();
    if (!ctx) return { ok: false, error: 'No active firm context.' };
    const { createMatterIntakeAction } = await import('./conflict-check');
    return await createMatterIntakeAction(ctx.firm.id, {
      clientName: String(input.client_name ?? ''),
      clientEmail: input.client_email ? String(input.client_email) : null,
      clientPhone: input.client_phone ? String(input.client_phone) : null,
      matterType: input.matter_type ? String(input.matter_type) : null,
      matterSummary: input.matter_summary ? String(input.matter_summary) : null,
      jurisdictionState: input.jurisdiction_state
        ? String(input.jurisdiction_state)
        : null,
      opposingParties: Array.isArray(input.opposing_parties)
        ? (input.opposing_parties as unknown[]).map(String)
        : [],
      relatedParties: Array.isArray(input.related_parties)
        ? (input.related_parties as unknown[]).map(String)
        : [],
    });
  }

  if (name === 'run_conflict_check') {
    const ctx = await getActiveFirmContextSafe();
    if (!ctx) return { ok: false, error: 'No active firm context.' };
    const { runConflictCheckAction } = await import('./conflict-check');
    return await runConflictCheckAction(ctx.firm.id, String(input.intake_id ?? ''));
  }

  return { ok: false, error: `Unknown tool: ${name}` };
}

async function getActiveFirmContextSafe() {
  try {
    const { getActiveFirmContext } = await import('./firm-storage');
    return await getActiveFirmContext();
  } catch {
    return null;
  }
}

/**
 * Persist a Bella-drafted document. In firm mode (the active firm
 * context resolves) we drop the document into the firm vault as a
 * regular firm_document with status="submitted" so an attorney can
 * review before sending. In consumer mode we stash a row in
 * user_drafts when the table is provisioned, otherwise return the
 * text inline so the user can copy / download it.
 */
async function saveDraftedDocument(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const templateId = String(input.template_id ?? '').trim();
  const title = String(input.title ?? '').trim();
  const content = String(input.content ?? '');
  const caseId = input.case_id ? String(input.case_id).trim() : null;

  if (!templateId || !title || !content) {
    return { ok: false, error: 'template_id, title, and content are required.' };
  }
  const { getTemplate, DRAFT_DISCLAIMER } = await import('./document-templates');
  const template = getTemplate(templateId);
  if (!template) {
    return { ok: false, error: `Unknown template_id: ${templateId}` };
  }
  // Defensive: make sure the disclaimer survived round-trips.
  const finalContent = content.includes('Drafted with Advottic')
    ? content
    : `${content.trimEnd()}\n\n${DRAFT_DISCLAIMER}\n`;

  const { getCurrentUser } = await import('./supabase/server');
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: true,
      saved: false,
      title,
      template_id: templateId,
      content: finalContent,
      message: 'No active session - returning the draft inline.',
    };
  }
  const { getActiveFirmContext } = await import('./firm-storage');
  const firmCtx = await getActiveFirmContext().catch(() => null);

  const { createAdminSupabase } = await import('./supabase/admin');
  const admin = createAdminSupabase();
  if (!admin) {
    return {
      ok: true,
      saved: false,
      title,
      template_id: templateId,
      content: finalContent,
      message:
        'Service role not configured - returning the draft inline.',
    };
  }

  // Firm mode: drop into firm_documents.
  if (firmCtx?.firm.id) {
    const id = crypto.randomUUID();
    const filePath = `${firmCtx.firm.id}/${id}/${title.slice(0, 80).replace(/[^a-zA-Z0-9.\-_ ]/g, '_')}.txt`;
    const buffer = Buffer.from(finalContent, 'utf8');
    const upload = await admin.storage
      .from('firm-documents')
      .upload(filePath, buffer, {
        contentType: 'text/plain; charset=utf-8',
        upsert: false,
      });
    if (upload.error) {
      return { ok: false, error: upload.error.message };
    }
    const { error: insertErr } = await admin.from('firm_documents').insert({
      id,
      firm_id: firmCtx.firm.id,
      name: `${title}.txt`,
      mime_type: 'text/plain',
      file_path: filePath,
      file_size: buffer.length,
      version: 1,
      uploaded_by: user.id,
      tags: ['bella-draft', template.id],
      case_id: caseId,
      status: 'submitted',
      description: `Drafted by Bella from template "${template.title}".`,
    });
    if (insertErr) {
      return { ok: false, error: insertErr.message };
    }
    return {
      ok: true,
      saved: true,
      surface: 'firm_documents',
      document_id: id,
      title,
      template_id: templateId,
      open_url: `/counsel/documents/${id}`,
      reminder:
        'The draft is saved with status "submitted". An attorney should review and edit before it leaves the firm.',
    };
  }

  // Consumer mode: try a user_drafts table; if it doesn't exist
  // yet, fall back to returning the text so the user can copy it.
  try {
    const { error } = await admin.from('user_drafts').insert({
      user_id: user.id,
      template_id: templateId,
      title,
      content: finalContent,
      case_id: caseId,
    });
    if (error) {
      return {
        ok: true,
        saved: false,
        title,
        template_id: templateId,
        content: finalContent,
        message:
          'Draft generated. Provision the user_drafts table to persist consumer-side drafts.',
      };
    }
    return {
      ok: true,
      saved: true,
      surface: 'user_drafts',
      title,
      template_id: templateId,
      open_url: '/inbox/drafts',
    };
  } catch (err) {
    return {
      ok: true,
      saved: false,
      title,
      template_id: templateId,
      content: finalContent,
      message: err instanceof Error ? err.message : 'Save failed; returning inline.',
    };
  }
}

/**
 * CourtListener / Free Law Project search. Free public-domain case
 * law - federal + most state opinions. No auth required for basic
 * search; we send the optional COURTLISTENER_API_TOKEN if present so
 * we get the per-token rate limit (5,000 req/hr) instead of the
 * anonymous one (5,000 req/day per IP). Token is set in
 * COURTLISTENER_API_TOKEN env var (server-only).
 *
 * API docs: https://www.courtlistener.com/help/api/rest/
 *
 * The shape we return to Bella is intentionally compact: she does
 * NOT need every snippet field, just enough to cite the case in a
 * one-paragraph answer with a link the user can click to read the
 * actual opinion.
 */
async function searchCourtListener(input: Record<string, unknown>) {
  const query = String(input.query ?? '').trim().slice(0, 200);
  if (!query) {
    return { ok: false, error: 'Empty query.' };
  }
  const rawLimit = Number(input.limit ?? 5);
  const limit = Math.min(10, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 5));
  const url = new URL('https://www.courtlistener.com/api/rest/v4/search/');
  url.searchParams.set('type', 'o'); // opinions
  url.searchParams.set('q', query);
  url.searchParams.set('order_by', 'score desc');
  url.searchParams.set('format', 'json');
  // CourtListener pages at 20 by default; we slice client-side to
  // keep the response small.
  const jurisdiction = String(input.jurisdiction ?? '').trim();
  if (jurisdiction) url.searchParams.set('court', jurisdiction);
  const dateAfter = String(input.date_after ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateAfter)) {
    url.searchParams.set('filed_after', dateAfter);
  }
  const dateBefore = String(input.date_before ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateBefore)) {
    url.searchParams.set('filed_before', dateBefore);
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Advottic-Bella/1.0 (https://advottic.com)',
  };
  const token = process.env.COURTLISTENER_API_TOKEN?.trim();
  if (token) headers.Authorization = `Token ${token}`;

  let res: Response;
  try {
    // Time-cap the call so a slow CourtListener response can't stall
    // a Bella turn. 6s is well above their typical p99 (~1.5s).
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6_000);
    res = await fetch(url.toString(), {
      headers,
      cache: 'no-store',
      signal: ctl.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    return {
      ok: false,
      error: `CourtListener request failed: ${err instanceof Error ? err.message : 'unknown'}.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: `CourtListener returned ${res.status}.`,
    };
  }

  type Result = {
    caseName?: string;
    citation?: string[] | string | null;
    court?: string | null;
    court_id?: string | null;
    dateFiled?: string | null;
    snippet?: string | null;
    absolute_url?: string | null;
    docket_id?: number | null;
    cluster_id?: number | null;
  };
  let body: { count?: number; results?: Result[] };
  try {
    body = (await res.json()) as { count?: number; results?: Result[] };
  } catch {
    return { ok: false, error: 'CourtListener returned non-JSON.' };
  }
  const results = (body.results ?? []).slice(0, limit).map((r) => {
    const citationArr = Array.isArray(r.citation)
      ? r.citation
      : r.citation
        ? [r.citation]
        : [];
    const url = r.absolute_url
      ? `https://www.courtlistener.com${r.absolute_url}`
      : null;
    // Strip CourtListener's <em>...</em> highlight markup from the
    // snippet so Bella's plain-text rendering doesn't show literal
    // tags. Cap the snippet at 320 chars to keep the tool result
    // small.
    const rawSnippet = (r.snippet ?? '').replace(/<\/?em>/g, '');
    const snippet = rawSnippet.length > 320
      ? rawSnippet.slice(0, 317) + '...'
      : rawSnippet;
    return {
      case_name: r.caseName ?? null,
      citation: citationArr.slice(0, 3),
      court: r.court ?? null,
      court_id: r.court_id ?? null,
      date_filed: r.dateFiled ?? null,
      snippet,
      url,
    };
  });

  return {
    ok: true,
    total_matches: body.count ?? results.length,
    returned: results.length,
    results,
    disclaimer:
      'CourtListener is a free public-domain database (Free Law Project). Coverage and depth vary by jurisdiction; this is not Westlaw / LexisNexis / Bloomberg Law and does not include headnotes, KeyCite signals, or Shepard\'s. Always confirm the holding and current validity with a licensed attorney before relying on it.',
  };
}

// ===========================================================================
// Firm-environment data loaders. Mirror the queries used by
// app/counsel/page.tsx so Bella sees exactly what the dashboard
// shows. All three require a verified firm portal (the executeTool
// FIRM_ONLY guard ensures portal === 'firm' before they run); each
// uses the user-scoped server client so RLS still applies on top.
// ===========================================================================

async function loadFirmOverview(
  firmId: string,
): Promise<Record<string, unknown>> {
  // Use the admin (service role) client for these reads. The
  // user-scoped client is filtered by RLS, and several firm-side
  // tables either have no member-select policy (firm_meetings) or
  // are admin-only-select (firm_invitations). That made Bella
  // confidently report "no meetings" while the calendar page,
  // which uses the admin client, showed the same firm had two on
  // the agenda. The firmId we get here is already validated at the
  // route layer (portal='firm' requires the user to be a member of
  // this firm), so the admin client is safe - we are not bypassing
  // a scope check, we are matching the existing pattern that every
  // server-rendered firm page uses.
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const supabase = createAdminSupabase();
  if (!supabase) {
    return { ok: false, error: 'Service role not configured on this deployment.' };
  }

  const horizon = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const meetingsUpper = new Date(
    Date.now() + 14 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const deadlinesUpper = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;

  const [
    casesResp,
    clientsResp,
    membersResp,
    invitationsResp,
    signingResp,
    intakeResp,
    meetingsResp,
    deadlinesResp,
  ] = await Promise.all([
    supabase
      .from('cases')
      .select('id, title, status, user_id')
      .eq('firm_id', firmId),
    supabase
      .from('firm_clients')
      .select('id, user_id, primary_attorney_id, status, display_name, email')
      .eq('firm_id', firmId),
    supabase
      .from('firm_members')
      .select('id, role')
      .eq('firm_id', firmId),
    supabase
      .from('firm_invitations')
      .select('id, status')
      .eq('firm_id', firmId)
      .eq('status', 'pending'),
    supabase
      .from('firm_signing_requests')
      .select('id, status, requested_by, document_id, created_at')
      .eq('firm_id', firmId)
      .in('status', ['sent', 'partial']),
    supabase
      .from('firm_matter_intakes')
      .select('id, client_name, matter_type, status, created_at, intake_answers')
      .eq('firm_id', firmId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('firm_meetings')
      .select('id, topic, provider, start_at, duration_min, join_url')
      .eq('firm_id', firmId)
      .gte('start_at', horizon)
      .lte('start_at', meetingsUpper)
      .order('start_at', { ascending: true })
      .limit(10),
    supabase
      .from('case_deadlines')
      .select('id, title, kind, due_at, case_id')
      .eq('firm_id', firmId)
      .is('completed_at', null)
      .gte('due_at', horizon)
      .lte('due_at', deadlinesUpper)
      .order('due_at', { ascending: true })
      .limit(10),
  ]);

  type CaseRow = { id: string; title: string; status: string; user_id: string | null };
  type ClientRow = {
    id: string;
    user_id: string;
    primary_attorney_id: string | null;
    status: string;
    display_name: string | null;
    email: string | null;
  };
  type MemberRow = { id: string; role: string };
  type InviteRow = { id: string };
  type SigningRow = {
    id: string;
    status: string;
    requested_by: string;
    document_id: string;
    created_at: string;
  };
  type IntakeRow = {
    id: string;
    client_name: string | null;
    matter_type: string | null;
    status: string;
    created_at: string;
    intake_answers: Record<string, unknown> | null;
  };
  type MeetingRow = {
    id: string;
    topic: string;
    provider: string;
    start_at: string;
    duration_min: number | null;
    join_url: string | null;
  };
  type DeadlineRow = {
    id: string;
    title: string;
    kind: string;
    due_at: string;
    case_id: string | null;
  };

  const cases = (casesResp.data ?? []) as CaseRow[];
  const clients = (clientsResp.data ?? []) as ClientRow[];
  const members = (membersResp.data ?? []) as MemberRow[];
  const invitations = (invitationsResp.data ?? []) as InviteRow[];
  const signing = (signingResp.data ?? []) as SigningRow[];
  const intakes = (intakeResp.data ?? []) as IntakeRow[];
  const meetings = (meetingsResp.data ?? []) as MeetingRow[];
  const deadlines = (deadlinesResp.data ?? []) as DeadlineRow[];

  const openCaseStatuses = new Set([
    'open',
    'under_review',
    'needs_evidence',
    'export_ready',
  ]);
  const casesOpen = cases.filter((c) => openCaseStatuses.has(c.status)).length;

  // Intake lanes
  const lanes = { needs_attention: 0, in_review: 0, accepted: 0, closed: 0 };
  let newToday = 0;
  for (const i of intakes) {
    if (i.status === 'engaged' || i.status === 'accepted') lanes.accepted += 1;
    else if (i.status === 'rejected') lanes.closed += 1;
    else if (i.status === 'in_review') lanes.in_review += 1;
    else lanes.needs_attention += 1;
    if (new Date(i.created_at).getTime() >= sinceMs) newToday += 1;
  }
  const recentNew = intakes.slice(0, 5).map((i) => ({
    id: i.id,
    client_name: i.client_name ?? 'Unnamed matter',
    matter_type: i.matter_type,
    created_at: i.created_at,
    is_internal:
      String((i.intake_answers ?? {}).submitted_by ?? '').trim().length > 0,
  }));

  // Assigned to me: clients where primary_attorney_id == user.id +
  // the firm cases linked to those clients via cases.user_id.
  const myClients = clients.filter((c) => c.primary_attorney_id === user.id);
  const myClientUserIds = new Set(myClients.map((c) => c.user_id));
  const myCases = cases.filter(
    (c) => c.user_id && myClientUserIds.has(c.user_id),
  );

  // Signing requests I created that are still out
  const mySigningOpen = signing.filter((s) => s.requested_by === user.id);

  return {
    ok: true,
    firm_id: firmId,
    counts: {
      cases_open: casesOpen,
      cases_total: cases.length,
      clients: clients.length,
      clients_active: clients.filter((c) => c.status === 'active').length,
      members: members.length,
      invitations_pending: invitations.length,
      signing_pending: signing.length,
    },
    intake: {
      needs_attention: lanes.needs_attention,
      in_review: lanes.in_review,
      accepted: lanes.accepted,
      closed: lanes.closed,
      new_today: newToday,
      recent: recentNew,
    },
    assigned_to_me: {
      clients: myClients.slice(0, 10).map((c) => ({
        id: c.id,
        display_name: c.display_name ?? c.email ?? 'Unnamed client',
        status: c.status,
      })),
      cases: myCases.slice(0, 10).map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
      })),
      signing_awaiting: mySigningOpen.slice(0, 10).map((s) => ({
        id: s.id,
        document_id: s.document_id,
        created_at: s.created_at,
      })),
    },
    upcoming_meetings: meetings.map((m) => ({
      id: m.id,
      topic: m.topic,
      provider: m.provider,
      start_at: m.start_at,
      duration_min: m.duration_min,
      join_url: m.join_url,
    })),
    upcoming_deadlines: deadlines.map((d) => ({
      id: d.id,
      title: d.title,
      kind: d.kind,
      due_at: d.due_at,
      case_id: d.case_id,
    })),
    hint: 'Use this snapshot to answer questions about meetings, action center, and assignments. Counts of zero are accurate - if upcoming_meetings is empty, the user has no meetings in the next 14 days.',
  };
}

async function loadFirmMeetings(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Admin client - see comment on loadFirmOverview. firm_meetings
  // has no RLS member-select policy, so the user-scoped client
  // returns zero rows.
  const supabase = createAdminSupabase();
  if (!supabase) {
    return { ok: false, error: 'Service role not configured on this deployment.' };
  }
  const fromStr = String(input.from ?? '').trim();
  const toStr = String(input.to ?? '').trim();
  const rawLimit = Number(input.limit ?? 20);
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));

  const from = fromStr
    ? new Date(fromStr).toISOString()
    : new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const to = toStr
    ? new Date(toStr).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('firm_meetings')
    .select(
      'id, topic, provider, start_at, duration_min, join_url, intake_id',
    )
    .eq('firm_id', firmId)
    .gte('start_at', from)
    .lte('start_at', to)
    .order('start_at', { ascending: true })
    .limit(limit);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    count: data?.length ?? 0,
    window: { from, to },
    meetings: (data ?? []).map((m) => ({
      id: (m as { id: string }).id,
      topic: (m as { topic: string }).topic,
      provider: (m as { provider: string }).provider,
      start_at: (m as { start_at: string }).start_at,
      duration_min: (m as { duration_min: number | null }).duration_min,
      join_url: (m as { join_url: string | null }).join_url,
      intake_id: (m as { intake_id: string | null }).intake_id,
    })),
  };
}

async function loadIntakeInbox(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Admin client - see comment on loadFirmOverview. Consistent
  // with how the /counsel/inbox page already reads this table.
  const supabase = createAdminSupabase();
  if (!supabase) {
    return { ok: false, error: 'Service role not configured on this deployment.' };
  }
  const lane = String(input.lane ?? 'all').trim();
  const source = String(input.source ?? 'all').trim();
  const rawLimit = Number(input.limit ?? 15);
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 15));

  let q = supabase
    .from('firm_matter_intakes')
    .select(
      'id, client_name, matter_type, status, created_at, intake_answers',
    )
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 2, 30)); // overscan for client-side lane filter

  // Status -> lane mapping.
  if (lane === 'accepted') {
    q = q.in('status', ['accepted', 'engaged']);
  } else if (lane === 'closed') {
    q = q.eq('status', 'rejected');
  } else if (lane === 'in_review') {
    q = q.eq('status', 'in_review');
  } else if (lane === 'needs_attention') {
    // Anything that isn't engaged/accepted/in_review/rejected.
    q = q.not('status', 'in', '(engaged,accepted,in_review,rejected)');
  }

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  type Row = {
    id: string;
    client_name: string | null;
    matter_type: string | null;
    status: string;
    created_at: string;
    intake_answers: Record<string, unknown> | null;
  };
  let rows = (data ?? []) as Row[];

  if (source !== 'all') {
    rows = rows.filter((r) => {
      const isInternal =
        String((r.intake_answers ?? {}).submitted_by ?? '').trim().length > 0;
      return source === 'internal' ? isInternal : !isInternal;
    });
  }
  rows = rows.slice(0, limit);

  return {
    ok: true,
    count: rows.length,
    lane,
    source,
    items: rows.map((r) => ({
      id: r.id,
      client_name: r.client_name ?? 'Unnamed matter',
      matter_type: r.matter_type,
      status: r.status,
      created_at: r.created_at,
      is_internal:
        String((r.intake_answers ?? {}).submitted_by ?? '').trim().length > 0,
    })),
  };
}

// ===========================================================================
// Deep-read loaders, one per Counsel sidebar section. All use the
// admin (service-role) client - the firmId is already verified at
// the route layer via portal='firm', so we are matching the same
// pattern every server-rendered firm page uses.
// ===========================================================================

async function loadClients(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const user = await getCurrentUser();
  const query = String(input.query ?? '').trim();
  const status = String(input.status ?? 'all').trim();
  const mineOnly = Boolean(input.mine_only);
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));

  let q = supabase
    .from('firm_clients')
    .select('id, user_id, primary_attorney_id, status, joined_at')
    .eq('firm_id', firmId)
    .order('joined_at', { ascending: false })
    .limit(limit);
  if (status !== 'all') q = q.eq('status', status);
  if (mineOnly && user) q = q.eq('primary_attorney_id', user.id);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Array<{
    id: string;
    user_id: string;
    primary_attorney_id: string | null;
    status: string;
    joined_at: string;
  }>;

  // Hydrate display names / emails from auth.users (firm_clients
  // doesn't store them itself). Best-effort - if any single lookup
  // fails we just fall back to "Unknown".
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const userInfo = new Map<string, { email: string | null; name: string | null }>();
  for (const id of userIds) {
    try {
      const { data: u } = await supabase.auth.admin.getUserById(id);
      const email = u?.user?.email ?? null;
      const name = (u?.user?.user_metadata as { full_name?: string } | null)
        ?.full_name ?? null;
      userInfo.set(id, { email, name });
    } catch {
      userInfo.set(id, { email: null, name: null });
    }
  }

  let hydrated = rows.map((r) => {
    const u = userInfo.get(r.user_id);
    return {
      id: r.id,
      user_id: r.user_id,
      display_name: u?.name ?? null,
      email: u?.email ?? null,
      primary_attorney_id: r.primary_attorney_id,
      status: r.status,
      joined_at: r.joined_at,
    };
  });

  if (query.length > 0) {
    const needle = query.toLowerCase();
    hydrated = hydrated.filter(
      (c) =>
        (c.display_name?.toLowerCase() ?? '').includes(needle) ||
        (c.email?.toLowerCase() ?? '').includes(needle),
    );
  }

  return { ok: true, count: hydrated.length, clients: hydrated };
}

async function loadClientDetail(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const clientId = String(input.client_id ?? '').trim();
  if (!clientId) return { ok: false, error: 'client_id is required.' };
  const { data, error } = await supabase
    .from('firm_clients')
    .select('id, user_id, primary_attorney_id, status, joined_at, invited_by')
    .eq('id', clientId)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Client not found in this firm.' };
  const row = data as {
    id: string;
    user_id: string;
    primary_attorney_id: string | null;
    status: string;
    joined_at: string;
    invited_by: string | null;
  };

  let email: string | null = null;
  let displayName: string | null = null;
  try {
    const { data: u } = await supabase.auth.admin.getUserById(row.user_id);
    email = u?.user?.email ?? null;
    displayName = (u?.user?.user_metadata as { full_name?: string } | null)
      ?.full_name ?? null;
  } catch { /* keep nulls */ }

  // Linked cases (via cases.user_id == client.user_id, firm-scoped).
  const { data: casesData } = await supabase
    .from('cases')
    .select('id, title, status')
    .eq('firm_id', firmId)
    .eq('user_id', row.user_id);
  const cases = (casesData ?? []) as Array<{
    id: string; title: string; status: string;
  }>;

  // Documents linked to this client.
  const { count: docCount } = await supabase
    .from('firm_documents')
    .select('id', { count: 'exact', head: true })
    .eq('firm_id', firmId)
    .eq('client_user_id', row.user_id)
    .is('archived_at', null);

  return {
    ok: true,
    client: {
      id: row.id,
      user_id: row.user_id,
      display_name: displayName,
      email,
      status: row.status,
      joined_at: row.joined_at,
      primary_attorney_id: row.primary_attorney_id,
      invited_by: row.invited_by,
      cases_count: cases.length,
      cases: cases.slice(0, 10),
      documents_count: docCount ?? 0,
    },
  };
}

async function loadTeamMembers(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const role = String(input.role ?? 'all').trim();
  let q = supabase
    .from('firm_members')
    .select('id, user_id, role, display_name, joined_at, default_rate_cents')
    .eq('firm_id', firmId)
    .order('joined_at', { ascending: true });
  if (role !== 'all') q = q.eq('role', role);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Array<{
    id: string;
    user_id: string;
    role: string;
    display_name: string | null;
    joined_at: string;
    default_rate_cents: number | null;
  }>;

  // Hydrate emails from auth.
  const hydrated: Array<Record<string, unknown>> = [];
  for (const r of rows) {
    let email: string | null = null;
    try {
      const { data: u } = await supabase.auth.admin.getUserById(r.user_id);
      email = u?.user?.email ?? null;
    } catch { /* keep null */ }
    hydrated.push({
      id: r.id,
      user_id: r.user_id,
      display_name: r.display_name,
      email,
      role: r.role,
      joined_at: r.joined_at,
      default_rate_cents: r.default_rate_cents,
    });
  }
  return { ok: true, count: hydrated.length, members: hydrated };
}

async function loadAccessRequests(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const status = String(input.status ?? 'pending').trim();
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
  let q = supabase
    .from('firm_access_requests')
    .select('id, organization_name, contact_name, contact_email, contact_role, firm_type, team_size, jurisdictions, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data ?? []).length, requests: data ?? [] };
}

async function loadDocuments(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const query = String(input.query ?? '').trim();
  const caseId = String(input.case_id ?? '').trim();
  const clientUserId = String(input.client_user_id ?? '').trim();
  const status = String(input.status ?? '').trim();
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 15));
  let q = supabase
    .from('firm_documents')
    .select('id, name, mime_type, file_size, status, case_id, client_user_id, tags, uploaded_at, uploaded_by, due_at')
    .eq('firm_id', firmId)
    .is('archived_at', null)
    .order('uploaded_at', { ascending: false })
    .limit(limit);
  if (caseId) q = q.eq('case_id', caseId);
  if (clientUserId) q = q.eq('client_user_id', clientUserId);
  if (status) q = q.eq('status', status);
  if (query.length > 0) {
    const safe = escLikeNeedle(query);
    q = q.ilike('name', `%${safe}%`);
  }
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data ?? []).length, documents: data ?? [] };
}

async function loadDocumentDetail(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const id = String(input.document_id ?? '').trim();
  if (!id) return { ok: false, error: 'document_id is required.' };
  const { data, error } = await supabase
    .from('firm_documents')
    .select('*')
    .eq('id', id)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'Document not found in this firm.' };
  return { ok: true, document: data };
}

async function loadSigningRequests(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const user = await getCurrentUser();
  const status = String(input.status ?? 'all').trim();
  const mineOnly = Boolean(input.mine_only);
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 15));
  let q = supabase
    .from('firm_signing_requests')
    .select('id, document_id, status, requested_by, message, sent_at, completed_at, created_at')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status !== 'all') q = q.eq('status', status);
  if (mineOnly && user) q = q.eq('requested_by', user.id);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Array<{
    id: string;
    document_id: string;
    status: string;
    requested_by: string;
    message: string | null;
    sent_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>;
  const docIds = Array.from(new Set(rows.map((r) => r.document_id)));
  const docNames = new Map<string, string>();
  if (docIds.length > 0) {
    const { data: docs } = await supabase
      .from('firm_documents')
      .select('id, name')
      .in('id', docIds);
    for (const d of (docs ?? []) as Array<{ id: string; name: string }>) {
      docNames.set(d.id, d.name);
    }
  }
  return {
    ok: true,
    count: rows.length,
    signing_requests: rows.map((r) => ({
      ...r,
      document_name: docNames.get(r.document_id) ?? null,
    })),
  };
}

async function loadLeads(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const status = String(input.status ?? '').trim();
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 15));
  let q = supabase
    .from('firm_leads')
    .select('id, contact_name, contact_email, contact_phone, jurisdiction_state, jurisdiction_city, practice_areas, summary, budget, urgency, status, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data ?? []).length, leads: data ?? [] };
}

async function loadReferrals(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const status = String(input.status ?? '').trim();
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 15));
  let q = supabase
    .from('cocounsel_referrals')
    .select('id, referring_firm_id, referred_firm_id, case_id, matter_summary, proposed_split_percent, state, status, total_fee_cents, created_at')
    .or(`referring_firm_id.eq.${firmId},referred_firm_id.eq.${firmId}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const rows = (data ?? []) as Array<{
    referring_firm_id: string;
    referred_firm_id: string;
  } & Record<string, unknown>>;
  return {
    ok: true,
    count: rows.length,
    referrals: rows.map((r) => ({
      ...r,
      direction: r.referring_firm_id === firmId ? 'outgoing' : 'incoming',
    })),
  };
}

async function loadTimeEntries(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const user = await getCurrentUser();
  const caseId = String(input.case_id ?? '').trim();
  const mineOnly = Boolean(input.mine_only);
  const uninvoiced = Boolean(input.uninvoiced);
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
  let q = supabase
    .from('firm_time_entries')
    .select('id, user_id, case_id, document_id, description, started_at, ended_at, duration_seconds, billable, rate_cents, invoice_id, source, created_at')
    .eq('firm_id', firmId)
    .order('started_at', { ascending: false })
    .limit(limit);
  if (caseId) q = q.eq('case_id', caseId);
  if (mineOnly && user) q = q.eq('user_id', user.id);
  if (typeof input.billable === 'boolean') q = q.eq('billable', input.billable as boolean);
  if (uninvoiced) q = q.is('invoice_id', null);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data ?? []).length, time_entries: data ?? [] };
}

async function loadInvoices(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const status = String(input.status ?? '').trim();
  const clientUserId = String(input.client_user_id ?? '').trim();
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 15));
  let q = supabase
    .from('firm_invoices')
    .select('id, number, case_id, client_user_id, client_email, client_name, status, subtotal_cents, tax_cents, total_cents, currency, due_at, sent_at, paid_at, created_at')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  if (clientUserId) q = q.eq('client_user_id', clientUserId);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data ?? []).length, invoices: data ?? [] };
}

async function loadTrustAccounts(
  firmId: string,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const { data, error } = await supabase
    .from('firm_trust_accounts')
    .select('id, name, bank_name, account_number_masked, is_iolta, state, bar_foundation, created_at')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data ?? []).length, trust_accounts: data ?? [] };
}

async function loadTrustTransactions(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const accountId = String(input.account_id ?? '').trim();
  const clientLabel = String(input.client_label ?? '').trim();
  const limit = Math.min(100, Math.max(1, Number(input.limit) || 30));
  let q = supabase
    .from('firm_trust_transactions')
    .select('id, account_id, case_id, client_user_id, client_label, kind, amount_cents, description, reference, bank_statement_date, created_at')
    .eq('firm_id', firmId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (accountId) q = q.eq('account_id', accountId);
  if (clientLabel) {
    const safe = escLikeNeedle(clientLabel);
    q = q.ilike('client_label', `%${safe}%`);
  }
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, count: (data ?? []).length, transactions: data ?? [] };
}

async function loadTrustBalance(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const accountId = String(input.account_id ?? '').trim();
  let q = supabase
    .from('firm_trust_transactions')
    .select('account_id, client_label, kind, amount_cents')
    .eq('firm_id', firmId);
  if (accountId) q = q.eq('account_id', accountId);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  // amount_cents is unsigned in the table; the SIGN comes from the
  // kind (deposits/refunds/interest add; transfers/disbursements/
  // fees subtract). Matches lib/trust-accounting's sign logic.
  const positive = new Set(['deposit', 'refund', 'interest']);
  let total = 0;
  const perAccount = new Map<string, number>();
  const perClient = new Map<string, number>();
  for (const r of (data ?? []) as Array<{
    account_id: string;
    client_label: string | null;
    kind: string;
    amount_cents: number;
  }>) {
    const signed = positive.has(r.kind) ? r.amount_cents : -r.amount_cents;
    total += signed;
    perAccount.set(r.account_id, (perAccount.get(r.account_id) ?? 0) + signed);
    if (r.client_label) {
      const key = r.client_label;
      perClient.set(key, (perClient.get(key) ?? 0) + signed);
    }
  }
  return {
    ok: true,
    account_id_filter: accountId || null,
    total_balance_cents: total,
    per_account: Object.fromEntries(perAccount),
    per_client: Object.fromEntries(perClient),
    hint: 'Amounts are in cents. Negative balances should never happen on a per-client sub-ledger; surface any you see to the user.',
  };
}

// ===========================================================================
// Tier 1 agentic loaders. These DO things on the firm's behalf -
// read a document, search across surfaces, schedule a meeting, post
// a message, generate a report. All firm-only (FIRM_ONLY guard) and
// service-role-write where required.
// ===========================================================================

const DOC_TEXT_MAX = 30_000;

async function loadDocumentText(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const id = String(input.document_id ?? '').trim();
  if (!id) return { ok: false, error: 'document_id is required.' };
  const { data: doc, error: docErr } = await supabase
    .from('firm_documents')
    .select('id, name, mime_type, file_path, file_size, tags, case_id, client_user_id')
    .eq('id', id)
    .eq('firm_id', firmId)
    .maybeSingle();
  if (docErr) return { ok: false, error: docErr.message };
  if (!doc) return { ok: false, error: 'Document not found in this firm.' };
  const d = doc as {
    id: string;
    name: string;
    mime_type: string;
    file_path: string;
    file_size: number;
    tags: string[] | null;
    case_id: string | null;
    client_user_id: string | null;
  };

  // Download from storage and route to the right extractor by mime.
  const dl = await supabase.storage.from('firm-documents').download(d.file_path);
  if (dl.error || !dl.data) {
    return { ok: false, error: `Could not load file: ${dl.error?.message ?? 'unknown'}.` };
  }
  const ab = await dl.data.arrayBuffer();
  const buf = Buffer.from(ab);
  let text = '';
  let kind = 'unknown';
  try {
    const name = d.name.toLowerCase();
    const mime = (d.mime_type || '').toLowerCase();
    if (name.endsWith('.pdf') || mime.includes('pdf')) {
      const { getDocumentProxy, extractText } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const res = await extractText(pdf, { mergePages: true });
      text = Array.isArray(res.text) ? res.text.join('\n') : String(res.text ?? '');
      kind = 'pdf';
    } else if (
      name.endsWith('.docx') ||
      mime.includes('officedocument.wordprocessing')
    ) {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: buf });
      text = value ?? '';
      kind = 'docx';
    } else if (mime.startsWith('text/') || name.endsWith('.txt')) {
      text = buf.toString('utf8');
      kind = 'text';
    } else {
      return {
        ok: false,
        error:
          'Unsupported file type. Bella can only read PDF, DOCX, and text files.',
      };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Could not extract text: ${err instanceof Error ? err.message : 'unknown'}.`,
    };
  }

  const truncated = text.length > DOC_TEXT_MAX;
  return {
    ok: true,
    document: {
      id: d.id,
      name: d.name,
      mime_type: d.mime_type,
      file_size: d.file_size,
      tags: d.tags ?? [],
      case_id: d.case_id,
      client_user_id: d.client_user_id,
    },
    kind,
    chars: text.length,
    truncated,
    text: truncated ? text.slice(0, DOC_TEXT_MAX) : text,
  };
}

async function runAnalyzeDocument(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Load the text first - reuse loadDocumentText. Pass through any
  // error so the model sees what went wrong.
  const got = await loadDocumentText(firmId, input);
  if (!got.ok) return got;
  const text = String((got as { text?: string }).text ?? '');
  if (text.trim().length === 0) {
    return { ok: false, error: 'The document had no readable text.' };
  }
  const focus = String(input.focus ?? 'favorability_to_firm').trim();
  try {
    const { scoreDocument } = await import('./doc-review');
    const card = await scoreDocument({
      text,
      matterType: focus,
    });
    return {
      ok: true,
      document: (got as { document?: unknown }).document,
      focus,
      scorecard: card,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Scoring failed: ${err instanceof Error ? err.message : 'unknown'}.`,
    };
  }
}

async function runGlobalSearch(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const queryRaw = String(input.query ?? '').trim();
  if (!queryRaw) return { ok: false, error: 'query is required.' };
  const safe = escLikeNeedle(queryRaw);
  const pattern = `%${safe}%`;
  const limit = Math.min(20, Math.max(1, Number(input.limit) || 5));

  // Cases
  const { data: casesData } = await supabase
    .from('cases')
    .select('id, title, subject_name, status')
    .eq('firm_id', firmId)
    .or(`title.ilike.${pattern},subject_name.ilike.${pattern}`)
    .limit(limit);
  // Clients (search via auth users for the email/name; firm_clients
  // is a join table with no text columns of its own, so we search
  // firm_documents.client_user_id linkage too).
  const { data: clientsData } = await supabase
    .from('firm_clients')
    .select('id, user_id, status')
    .eq('firm_id', firmId)
    .limit(50);
  const clientRows = (clientsData ?? []) as Array<{
    id: string; user_id: string; status: string;
  }>;
  const clientMatches: Array<{ id: string; user_id: string; status: string; label: string }> = [];
  for (const c of clientRows) {
    try {
      const { data: u } = await supabase.auth.admin.getUserById(c.user_id);
      const email = (u?.user?.email ?? '').toLowerCase();
      const name = String(
        (u?.user?.user_metadata as { full_name?: string } | null)?.full_name ?? '',
      ).toLowerCase();
      const needle = safe.toLowerCase();
      if (email.includes(needle) || name.includes(needle)) {
        clientMatches.push({
          id: c.id,
          user_id: c.user_id,
          status: c.status,
          label: u?.user?.email ?? c.user_id,
        });
        if (clientMatches.length >= limit) break;
      }
    } catch { /* skip */ }
  }
  // Documents
  const { data: docsData } = await supabase
    .from('firm_documents')
    .select('id, name, status, case_id')
    .eq('firm_id', firmId)
    .is('archived_at', null)
    .ilike('name', pattern)
    .limit(limit);
  // Intakes
  const { data: intakesData } = await supabase
    .from('firm_matter_intakes')
    .select('id, client_name, matter_type, status, matter_summary')
    .eq('firm_id', firmId)
    .or(`client_name.ilike.${pattern},matter_type.ilike.${pattern},matter_summary.ilike.${pattern}`)
    .limit(limit);

  return {
    ok: true,
    query: queryRaw,
    cases: casesData ?? [],
    clients: clientMatches,
    documents: docsData ?? [],
    intakes: intakesData ?? [],
    hint:
      'Per-type top hits. Use get_case_detail / get_client_detail / get_document_text / list_intake_inbox for drill-down.',
  };
}

async function runScheduleMeeting(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const topic = String(input.topic ?? '').trim() || 'Advottic meeting';
  const startIso = String(input.start_iso ?? '').trim();
  const startMs = Date.parse(startIso);
  if (!startIso || Number.isNaN(startMs)) {
    return { ok: false, error: 'start_iso must be a valid ISO datetime.' };
  }
  if (startMs < Date.now() - 60_000) {
    return { ok: false, error: 'start_iso must be in the future.' };
  }
  const duration = Math.min(
    480,
    Math.max(15, Number(input.duration_min) || 30),
  );
  const attendeeList = Array.isArray(input.attendee_emails)
    ? (input.attendee_emails as unknown[]).map(String)
    : [];
  const attendees = new Set<string>();
  for (const a of attendeeList) {
    const e = a.trim().toLowerCase();
    if (e.includes('@') && e.length <= 254) attendees.add(e);
  }
  if (user.email) attendees.add(user.email.toLowerCase());
  const intakeId = input.intake_id ? String(input.intake_id) : null;
  const providerChoice = String(input.provider ?? 'auto').trim();
  const provider: 'microsoft' | 'zoom' | undefined =
    providerChoice === 'microsoft'
      ? 'microsoft'
      : providerChoice === 'zoom'
        ? 'zoom'
        : undefined;

  const { scheduleFirmMeeting } = await import('./firm-meetings');
  const result = await scheduleFirmMeeting(firmId, {
    topic,
    startISO: new Date(startMs).toISOString(),
    durationMin: duration,
    attendees: [...attendees],
    provider,
  });
  if (!result.ok) return { ok: false, error: result.error };

  // Persist for the shared /counsel/calendar.
  try {
    await supabase.from('firm_meetings').insert({
      firm_id: firmId,
      intake_id: intakeId,
      created_by: user.id,
      provider: result.provider,
      topic,
      join_url: result.joinUrl,
      start_at: new Date(startMs).toISOString(),
      duration_min: duration,
    });
  } catch { /* best-effort */ }

  return {
    ok: true,
    topic,
    start_at: new Date(startMs).toISOString(),
    duration_min: duration,
    provider: result.provider,
    join_url: result.joinUrl,
    attendees: [...attendees],
    reminder:
      'The provider-side event is created without attendees so a single firm-branded invite is sent from Advottic. Tell the user this; many calendars otherwise show two pings.',
  };
}

async function runPostIntakeMessage(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const intakeId = String(input.intake_id ?? '').trim();
  const body = String(input.body ?? '');
  if (!intakeId) return { ok: false, error: 'intake_id is required.' };
  if (!body.trim()) return { ok: false, error: 'body is required.' };
  // Verify the intake belongs to the firm before delegating.
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const { data } = await supabase
    .from('firm_matter_intakes')
    .select('id, firm_id')
    .eq('id', intakeId)
    .maybeSingle();
  if (!data || (data as { firm_id?: string }).firm_id !== firmId) {
    return { ok: false, error: 'Intake not found in this firm.' };
  }
  const { postIntakeThreadMessageAction } = await import('./intake-thread');
  const res = await postIntakeThreadMessageAction(intakeId, body);
  if (!res.ok) return { ok: false, error: res.error ?? 'post failed' };
  return {
    ok: true,
    intake_id: intakeId,
    posted_chars: body.length,
    reminder:
      'The message is visible to the requester. Tell the user it has been posted and quote the body back briefly so they can confirm what was sent.',
  };
}

async function runGenerateReport(
  firmId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const supabase = createAdminSupabase();
  if (!supabase) return { ok: false, error: 'Service role not configured.' };
  const kind = String(input.kind ?? '').trim();
  const windowDays = Math.min(365, Math.max(1, Number(input.window_days) || 30));
  const sinceIso = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  if (kind === 'cases_by_status') {
    const { data } = await supabase
      .from('cases')
      .select('id, status')
      .eq('firm_id', firmId);
    const buckets: Record<string, number> = {};
    for (const r of (data ?? []) as Array<{ status: string }>) {
      buckets[r.status] = (buckets[r.status] ?? 0) + 1;
    }
    return {
      ok: true, kind, generated_at: new Date().toISOString(),
      total: (data ?? []).length, by_status: buckets,
    };
  }

  if (kind === 'billable_time') {
    const { data } = await supabase
      .from('firm_time_entries')
      .select('user_id, duration_seconds, billable, rate_cents, invoice_id, started_at')
      .eq('firm_id', firmId)
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false });
    const rows = (data ?? []) as Array<{
      user_id: string;
      duration_seconds: number | null;
      billable: boolean;
      rate_cents: number | null;
      invoice_id: string | null;
      started_at: string;
    }>;
    let totalSec = 0;
    let billableSec = 0;
    let billedSec = 0;
    let unbilledCents = 0;
    const perUser: Record<string, { seconds: number; cents: number }> = {};
    for (const r of rows) {
      const sec = r.duration_seconds ?? 0;
      totalSec += sec;
      if (r.billable) billableSec += sec;
      if (r.invoice_id) billedSec += sec;
      else if (r.billable) {
        unbilledCents += Math.round((sec / 3600) * (r.rate_cents ?? 0));
      }
      const pu = perUser[r.user_id] ?? { seconds: 0, cents: 0 };
      pu.seconds += sec;
      if (r.billable && !r.invoice_id) {
        pu.cents += Math.round((sec / 3600) * (r.rate_cents ?? 0));
      }
      perUser[r.user_id] = pu;
    }
    return {
      ok: true, kind, window_days: windowDays, generated_at: new Date().toISOString(),
      total_hours: +(totalSec / 3600).toFixed(2),
      billable_hours: +(billableSec / 3600).toFixed(2),
      billed_hours: +(billedSec / 3600).toFixed(2),
      unbilled_amount_cents: unbilledCents,
      per_user: Object.fromEntries(
        Object.entries(perUser).map(([k, v]) => [
          k,
          { hours: +(v.seconds / 3600).toFixed(2), unbilled_cents: v.cents },
        ]),
      ),
    };
  }

  if (kind === 'intake_throughput') {
    const { data } = await supabase
      .from('firm_matter_intakes')
      .select('id, status, created_at')
      .eq('firm_id', firmId)
      .gte('created_at', sinceIso);
    const rows = (data ?? []) as Array<{ status: string; created_at: string }>;
    const buckets: Record<string, number> = {};
    for (const r of rows) buckets[r.status] = (buckets[r.status] ?? 0) + 1;
    return {
      ok: true, kind, window_days: windowDays, generated_at: new Date().toISOString(),
      total_new: rows.length, by_status: buckets,
    };
  }

  if (kind === 'trust_balance_by_client') {
    const { data } = await supabase
      .from('firm_trust_transactions')
      .select('client_label, kind, amount_cents')
      .eq('firm_id', firmId);
    const positive = new Set(['deposit', 'refund', 'interest']);
    const perClient: Record<string, number> = {};
    let total = 0;
    for (const r of (data ?? []) as Array<{
      client_label: string | null;
      kind: string;
      amount_cents: number;
    }>) {
      const signed = positive.has(r.kind) ? r.amount_cents : -r.amount_cents;
      total += signed;
      const k = r.client_label ?? '(no label)';
      perClient[k] = (perClient[k] ?? 0) + signed;
    }
    return {
      ok: true, kind, generated_at: new Date().toISOString(),
      total_balance_cents: total, per_client: perClient,
    };
  }

  if (kind === 'signing_pipeline') {
    const { data } = await supabase
      .from('firm_signing_requests')
      .select('status, sent_at, completed_at')
      .eq('firm_id', firmId);
    const rows = (data ?? []) as Array<{
      status: string; sent_at: string | null; completed_at: string | null;
    }>;
    const buckets: Record<string, number> = {};
    for (const r of rows) buckets[r.status] = (buckets[r.status] ?? 0) + 1;
    return {
      ok: true, kind, generated_at: new Date().toISOString(),
      total: rows.length, by_status: buckets,
    };
  }

  if (kind === 'team_load') {
    // Open cases attributed to clients per attorney.
    const [members, clients, cases] = await Promise.all([
      supabase.from('firm_members').select('user_id, role, display_name').eq('firm_id', firmId),
      supabase.from('firm_clients').select('user_id, primary_attorney_id, status').eq('firm_id', firmId),
      supabase.from('cases').select('user_id, status').eq('firm_id', firmId),
    ]);
    const mems = (members.data ?? []) as Array<{ user_id: string; role: string; display_name: string | null }>;
    const cls = (clients.data ?? []) as Array<{ user_id: string; primary_attorney_id: string | null; status: string }>;
    const cas = (cases.data ?? []) as Array<{ user_id: string; status: string }>;
    const openStatuses = new Set(['open', 'under_review', 'needs_evidence', 'export_ready']);
    const clientByOwner = new Map<string, string>();
    for (const c of cls) {
      if (c.primary_attorney_id) clientByOwner.set(c.user_id, c.primary_attorney_id);
    }
    const load = new Map<string, { clients: number; open_cases: number }>();
    for (const m of mems) load.set(m.user_id, { clients: 0, open_cases: 0 });
    for (const c of cls) {
      if (!c.primary_attorney_id) continue;
      const e = load.get(c.primary_attorney_id);
      if (e) e.clients += 1;
    }
    for (const c of cas) {
      if (!openStatuses.has(c.status)) continue;
      const owner = clientByOwner.get(c.user_id);
      if (!owner) continue;
      const e = load.get(owner);
      if (e) e.open_cases += 1;
    }
    return {
      ok: true, kind, generated_at: new Date().toISOString(),
      team: mems.map((m) => ({
        user_id: m.user_id,
        role: m.role,
        display_name: m.display_name,
        clients: load.get(m.user_id)?.clients ?? 0,
        open_cases: load.get(m.user_id)?.open_cases ?? 0,
      })),
    };
  }

  return { ok: false, error: `Unknown report kind: ${kind}` };
}

const MAX_AGENT_TURNS = 5;

export async function* streamBella(input: {
  messages: BellaMessage[];
  caseContext?: string | null;
  isPublic?: boolean;
  mode?: BellaMode;
  /**
   * Which portal initiated this Bella turn. Determines what data the
   * tools are allowed to read. The route layer validates this before
   * passing it through; tools enforce it as a second line of defense.
   * Defaults to 'consumer' for safety (least-privilege).
   */
  portal?: BellaPortal;
  /** Active firm id when portal === 'firm'. Required for firm portal. */
  firmId?: string | null;
  /** When set, appends the firm-aware addendum to the system prompt
   *  so Bella is aware she's helping a member of a firm in /counsel/*. */
  firmContext?: {
    firmName: string;
    jurisdictions: string[];
    practiceAreas: string[];
    role: string;
  } | null;
}): AsyncGenerator<string, void, unknown> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    yield "Bella isn't fully connected yet - the server is missing an ANTHROPIC_API_KEY. Once that's set, I'll be able to answer in real time.";
    return;
  }

  const client = new Anthropic({ apiKey });

  const mode: BellaMode = input.mode ?? (input.isPublic ? 'public' : 'authed');
  // Resolve the portal for this turn. Public visitors are always
  // 'consumer' - they have no firm or hq context. Authed users
  // default to whatever the caller asked for (validated upstream)
  // or 'consumer' as the safest fallback.
  const portal: BellaPortal = mode === 'public' ? 'consumer' : (input.portal ?? 'consumer');
  const firmId: string | null = portal === 'firm' ? (input.firmId ?? null) : null;

  // Pro tier is metered. Refuse the request when the user has burned
  // through their monthly grant + any top-ups so they don't end up
  // with a runaway bill. Basic, Standard, public, and doc-review modes
  // bypass the gate entirely.
  if (mode === 'authed') {
    try {
      const { getProTokenGate } = await import('./storage');
      const gate = await getProTokenGate();
      if (gate && gate.balance <= 0) {
        yield "You've used up your Pro tokens for this billing period. Top up from your /billing page and I'll be right back.";
        return;
      }
    } catch {
      // never block a request because the gate read failed
    }
  }

  const systemText =
    mode === 'doc-review'
      ? BELLA_SYSTEM_DOC_REVIEW
      : mode === 'public'
        ? BELLA_SYSTEM_PUBLIC
        : BELLA_SYSTEM;

  const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
    {
      type: 'text',
      text: systemText,
      cache_control: { type: 'ephemeral' },
    },
  ];

  if (input.caseContext && mode === 'authed') {
    systemBlocks.push({
      type: 'text',
      text: `The user is currently viewing this case. Use it as context for app questions, but do not invent facts that aren't in here.\n\n${input.caseContext}`,
    });
  }

  if (input.firmContext && mode === 'authed') {
    systemBlocks.push({
      type: 'text',
      text: buildFirmAddendum(input.firmContext),
    });
  }

  const tools = toolsFor(mode);
  // Conversation history grows as tools fire; start from the user's recent
  // messages and append assistant tool_use turns + user tool_result turns.
  const conversation: Anthropic.Messages.MessageParam[] = input.messages
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content }));

  // Sum input + output across every turn so we can deduct Pro
  // tokens once at the end (Bella often loops via tool_use).
  let totalTokens = 0;
  // Detailed usage broken out by category so the firm-aware token
  // economy can apply the correct multipliers (cached input 0.5x,
  // fresh input 1x, output 5x). totalTokens stays for the legacy
  // gate; we report into the new system in addition.
  let totalInputTokens = 0;
  let totalCachedInputTokens = 0;
  let totalOutputTokens = 0;
  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      messages: conversation,
      ...(tools.length > 0 ? { tools } : {}),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }

    const finalMsg = await stream.finalMessage();
    totalTokens +=
      (finalMsg.usage?.input_tokens ?? 0) + (finalMsg.usage?.output_tokens ?? 0);
    totalInputTokens += finalMsg.usage?.input_tokens ?? 0;
    totalOutputTokens += finalMsg.usage?.output_tokens ?? 0;
    // Anthropic SDK exposes cache_read_input_tokens on usage when
    // prompt caching is engaged. Default to 0 when absent.
    const cached = (
      finalMsg.usage as unknown as { cache_read_input_tokens?: number } | null
    )?.cache_read_input_tokens;
    if (typeof cached === 'number') totalCachedInputTokens += cached;

    // If the model stopped to use a tool, run it and loop.
    if (finalMsg.stop_reason === 'tool_use') {
      // Append the assistant's mixed text + tool_use blocks to history.
      conversation.push({ role: 'assistant', content: finalMsg.content });

      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of finalMsg.content) {
        if (block.type !== 'tool_use') continue;
        const result = await executeTool(
          block.name as ToolName,
          (block.input ?? {}) as Record<string, unknown>,
          mode,
          portal,
          firmId,
        );
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });

        // Mirror navigate_to to the client via a stream marker so the
        // chat UI can call router.push and switch the user's view.
        if (block.name === 'navigate_to') {
          const r = result as { ok: boolean; navigated_to?: string };
          if (r.ok && r.navigated_to) {
            yield `\n${NAV_MARKER_OPEN}${r.navigated_to}${NAV_MARKER_CLOSE}\n`;
          }
        }
      }
      conversation.push({ role: 'user', content: toolResults });
      continue;
    }

    // end_turn / stop_sequence / max_tokens - reply is complete.
    if (mode === 'authed' && totalTokens > 0) {
      await meterBellaTurn({
        inputTokens: totalInputTokens,
        cachedInputTokens: totalCachedInputTokens,
        outputTokens: totalOutputTokens,
        turns: turn + 1,
        capped: false,
      });
    }
    return;
  }
  // Hit the agent-turn cap; gentle close.
  if (mode === 'authed' && totalTokens > 0) {
    await meterBellaTurn({
      inputTokens: totalInputTokens,
      cachedInputTokens: totalCachedInputTokens,
      outputTokens: totalOutputTokens,
      turns: MAX_AGENT_TURNS,
      capped: true,
    });
  }
  yield '\n\n_(I was looping a lot - paused to avoid spinning. Ask me again if I missed your question.)_';
}

/**
 * Single metering hook for Bella. Routes through the new
 * tier-aware token economy so:
 *   - Every paid tier (not just legacy Pro) is metered
 *   - Firm-pool tiers (Small Firm / Growing / Enterprise) debit
 *     the pool first, falling back to personal balance
 *   - Cached input tokens are billed at 0.5x, output at 5x
 *
 * Failures never break the response - we always swallow + log.
 */
async function meterBellaTurn(input: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  turns: number;
  capped: boolean;
}): Promise<void> {
  try {
    const { getCurrentUser } = await import('./supabase/server');
    const user = await getCurrentUser();
    if (!user) return;
    let firmId: string | null = null;
    try {
      const { getActiveFirmContext } = await import('./firm-storage');
      const firmCtx = await getActiveFirmContext();
      firmId = firmCtx?.firm.id ?? null;
    } catch {
      /* not in firm context - fine */
    }
    const { debitFromAnthropicUsage } = await import('./token-economy');
    await debitFromAnthropicUsage(
      {
        userId: user.id,
        firmId,
        reason: 'bella',
        metadata: {
          turns: input.turns,
          capped: input.capped,
          input_tokens: input.inputTokens,
          cached_input_tokens: input.cachedInputTokens,
          output_tokens: input.outputTokens,
        },
      },
      {
        inputTokens: input.inputTokens,
        cachedInputTokens: input.cachedInputTokens,
        outputTokens: input.outputTokens,
      },
    );
  } catch {
    /* never break a response on a metering failure */
  }
}
