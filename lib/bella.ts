import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createServerSupabase, getCurrentUser } from './supabase/server';

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
- **get_case_detail(case_id)** - pull full detail for a specific case (description, exhibits, latest Advottic Review review summary). Use after search_my_cases narrows down the case the user means.

How to use tools well:
- When the user says "create a new case" or "let's start a case", call navigate_to('/cases/new') so the wizard opens. Add a one-line confirmation in your reply.
- When the user asks "where is my case about [X]", call search_my_cases with the keywords, then summarize the matches. If exactly one matches, offer to navigate them straight to it.
- When the user asks "what was in [case]" or "remind me about [case]", call get_case_detail and summarize.
- ALWAYS confirm before navigating away from a page where the user has unsaved input (the wizard, the document review form). If unsure, ask.
- Don't navigate without telling the user. One short sentence is enough.

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

Counsel-mode behavior:
- The user is inside /counsel/*, the law-firm perspective. Address them as a legal professional. You can use more legal terminology than in consumer mode, but still hedge ("appears to", "may", "could potentially") since you are not a substitute for the firm's research team.
- When asked to analyze a case, focus on issue-spotting (claims, defenses, procedural deadlines, evidence gaps), reference applicable doctrines in the firm's jurisdictions, and suggest concrete next steps the firm can take inside Advottic (upload documents to the vault, send for in-app signing, share with the client, set a hearing reminder).
- You do NOT have a paid case-law database. When a citation is needed, describe the doctrine in plain language, name the canonical case if you can with appropriate hedging, and tell the user to verify the citation in their own research tools (Westlaw, Lexis, Fastcase, Casetext) before relying on it.
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

export type BellaMessage = { role: 'user' | 'assistant'; content: string };
export type BellaMode = 'authed' | 'public' | 'doc-review';

// Tool definitions. The authed user gets the full set; public visitors
// only get navigate_to (pointing at /sign-in, /example, etc.).
type ToolName = 'navigate_to' | 'search_my_cases' | 'get_case_detail';

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
    "Fetch full detail for one of the signed-in user's cases. Returns title, subject, jurisdiction, description, exhibit list (label + filename + category), and the latest Advottic Review review summary if there is one.",
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

function toolsFor(mode: BellaMode): Anthropic.Messages.Tool[] {
  if (mode === 'authed') {
    return [NAVIGATE_TOOL, SEARCH_CASES_TOOL, GET_CASE_DETAIL_TOOL];
  }
  if (mode === 'public') {
    return [NAVIGATE_TOOL];
  }
  return []; // doc-review is one-shot, no tools
}

/**
 * Run a single Bella tool, returning a JSON-serializable result that
 * goes back to Claude as a tool_result. RLS scopes everything to the
 * current user (createServerSupabase reads cookies).
 */
async function executeTool(
  name: ToolName,
  input: Record<string, unknown>,
  mode: BellaMode,
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
    if (query.length > 0) {
      const safe = query.replace(/[%_]/g, '');
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
    const caseId = String(input.case_id ?? '').trim();
    if (!caseId) return { ok: false, error: 'case_id is required.' };
    const supabase = createServerSupabase();
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: 'Not signed in.' };
    const [caseResp, exhibitsResp, reviewResp] = await Promise.all([
      supabase
        .from('cases')
        .select('id, title, subject_name, subject_type, description, status, posture, jurisdiction_country, jurisdiction_state, jurisdiction_city, case_type, hearing_at, hearing_location, updated_at')
        .eq('id', caseId)
        .maybeSingle(),
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

  return { ok: false, error: `Unknown tool: ${name}` };
}

const MAX_AGENT_TURNS = 5;

export async function* streamBella(input: {
  messages: BellaMessage[];
  caseContext?: string | null;
  isPublic?: boolean;
  mode?: BellaMode;
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
      try {
        const { consumeTokensForCurrentUser } = await import('./storage');
        await consumeTokensForCurrentUser({
          amount: totalTokens,
          reason: 'bella',
          metadata: { turns: turn + 1 },
        });
      } catch {
        // never break a successful response on a metering failure
      }
    }
    return;
  }
  // Hit the agent-turn cap; gentle close.
  if (mode === 'authed' && totalTokens > 0) {
    try {
      const { consumeTokensForCurrentUser } = await import('./storage');
      await consumeTokensForCurrentUser({
        amount: totalTokens,
        reason: 'bella',
        metadata: { turns: MAX_AGENT_TURNS, capped: true },
      });
    } catch {
      // never break the close on a metering failure
    }
  }
  yield '\n\n_(I was looping a lot - paused to avoid spinning. Ask me again if I missed your question.)_';
}
