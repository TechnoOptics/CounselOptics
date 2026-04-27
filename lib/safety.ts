/**
 * Safety-cue detection for free-form user text.
 *
 * Used to surface a "are you safe right now?" advisory when someone is
 * filling in a case description that sounds urgent. Advottic is not a
 * crisis service - the goal is to make sure nobody falls through the
 * cracks while typing into our textarea, not to diagnose anything.
 *
 * The patterns intentionally lean toward false positives: a banner that
 * occasionally appears for a calm case is much better than missing
 * someone who is actually in danger. The banner explicitly tells the
 * reader they can ignore it if it doesn't apply.
 */

export type SafetyCategory =
  | 'in_danger'
  | 'injury'
  | 'self_harm'
  | 'child_safety'
  | 'sexual_violence';

export type SafetyHit = {
  category: SafetyCategory;
  matched: string;
};

const PATTERNS: Record<SafetyCategory, RegExp[]> = {
  in_danger: [
    /\b(threaten(?:ed|ing)?|stalk(?:ed|ing|er)?|harass(?:ed|ing|ment)?|abus(?:e|ed|ing|ive|er)|attack(?:ed|ing)?|assault(?:ed|ing)?|domestic\s*violence|intimate\s*partner\s*violence|ipv|dv\s*case)\b/i,
    /\b(hit\s*me|hit\s*us|beat(?:\s*me|\s*us|\s*her|\s*him|\s*them|en))\b/i,
    /\b(chok(?:e|ed|ing)|strangl(?:e|ed|ing|ation)|punched|kicked|slapped|grabbed\s*me)\b/i,
    /\b(threatened\s*to\s*kill|going\s*to\s*kill|kill\s*(?:me|her|him|us|them))\b/i,
    /\b(gun|firearm|pistol|rifle|shotgun|knife|weapon|brandish(?:ed)?)\b/i,
    /\b(restraining\s*order|order\s*of\s*protection|civil\s*protection|protective\s*order|no[-\s]contact\s*order)\b/i,
    /\b(afraid\s*for\s*my\s*life|fear(?:ing)?\s*for\s*my\s*safety|in\s*danger|not\s*safe|unsafe)\b/i,
    /\b(forced\s*entry|broke\s*in|broke\s*into|kidnap(?:ped|ping)?|abduct(?:ed|ion)?|trafficked|trafficking)\b/i,
  ],
  injury: [
    /\b(badly\s*(?:hurt|injured|bleeding|wounded)|seriously\s*(?:hurt|injured|wounded))\b/i,
    /\b(bleeding\s*(?:heavily|a\s*lot|out)|won'?t\s*stop\s*bleeding|head\s*injury|head\s*wound)\b/i,
    /\b(broken\s*(?:arm|leg|nose|ribs?|bone|jaw|wrist|ankle)|fractured)\b/i,
    /\b(concuss(?:ed|ion)|blacked?\s*out|unconscious|passed\s*out|knocked\s*out|lost\s*consciousness)\b/i,
    /\b(can'?t\s*breathe|cannot\s*breathe|stopped\s*breathing|not\s*breathing|chest\s*pain|heart\s*attack|stroke)\b/i,
    /\b(need\s*(?:an\s*)?ambulance|need\s*(?:medical|emergency)\s*help|call\s*(?:911|999|112|emergency))\b/i,
    /\b(burned|burn\s*injury|stab(?:bed|bing)?|gunshot|shot\s*me|shot\s*in)\b/i,
  ],
  self_harm: [
    /\b(suicid(?:e|al)|kill\s*myself|killing\s*myself|end\s*my\s*life|take\s*my\s*own\s*life)\b/i,
    /\b(don'?t\s*want\s*to\s*(?:live|be\s*here|exist)|tired\s*of\s*living|no\s*reason\s*to\s*live)\b/i,
    /\b(self[-\s]harm|cutting\s*myself|hurting\s*myself|hurt\s*myself)\b/i,
  ],
  child_safety: [
    /\b(child\s*(?:abuse|abused|in\s*danger|missing|hurt|hit|hitting|neglect(?:ed|ing)?)|minor\s*at\s*risk)\b/i,
    /\b(my\s*kid\s*is\s*(?:hurt|in\s*danger|missing)|child\s*was\s*(?:hit|abducted|taken))\b/i,
    /\bchild\s*protective\s*services|cps\s*(?:case|involved|investigation)\b/i,
  ],
  sexual_violence: [
    /\b(rape(?:d|s)?|sexual\s*assault(?:ed)?|sexually\s*assault(?:ed)?|molest(?:ed|ation)?)\b/i,
    /\b(non[-\s]consensual|without\s*my\s*consent|forced\s*me\s*to)\b/i,
  ],
};

export function detectSafety(text: string | null | undefined): SafetyHit[] {
  if (!text) return [];
  const hits: SafetyHit[] = [];
  (Object.keys(PATTERNS) as SafetyCategory[]).forEach((cat) => {
    for (const re of PATTERNS[cat]) {
      const m = text.match(re);
      if (m) {
        hits.push({ category: cat, matched: m[0] });
        break;
      }
    }
  });
  return hits;
}

export function hasSafetyCue(text: string | null | undefined): boolean {
  return detectSafety(text).length > 0;
}
