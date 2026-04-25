import Anthropic from '@anthropic-ai/sdk';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AIReview, Case, DefenseAdvice, Exhibit } from './types';

const MODEL = 'claude-sonnet-4-6';

function resolveApiKey(): string | undefined {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  // Next.js's dotenv loader won't overwrite an already-set env var, even if
  // it's empty. Fall back to reading .env.local directly so a shell-set
  // `ANTHROPIC_API_KEY=` doesn't mask the real key.
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
    // .env.local missing or unreadable — fall through
  }
  return undefined;
}

const SYSTEM_PROMPT = `You are Advottic, a legal information assistant. You do not provide final legal advice and you are not a lawyer. Your job is to:
1. Organize the facts of the case.
2. Identify possible legal issues grounded in the selected jurisdiction.
3. Recommend concrete evidence the user should gather to strengthen the matter.
4. Identify specific third-party record custodians whose records could be subject to subpoena or discovery, and describe what each one would show.
5. Produce informational issue-spotting that a licensed attorney can verify.

When the jurisdiction is known, reference the common legal doctrines that would likely apply in that state or country (e.g., conversion, replevin, trespass to chattels, civil theft, burglary, trespass, unjust enrichment, breach of bailment, etc.) in plain terms. Do not cite specific statute section numbers unless you are confident they are accurate for that jurisdiction; if you are uncertain, describe the doctrine in plain English and note that the user's attorney should confirm the current statute and case law.

ALWAYS use cautious, hedged language: "may constitute", "could potentially", "appears to involve". NEVER state that a person committed a crime, NEVER tell the user they "have a case", NEVER recommend specific legal action as if it were certain (filing, calling police, suing). Frame outputs as informational issue-spotting.

For evidenceToStrengthen: be specific and actionable. Examples: "Date-stamped photos of the pet in the claimant's home (pre-incident)", "Veterinary records showing ownership and microchip registration", "Text messages or social media posts between the parties referencing the animal". Avoid vague items like "more evidence" or "additional documents".

For subpoenaTargets: list specific types of third parties or record custodians, each paired with what their records would likely show. Examples: "Abel Muchai's cell carrier — call/text metadata around the date the cat was last seen", "Microchip registries (AAHA, HomeAgain, 24PetWatch) — registration history and re-registration attempts", "Local veterinary clinics in Shakopee / Scott County — intake or ownership-transfer records for a cat matching the description", "Animal shelters and rescues in Scott County — surrender logs and adoption records", "Ring / Nest / home security systems of the claimant and consenting neighbors — video footage of the animal in the claimant's custody or leaving with the respondent". Only include a target if the records plausibly exist and would be relevant; do not include fabricated or speculative custodians.

If facts are missing or unclear, say so explicitly in the missingInformation field rather than guessing.`;

const DISCLAIMER = `This analysis is for informational purposes only and does not constitute legal advice. Advottic is not a law firm and does not create an attorney-client relationship. You should consult a licensed attorney in your jurisdiction before taking legal action.`;

type ReviewPayload = {
  summary: string;
  timeline: string[];
  keyFacts: string[];
  possibleIssues: string[];
  classification: string;
  applicableLegalReferences: string[];
  evidenceMapping: string[];
  evidenceToStrengthen: string[];
  subpoenaTargets: string[];
  missingInformation: string[];
  suggestedNextSteps: string[];
  questionsForAttorney: string[];
};

const TOOL_SCHEMA = {
  name: 'submit_review',
  description: 'Submit the structured legal review of the case for the user.',
  input_schema: {
    type: 'object' as const,
    required: [
      'summary',
      'timeline',
      'keyFacts',
      'possibleIssues',
      'classification',
      'applicableLegalReferences',
      'evidenceMapping',
      'evidenceToStrengthen',
      'subpoenaTargets',
      'missingInformation',
      'suggestedNextSteps',
      'questionsForAttorney',
    ],
    properties: {
      summary: { type: 'string', description: 'Plain-English case summary, 2-4 sentences.' },
      timeline: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered timeline events, each one short.',
      },
      keyFacts: { type: 'array', items: { type: 'string' } },
      possibleIssues: {
        type: 'array',
        items: { type: 'string' },
        description: 'Possible legal issues, each phrased with hedged language.',
      },
      classification: {
        type: 'string',
        description:
          'Possible classification phrased cautiously, e.g., "may involve a misdemeanor under {jurisdiction} law because ...". Use one of: crime, gross misdemeanor, misdemeanor, petty misdemeanor, civil issue, regulatory violation, contract breach, or "unclear".',
      },
      applicableLegalReferences: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Legal doctrines or concepts likely applicable in the stated jurisdiction, described in plain terms (e.g., "civil conversion — unauthorized exercise of control over another\'s personal property"). Do not include statute section numbers unless you are confident they are accurate; default to describing the doctrine and noting that the attorney should confirm the current statute.',
      },
      evidenceMapping: {
        type: 'array',
        items: { type: 'string' },
        description: 'Map each issue to supporting exhibits, e.g., "Issue X — supported by Exhibit B".',
      },
      evidenceToStrengthen: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Concrete, specific evidence the user should gather to strengthen the matter. Be actionable, not generic.',
      },
      subpoenaTargets: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Specific third-party record custodians whose records could be relevant, each paired with what the records would likely show. Only include targets whose records plausibly exist and would be relevant.',
      },
      missingInformation: { type: 'array', items: { type: 'string' } },
      suggestedNextSteps: { type: 'array', items: { type: 'string' } },
      questionsForAttorney: { type: 'array', items: { type: 'string' } },
    },
  },
};

export async function runReview(caseRecord: Case, exhibits: Exhibit[]): Promise<AIReview> {
  const jurisdiction = [
    caseRecord.jurisdiction.city,
    caseRecord.jurisdiction.state,
    caseRecord.jurisdiction.country,
  ]
    .filter(Boolean)
    .join(', ');

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return demoReview(caseRecord, exhibits, jurisdiction);
  }

  const exhibitsBlock =
    exhibits.length === 0
      ? '(none uploaded yet)'
      : exhibits
          .map(
            (e) =>
              `- ${e.label}: ${e.fileName}${e.description ? ` — ${e.description}` : ''} (${e.fileType})`,
          )
          .join('\n');

  const userContent = `Jurisdiction: ${jurisdiction || '(not specified)'}
Case type: ${caseRecord.caseType}
Subject (${caseRecord.subjectType}): ${caseRecord.subjectName}
Title: ${caseRecord.title}

Case description:
${caseRecord.description || '(no description provided)'}

Evidence summaries:
${exhibitsBlock}

Use the submit_review tool to return your structured analysis.`;

  const client = new Anthropic({ apiKey });

  const result = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'tool', name: 'submit_review' },
    messages: [{ role: 'user', content: userContent }],
  });

  const toolUse = result.content.find(
    (b): b is Extract<(typeof result.content)[number], { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === 'submit_review',
  );

  const data = (toolUse?.input ?? {}) as Partial<ReviewPayload>;

  return {
    id: crypto.randomUUID(),
    caseId: caseRecord.id,
    jurisdiction,
    summary: stringField(data.summary),
    timeline: arrayField(data.timeline),
    keyFacts: arrayField(data.keyFacts),
    possibleIssues: arrayField(data.possibleIssues),
    classification: stringField(data.classification) || 'No clear classification identified.',
    applicableLegalReferences: arrayField(data.applicableLegalReferences),
    evidenceMapping: arrayField(data.evidenceMapping),
    evidenceToStrengthen: arrayField(data.evidenceToStrengthen),
    subpoenaTargets: arrayField(data.subpoenaTargets),
    missingInformation: arrayField(data.missingInformation),
    suggestedNextSteps: arrayField(data.suggestedNextSteps),
    questionsForAttorney: arrayField(data.questionsForAttorney),
    disclaimer: DISCLAIMER,
    modelUsed: MODEL,
    isDemo: false,
    createdAt: new Date().toISOString(),
  };
}

function stringField(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function arrayField(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

// ---------------------------------------------------------------------------
// Exhibit plan — generates an ordered list of suggested exhibit slots (A, B, C…)
// based on the case context. Up to 26.
// ---------------------------------------------------------------------------

const PLAN_TOOL = {
  name: 'submit_exhibit_plan',
  description: 'Submit a structured, ordered exhibit plan for the case.',
  input_schema: {
    type: 'object' as const,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 26,
        items: {
          type: 'object',
          required: ['title', 'description'],
          properties: {
            title: {
              type: 'string',
              description:
                'Short name for the exhibit slot, e.g. "Microchip registration" or "Forced-entry photos".',
            },
            description: {
              type: 'string',
              description:
                'One to two sentences explaining what this exhibit should contain and what it would demonstrate.',
            },
          },
        },
      },
    },
  },
};

export async function planExhibits(
  caseRecord: Case,
  exhibits: Exhibit[],
): Promise<{ title: string; description: string }[]> {
  const jurisdiction = [
    caseRecord.jurisdiction.city,
    caseRecord.jurisdiction.state,
    caseRecord.jurisdiction.country,
  ]
    .filter(Boolean)
    .join(', ');

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return demoExhibitPlan(caseRecord, exhibits);
  }

  const existing =
    exhibits.length === 0
      ? '(no exhibits uploaded yet)'
      : exhibits
          .map(
            (e) =>
              `- ${e.label}: ${e.fileName}${e.description ? ` — ${e.description}` : ''}`,
          )
          .join('\n');

  const systemText = `You are Advottic, a legal information assistant. Generate an exhibit plan: an ordered list of suggested exhibit slots (A, B, C...) that the user should gather and upload to build a strong case file for a licensed attorney to review.

Guidelines:
- Up to 26 slots; fewer is fine if the case is narrow.
- Each item has a short title and a 1–2 sentence description of what it should contain.
- Ground suggestions in the stated jurisdiction and case type.
- Avoid duplicating exhibits that are already uploaded; reference them implicitly, but focus the plan on what's still missing.
- Use cautious, informational language. This is organizational planning, not legal advice.`;

  const userContent = `Jurisdiction: ${jurisdiction || '(not specified)'}
Case type: ${caseRecord.caseType}
Subject (${caseRecord.subjectType}): ${caseRecord.subjectName}
Title: ${caseRecord.title}

Case description:
${caseRecord.description || '(no description provided)'}

Exhibits already uploaded:
${existing}

Use the submit_exhibit_plan tool to return an ordered exhibit plan.`;

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    tools: [PLAN_TOOL],
    tool_choice: { type: 'tool', name: 'submit_exhibit_plan' },
    messages: [{ role: 'user', content: userContent }],
  });

  const toolUse = result.content.find(
    (b): b is Extract<(typeof result.content)[number], { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === 'submit_exhibit_plan',
  );
  const data = (toolUse?.input ?? {}) as { items?: { title?: unknown; description?: unknown }[] };
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((item) => ({
      title: typeof item.title === 'string' ? item.title.trim() : '',
      description: typeof item.description === 'string' ? item.description.trim() : '',
    }))
    .filter((i) => i.title.length > 0)
    .slice(0, 26);
}

// ---------------------------------------------------------------------------
// Defense advice — for someone who has been sued/charged and is preparing
// pro se. Truth-and-transparency framing, jurisdiction-aware, no fabricated
// citations.
// ---------------------------------------------------------------------------

const DEFENSE_SYSTEM = `You are Advottic, helping a self-represented person ("pro se") who is being sued or charged. You are NOT their lawyer and you do NOT have a license to practice in any jurisdiction. Your only job is to:

1. Help the user understand, in plain English, what they have been accused of.
2. Identify possible legal defenses (procedural and substantive) commonly available in the stated jurisdiction.
3. Explain the procedural posture and typical deadlines they need to be aware of (e.g., when an Answer is due, statute of limitations issues, motion practice).
4. Identify concrete evidence the user should gather to support their defense.
5. Identify red-flag situations where they should absolutely retain counsel and not proceed pro se.
6. Supply realistic risk factors so they understand exposure.
7. List topics they should look up (these will be linked to a curated, vetted resources list — you do NOT generate URLs).

CORE PRINCIPLES — Truth and transparency:
- You will not fabricate case names, statute section numbers, or quotes. If you are uncertain about a specific cite, describe the doctrine in plain language and tell the user to verify with current state law and a licensed attorney.
- You will hedge: "may", "could", "appears to". Never declare a defense will succeed.
- You will assume the user is a non-lawyer. Explain procedural terms (e.g., "An 'Answer' is your written response to the complaint.").
- You will be direct about uncertainty.

CRITICAL CRIMINAL CARVE-OUT:
If the matter could result in jail time (criminal allegation, contempt of court, immigration removal proceedings, etc.), make sure the very FIRST item in whenToHireLawyer is something to the effect of: "If you are facing criminal charges or any possibility of incarceration, you have a constitutional right to a public defender at no cost. Request one immediately at your first court appearance — do not proceed pro se on a criminal matter."

Never tell the user they will win, never tell them to lie, never advise destroying evidence, never advise contacting witnesses inappropriately, never advise contacting represented parties directly. If the user appears to be asking how to break the law, refuse and recommend a licensed attorney.

For resourceTopics: each item is a SHORT topic phrase (e.g., "Statute of limitations in Minnesota for breach of contract", "How to file an Answer in Minnesota district court", "Eviction defense procedure in Hennepin County"). The app will pair these with vetted self-help resources — do NOT include URLs in your output.`;

const DEFENSE_TOOL = {
  name: 'submit_defense_advice',
  description: 'Submit structured defense planning information for a pro se litigant.',
  input_schema: {
    type: 'object' as const,
    required: [
      'charges',
      'summary',
      'proSeOverview',
      'possibleDefenses',
      'proceduralPosture',
      'evidenceToGather',
      'whenToHireLawyer',
      'riskFactors',
      'questionsForAttorney',
      'resourceTopics',
    ],
    properties: {
      charges: {
        type: 'string',
        description: 'Plain-English statement of what the user is being accused of or sued for.',
      },
      summary: {
        type: 'string',
        description: 'Plain-English overall summary of the matter and the user\'s posture.',
      },
      proSeOverview: {
        type: 'string',
        description:
          'A paragraph explaining what to expect representing themselves: deadlines, courtroom etiquette, the difference between an Answer and a Motion, where to find court forms.',
      },
      possibleDefenses: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Possible defenses with hedged language, including procedural ones (statute of limitations, lack of personal jurisdiction, improper service, failure to state a claim, etc.) and substantive ones specific to the case type.',
      },
      proceduralPosture: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Each item should describe a procedural step or deadline the user should be aware of (e.g., "An Answer is typically due within 21 days of service in Minnesota state district court — verify your specific deadline on the summons").',
      },
      evidenceToGather: {
        type: 'array',
        items: { type: 'string' },
        description: 'Concrete, specific evidence to gather to support the defense.',
      },
      whenToHireLawyer: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Red-flag situations or thresholds that mean retaining counsel is more important than self-help. If the matter is criminal or carries jail time, the FIRST item must reference the right to a public defender.',
      },
      riskFactors: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Honest risk factors / exposure (e.g., "If a default judgment is entered, the claimant may execute against bank accounts and wages").',
      },
      questionsForAttorney: {
        type: 'array',
        items: { type: 'string' },
        description: 'Questions to take to a free consultation or legal aid intake.',
      },
      resourceTopics: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Short topic phrases (no URLs) that the app will pair with vetted self-help resources.',
      },
    },
  },
};

const DEFENSE_DISCLAIMER = `This is informational organization for someone preparing pro se — not legal advice, not a substitute for a licensed attorney, and not a guarantee of outcome. Advottic does not represent you. Procedural deadlines vary by court and jurisdiction; verify every deadline against your summons, the local rules, and state statute. If you are facing any possibility of incarceration, request a public defender at your first court appearance.`;

export async function runDefenseAdvice(
  caseRecord: Case,
  exhibits: Exhibit[],
): Promise<DefenseAdvice> {
  const jurisdiction = [
    caseRecord.jurisdiction.city,
    caseRecord.jurisdiction.state,
    caseRecord.jurisdiction.country,
  ]
    .filter(Boolean)
    .join(', ');

  const apiKey = resolveApiKey();
  if (!apiKey) {
    return demoDefenseAdvice(caseRecord, jurisdiction);
  }

  const exhibitsBlock =
    exhibits.length === 0
      ? '(none uploaded yet)'
      : exhibits
          .map(
            (e) =>
              `- ${e.label}: ${e.fileName}${e.description ? ` — ${e.description}` : ''}`,
          )
          .join('\n');

  const userContent = `The user is the DEFENDANT / RESPONDENT. They are preparing pro se.

Jurisdiction: ${jurisdiction || '(not specified)'}
Case type: ${caseRecord.caseType}
Title: ${caseRecord.title}

What they say happened (their account):
${caseRecord.description || '(no description provided)'}

Evidence in their possession:
${exhibitsBlock}

Use the submit_defense_advice tool to return structured defense planning. Remember: pro se assumption, plain language, hedged claims, NO fabricated citations, and the criminal carve-out if applicable.`;

  const client = new Anthropic({ apiKey });
  const result = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: DEFENSE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [DEFENSE_TOOL],
    tool_choice: { type: 'tool', name: 'submit_defense_advice' },
    messages: [{ role: 'user', content: userContent }],
  });

  const toolUse = result.content.find(
    (b): b is Extract<(typeof result.content)[number], { type: 'tool_use' }> =>
      b.type === 'tool_use' && b.name === 'submit_defense_advice',
  );
  const data = (toolUse?.input ?? {}) as Record<string, unknown>;

  return {
    id: crypto.randomUUID(),
    caseId: caseRecord.id,
    jurisdiction,
    charges: stringField(data.charges),
    summary: stringField(data.summary),
    proSeOverview: stringField(data.proSeOverview),
    possibleDefenses: arrayField(data.possibleDefenses),
    proceduralPosture: arrayField(data.proceduralPosture),
    evidenceToGather: arrayField(data.evidenceToGather),
    whenToHireLawyer: arrayField(data.whenToHireLawyer),
    riskFactors: arrayField(data.riskFactors),
    questionsForAttorney: arrayField(data.questionsForAttorney),
    resourceTopics: arrayField(data.resourceTopics),
    disclaimer: DEFENSE_DISCLAIMER,
    modelUsed: MODEL,
    isDemo: false,
    createdAt: new Date().toISOString(),
  };
}

function demoDefenseAdvice(caseRecord: Case, jurisdiction: string): DefenseAdvice {
  return {
    id: crypto.randomUUID(),
    caseId: caseRecord.id,
    jurisdiction,
    charges: `Demo response — ANTHROPIC_API_KEY not set. The user is positioned as a defendant in a ${caseRecord.caseType.toLowerCase()} matter.`,
    summary: 'Demo defense advice. Set ANTHROPIC_API_KEY to enable Claude-backed analysis.',
    proSeOverview:
      'Demo response. With a real key set, this section will explain pro se procedure for your jurisdiction.',
    possibleDefenses: ['Demo defense item — connect ANTHROPIC_API_KEY for real analysis.'],
    proceduralPosture: ['Demo procedural step.'],
    evidenceToGather: ['Demo evidence item.'],
    whenToHireLawyer: [
      'If you are facing criminal charges or any possibility of incarceration, request a public defender at your first court appearance — you have a constitutional right to one at no cost.',
      'If the dispute involves significant money, real estate, or your livelihood, retain counsel.',
    ],
    riskFactors: ['Demo risk item — set ANTHROPIC_API_KEY to enable real risk assessment.'],
    questionsForAttorney: [
      'What are my realistic options given the facts?',
      'What deadlines must I meet to preserve my rights?',
    ],
    resourceTopics: ['How to find legal aid', 'How to file an Answer pro se'],
    disclaimer: DEFENSE_DISCLAIMER,
    modelUsed: 'demo',
    isDemo: true,
    createdAt: new Date().toISOString(),
  };
}

function demoExhibitPlan(
  caseRecord: Case,
  _exhibits: Exhibit[],
): { title: string; description: string }[] {
  return [
    {
      title: 'Ownership / identity documentation',
      description: `Records establishing ownership or identity relevant to this ${caseRecord.caseType.toLowerCase()} matter. Set ANTHROPIC_API_KEY to enable a real plan.`,
    },
    {
      title: 'Date-stamped photographs',
      description: 'Demo item — set ANTHROPIC_API_KEY to enable Claude-backed exhibit planning.',
    },
    {
      title: 'Written communications',
      description: 'Demo item — messages, emails, or letters between the parties.',
    },
  ];
}

function demoReview(caseRecord: Case, exhibits: Exhibit[], jurisdiction: string): AIReview {
  return {
    id: crypto.randomUUID(),
    caseId: caseRecord.id,
    jurisdiction,
    summary: `Demo review for "${caseRecord.title}" — a ${caseRecord.caseType.toLowerCase()} matter involving ${caseRecord.subjectName} in ${jurisdiction || 'an unspecified jurisdiction'}. ${exhibits.length} exhibit(s) attached. Set ANTHROPIC_API_KEY to enable real Claude-backed analysis.`,
    timeline: [
      'Demo timeline event 1 — date and event would appear here.',
      'Demo timeline event 2 — connect ANTHROPIC_API_KEY for a real reconstructed timeline.',
    ],
    keyFacts: [
      `Subject: ${caseRecord.subjectName} (${caseRecord.subjectType})`,
      `Case type: ${caseRecord.caseType}`,
      `Jurisdiction: ${jurisdiction || 'not specified'}`,
      `Exhibits attached: ${exhibits.length}`,
    ],
    possibleIssues: [
      'Demo issue — set ANTHROPIC_API_KEY to enable real legal issue spotting.',
    ],
    classification:
      'No analysis run yet. This is a demo response. Set ANTHROPIC_API_KEY in .env.local to enable Claude-backed classification.',
    evidenceMapping: exhibits.length
      ? exhibits.map((e) => `${e.label} (${e.fileName}) — relevance to be determined`)
      : ['No exhibits uploaded yet.'],
    missingInformation: [
      'Set ANTHROPIC_API_KEY environment variable to enable a real review.',
      'Upload supporting evidence to ground the analysis.',
    ],
    suggestedNextSteps: [
      'Configure ANTHROPIC_API_KEY in .env.local and re-run this review.',
      'Add exhibits and a more detailed case description.',
    ],
    questionsForAttorney: [
      'Given the facts above, what are my realistic options?',
      'What documents or evidence should I gather before filing or responding?',
    ],
    disclaimer: DISCLAIMER,
    modelUsed: 'demo',
    isDemo: true,
    createdAt: new Date().toISOString(),
  };
}
