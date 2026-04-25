import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';

const ENV_FILE = '.env.local';
const DB_PATH = 'data/db.json';
const MODEL = 'claude-sonnet-4-6';
const DISCLAIMER =
  'This analysis is for informational purposes only and does not constitute legal advice. Advottic is not a law firm and does not create an attorney-client relationship. You should consult a licensed attorney in your jurisdiction before taking legal action.';

const SYSTEM = `You are Advottic, a legal information assistant. You do not provide final legal advice and you are not a lawyer. Your job is to:
1. Organize the facts of the case.
2. Identify possible legal issues grounded in the selected jurisdiction.
3. Recommend concrete evidence the user should gather to strengthen the matter.
4. Identify specific third-party record custodians whose records could be subject to subpoena or discovery, and describe what each one would show.
5. Produce informational issue-spotting that a licensed attorney can verify.

When the jurisdiction is known, reference the common legal doctrines that would likely apply in that state or country (e.g., conversion, replevin, trespass to chattels, civil theft, burglary, trespass, unjust enrichment, breach of bailment, etc.) in plain terms. Do not cite specific statute section numbers unless you are confident they are accurate for that jurisdiction; if you are uncertain, describe the doctrine in plain English and note that the user's attorney should confirm the current statute and case law.

ALWAYS use cautious, hedged language: "may constitute", "could potentially", "appears to involve". NEVER state that a person committed a crime, NEVER tell the user they "have a case", NEVER recommend specific legal action as if it were certain. Frame outputs as informational issue-spotting.

For evidenceToStrengthen: be specific and actionable. Examples: "Date-stamped photos of the pet in the claimant's home (pre-incident)", "Veterinary records showing ownership and microchip registration", "Text messages or social media posts between the parties referencing the animal". Avoid vague items like "more evidence" or "additional documents".

For subpoenaTargets: list specific types of third parties or record custodians, each paired with what their records would likely show. Only include a target if the records plausibly exist and would be relevant; do not include fabricated or speculative custodians.

If facts are missing or unclear, say so explicitly in the missingInformation field rather than guessing.`;

const TOOL = {
  name: 'submit_review',
  description: 'Submit the structured legal review of the case for the user.',
  input_schema: {
    type: 'object',
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
      summary: { type: 'string' },
      timeline: { type: 'array', items: { type: 'string' } },
      keyFacts: { type: 'array', items: { type: 'string' } },
      possibleIssues: { type: 'array', items: { type: 'string' } },
      classification: { type: 'string' },
      applicableLegalReferences: { type: 'array', items: { type: 'string' } },
      evidenceMapping: { type: 'array', items: { type: 'string' } },
      evidenceToStrengthen: { type: 'array', items: { type: 'string' } },
      subpoenaTargets: { type: 'array', items: { type: 'string' } },
      missingInformation: { type: 'array', items: { type: 'string' } },
      suggestedNextSteps: { type: 'array', items: { type: 'string' } },
      questionsForAttorney: { type: 'array', items: { type: 'string' } },
    },
  },
};

async function loadEnv() {
  const raw = await fs.readFile(ENV_FILE, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function reviewCase(client, caseRecord, exhibits) {
  const jurisdiction = [
    caseRecord.jurisdiction.city,
    caseRecord.jurisdiction.state,
    caseRecord.jurisdiction.country,
  ]
    .filter(Boolean)
    .join(', ');

  const exhibitsBlock =
    exhibits.length === 0
      ? '(none uploaded yet)'
      : exhibits
          .map(
            (e) =>
              `- ${e.label}: ${e.fileName}${e.description ? ` - ${e.description}` : ''} (${e.fileType})`,
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

  const result = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'submit_review' },
    messages: [{ role: 'user', content: userContent }],
  });

  const toolUse = result.content.find(
    (b) => b.type === 'tool_use' && b.name === 'submit_review',
  );
  const data = toolUse?.input ?? {};

  return {
    id: crypto.randomUUID(),
    caseId: caseRecord.id,
    jurisdiction,
    summary: data.summary || '',
    timeline: Array.isArray(data.timeline) ? data.timeline : [],
    keyFacts: Array.isArray(data.keyFacts) ? data.keyFacts : [],
    possibleIssues: Array.isArray(data.possibleIssues) ? data.possibleIssues : [],
    classification: data.classification || 'No clear classification identified.',
    applicableLegalReferences: Array.isArray(data.applicableLegalReferences) ? data.applicableLegalReferences : [],
    evidenceMapping: Array.isArray(data.evidenceMapping) ? data.evidenceMapping : [],
    evidenceToStrengthen: Array.isArray(data.evidenceToStrengthen) ? data.evidenceToStrengthen : [],
    subpoenaTargets: Array.isArray(data.subpoenaTargets) ? data.subpoenaTargets : [],
    missingInformation: Array.isArray(data.missingInformation) ? data.missingInformation : [],
    suggestedNextSteps: Array.isArray(data.suggestedNextSteps) ? data.suggestedNextSteps : [],
    questionsForAttorney: Array.isArray(data.questionsForAttorney)
      ? data.questionsForAttorney
      : [],
    disclaimer: DISCLAIMER,
    modelUsed: MODEL,
    isDemo: false,
    createdAt: new Date().toISOString(),
  };
}

async function main() {
  await loadEnv();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('No ANTHROPIC_API_KEY found in environment.');
    process.exit(1);
  }

  const db = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
  const client = new Anthropic();

  const targets = process.argv.slice(2);
  const cases = targets.length
    ? db.cases.filter((c) => targets.includes(c.id))
    : db.cases;

  for (const caseRecord of cases) {
    const exhibits = db.exhibits.filter((e) => e.caseId === caseRecord.id);
    console.log(`\n-- Reviewing "${caseRecord.title}" (${caseRecord.id})`);
    process.stdout.write('   calling Claude... ');
    const t0 = Date.now();
    const review = await reviewCase(client, caseRecord, exhibits);
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    db.aiReviews.push(review);
    const c = db.cases.find((c) => c.id === caseRecord.id);
    if (c) {
      c.status = 'under_review';
      c.updatedAt = review.createdAt;
    }

    console.log('   Summary:', review.summary);
    console.log('   Classification:', review.classification);
    if (review.evidenceToStrengthen.length) {
      console.log('   Evidence to strengthen:');
      for (const e of review.evidenceToStrengthen) console.log('     -', e);
    }
    if (review.subpoenaTargets.length) {
      console.log('   Subpoena / records targets:');
      for (const s of review.subpoenaTargets) console.log('     -', s);
    }
  }

  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
  console.log('\nSaved reviews to', DB_PATH);
}

main().catch((err) => {
  console.error('Failed:', err?.message || err);
  if (err?.response) console.error(err.response);
  process.exit(1);
});
