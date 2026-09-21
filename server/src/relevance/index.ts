import { getDb, rowToListing, rowToRelevance } from "../db.js";
import { config } from "../config.js";
import { keywordScore, isAmbiguous } from "./keyword.js";
import { llmAvailable, verifyListing } from "./llm.js";
import type { Listing, Relevance } from "../types.js";
import { events } from "../events.js";

export function scoreAndStore(query: string, listing: Listing): Relevance {
  const db = getDb();
  const q = query.trim().toLowerCase();
  const existing = db.prepare("SELECT * FROM relevance WHERE listing_id = ? AND query = ?").get(listing.id, q) as
    | Record<string, unknown>
    | undefined;
  const kw = keywordScore(q, listing.title, listing.description);
  if (existing) {
    const rel = rowToRelevance(existing);
    // Keep the LLM verdict, refresh the keyword score in case the title changed.
    const final = combine(kw.score, rel.llmVerdict, rel.llmConfidence);
    db.prepare("UPDATE relevance SET keyword_score = ?, final_score = ? WHERE listing_id = ? AND query = ?").run(
      kw.score,
      final,
      listing.id,
      q,
    );
    return { ...rel, keywordScore: kw.score, finalScore: final };
  }
  db.prepare(
    "INSERT INTO relevance (listing_id, query, keyword_score, llm_verdict, llm_confidence, llm_reason, final_score, checked_at) VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL)",
  ).run(listing.id, q, kw.score, kw.score);
  return {
    listingId: listing.id,
    query: q,
    keywordScore: kw.score,
    llmVerdict: null,
    llmConfidence: null,
    llmReason: null,
    finalScore: kw.score,
    checkedAt: null,
  };
}

export function combine(keyword: number, verdict: Relevance["llmVerdict"], confidence: number | null): number {
  if (!verdict || verdict === "unsure") return keyword;
  const c = confidence ?? 0.5;
  if (verdict === "match") return Number(Math.max(keyword, 0.6 + 0.4 * c).toFixed(3));
  return Number(Math.min(keyword, 0.4 * (1 - c)).toFixed(3));
}

// ---------- background verification queue ----------

const queue: Array<{ query: string; listingId: string }> = [];
const queued = new Set<string>();
let running = 0;

export function enqueueVerification(query: string, listing: Listing, rel: Relevance): void {
  if (!llmAvailable() || rel.checkedAt) return;
  if (config.verifyMode === "ambiguous" && !isAmbiguous(rel.keywordScore)) return;
  const key = `${rel.query}::${listing.id}`;
  if (queued.has(key)) return;
  queued.add(key);
  queue.push({ query: rel.query, listingId: listing.id });
  pump();
}

export function verificationStatus(): { queued: number; running: number; enabled: boolean } {
  return { queued: queue.length, running, enabled: llmAvailable() };
}

function pump(): void {
  while (running < config.verifyConcurrency && queue.length) {
    const job = queue.shift()!;
    running++;
    runJob(job)
      .catch((err) => console.error("[verify] failed", job, err instanceof Error ? err.message : err))
      .finally(() => {
        running--;
        queued.delete(`${job.query}::${job.listingId}`);
        pump();
      });
  }
}

async function runJob(job: { query: string; listingId: string }): Promise<void> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(job.listingId) as Record<string, unknown> | undefined;
  if (!row) return;
  const listing = rowToListing(row);
  const verdict = await verifyListing(job.query, listing);
  const llmVerdict: Relevance["llmVerdict"] =
    verdict.category === "unclear" ? "unsure" : verdict.is_match ? "match" : "no_match";
  const rel = db.prepare("SELECT keyword_score FROM relevance WHERE listing_id = ? AND query = ?").get(job.listingId, job.query) as
    | { keyword_score: number }
    | undefined;
  const final = combine(rel?.keyword_score ?? 0, llmVerdict, verdict.confidence);
  db.prepare(
    "UPDATE relevance SET llm_verdict = ?, llm_confidence = ?, llm_reason = ?, final_score = ?, checked_at = ? WHERE listing_id = ? AND query = ?",
  ).run(llmVerdict, verdict.confidence, `${verdict.category}: ${verdict.reason}`, final, Date.now(), job.listingId, job.query);
  events.emit("relevance", { query: job.query, listingId: job.listingId, finalScore: final, verdict: llmVerdict });
}
