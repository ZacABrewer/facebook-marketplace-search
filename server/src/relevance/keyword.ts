/**
 * Fast, local relevance scoring. Runs on every listing at ingest so results
 * can be shown immediately; the Claude cross-check refines ambiguous cases.
 */

const STOP = new Set(["a", "an", "the", "for", "of", "and", "or", "with", "in", "on", "to", "&"]);

/** Words that usually mean the listing is an accessory / part / service, not the item itself. */
const ACCESSORY_WORDS = [
  "case", "cover", "holder", "mount", "rack", "stand", "strap", "bag", "charger", "cable", "adapter",
  "parts", "part", "repair", "service", "replacement", "accessory", "accessories", "attachment", "kit",
  "manual", "box only", "empty box", "sticker", "decal", "skin", "screen protector", "battery only",
  "for parts", "not working", "broken", "wanted", "iso", "looking for", "want to buy", "wtb", "trade for",
  "rental", "rent", "lessons", "poster", "print", "toy", "model", "miniature", "replica", "sleeve", "pouch",
];

/** Words that suggest this IS the real item, even when accessory words appear. */
const ITEM_WORDS = ["comes with", "includes", "included", "bundle", "with case", "with cover", "with charger"];

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t && !STOP.has(t));
}

/** Loose stemming: strips plural/possessive suffixes so "bikes" matches "bike". */
export function stem(t: string): string {
  if (t.length <= 3) return t;
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (/(sses|shes|ches|xes|zes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

function matches(queryTok: string, textTok: string): boolean {
  const a = stem(queryTok);
  const b = stem(textTok);
  if (a === b) return true;
  // prefix match for longer tokens ("kayak" vs "kayaking")
  return a.length >= 4 && b.startsWith(a);
}

export interface KeywordResult {
  score: number;
  matchedTokens: number;
  totalTokens: number;
  accessoryHit: string | null;
  titleHasPhrase: boolean;
}

export function keywordScore(query: string, title: string, description: string | null | undefined): KeywordResult {
  const q = tokenize(query);
  const titleToks = tokenize(title);
  const descToks = tokenize(description ?? "");
  const total = q.length || 1;

  let matchedTitle = 0;
  let matchedDesc = 0;
  for (const qt of q) {
    if (titleToks.some((t) => matches(qt, t))) matchedTitle++;
    else if (descToks.some((t) => matches(qt, t))) matchedDesc++;
  }
  const lowerTitle = title.toLowerCase();
  const lowerAll = `${lowerTitle} ${(description ?? "").toLowerCase()}`;
  const titleHasPhrase = q.length > 0 && lowerTitle.includes(query.toLowerCase().trim());

  // Title matches count fully, description matches half.
  let score = (matchedTitle + 0.5 * matchedDesc) / total;
  if (titleHasPhrase) score = Math.min(1, score + 0.15);

  let accessoryHit: string | null = null;
  // "kayak not included" must not count as "included".
  const positiveText = lowerAll.replace(/\bnot (included|includes)\b/g, "");
  const protectedByItemWords = ITEM_WORDS.some((w) => positiveText.includes(w));
  for (const w of ACCESSORY_WORDS) {
    const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(lowerTitle)) {
      accessoryHit = w;
      break;
    }
  }
  if (accessoryHit && !protectedByItemWords) {
    // "kayak rack" when searching "kayak": strongly demote.
    score *= 0.35;
  }
  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(3)))),
    matchedTokens: matchedTitle + matchedDesc,
    totalTokens: q.length,
    accessoryHit,
    titleHasPhrase,
  };
}

/** Score bands the verifier uses to decide what needs a second opinion. */
export function isAmbiguous(score: number): boolean {
  return score >= 0.25 && score < 0.9;
}
