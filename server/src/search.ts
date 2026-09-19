import { getDb, rowToListing, rowToRelevance } from "./db.js";
import { events } from "./events.js";
import { ingest, distanceFor, type IngestResult } from "./ingest.js";
import { enqueueVerification, scoreAndStore } from "./relevance/index.js";
import { getSource } from "./sources/index.js";
import type { Listing, Relevance, SearchParams } from "./types.js";
import { priceGroupFor } from "./types.js";
import { filterAndSort, type ListingQuery, type ListingView } from "./filtering.js";

export interface JobState {
  id: string;
  query: string;
  status: "running" | "done" | "error";
  message: string;
  startedAt: number;
  finishedAt: number | null;
  count: number;
  error: string | null;
}

const jobs = new Map<string, JobState>();
const inflight = new Map<string, Promise<IngestResult>>();

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getJob(query: string): JobState | null {
  return jobs.get(normalizeQuery(query)) ?? null;
}

/**
 * Run a search against the configured source. Concurrent calls for the same
 * query share one fetch. Emits "job" and "listings" events for the SSE stream.
 */
export function runSearch(params: SearchParams): Promise<IngestResult> {
  const q = normalizeQuery(params.query);
  const existing = inflight.get(q);
  if (existing) return existing;

  const job: JobState = {
    id: `${q}:${Date.now()}`,
    query: q,
    status: "running",
    message: "Starting",
    startedAt: Date.now(),
    finishedAt: null,
    count: 0,
    error: null,
  };
  jobs.set(q, job);
  const emit = () => events.emit("job", { ...job });
  emit();

  const p = (async () => {
    try {
      const source = getSource();
      const raws = await source.fetch({ ...params, query: q }, (msg) => {
        job.message = msg;
        emit();
      });
      const result = ingest(q, params, raws);
      for (const l of result.listings) {
        const rel = scoreAndStore(q, l);
        enqueueVerification(q, l, rel);
      }
      job.status = "done";
      job.count = result.listings.length;
      job.message = `Found ${result.listings.length} listings`;
      job.finishedAt = Date.now();
      emit();
      events.emit("listings", { query: q, count: result.listings.length, newIds: result.newIds });
      return result;
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      job.message = "Failed";
      job.finishedAt = Date.now();
      getDb()
        .prepare(
          "INSERT INTO searches (query, last_run_at, last_status, last_count) VALUES (?, ?, ?, 0) ON CONFLICT(query) DO UPDATE SET last_run_at = excluded.last_run_at, last_status = excluded.last_status",
        )
        .run(q, Date.now(), `error: ${job.error}`);
      emit();
      throw err;
    } finally {
      inflight.delete(q);
    }
  })();
  inflight.set(q, p);
  return p;
}

// ---------- querying stored results ----------

export type { ListingQuery, ListingView } from "./filtering.js";

export function queryListings(opts: ListingQuery): { items: ListingView[]; total: number } {
  const db = getDb();
  const q = normalizeQuery(opts.query);
  const rows = db
    .prepare(
      `SELECT l.*, r.query AS r_query, r.keyword_score, r.llm_verdict, r.llm_confidence, r.llm_reason, r.final_score, r.checked_at
       FROM search_results s
       JOIN listings l ON l.id = s.listing_id
       LEFT JOIN relevance r ON r.listing_id = l.id AND r.query = s.query
       WHERE s.query = ?`,
    )
    .all(q) as Record<string, unknown>[];

  const dayAgo = Date.now() - 86_400_000;
  const watchMap = watchIdsByListing();

  const items: ListingView[] = rows.map((r) => {
    const l = rowToListing(r);
    const rel = r.r_query
      ? rowToRelevance({
          listing_id: l.id,
          query: r.r_query,
          keyword_score: r.keyword_score,
          llm_verdict: r.llm_verdict,
          llm_confidence: r.llm_confidence,
          llm_reason: r.llm_reason,
          final_score: r.final_score,
          checked_at: r.checked_at,
        })
      : null;
    const hist = db
      .prepare("SELECT price FROM price_history WHERE listing_id = ? ORDER BY seen_at DESC LIMIT 2")
      .all(l.id) as Array<{ price: number | null }>;
    const prev = hist.length === 2 ? hist[1].price : null;
    return {
      ...l,
      distanceKm: distanceFor(l, opts.lat, opts.lng),
      relevance: rel,
      priceGroup: priceGroupFor(l),
      isNew: l.firstSeenAt >= dayAgo,
      priceDropped: prev != null && l.price != null && l.price < prev,
      previousPrice: prev,
      watchIds: watchMap.get(l.id) ?? [],
    };
  });

  return filterAndSort(items, opts);
}

function watchIdsByListing(): Map<string, number[]> {
  const rows = getDb().prepare("SELECT watch_id, listing_id FROM watch_matches").all() as Array<{ watch_id: number; listing_id: string }>;
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const arr = m.get(r.listing_id) ?? [];
    arr.push(r.watch_id);
    m.set(r.listing_id, arr);
  }
  return m;
}

export function listSearches(): Array<{ query: string; lastRunAt: number | null; lastStatus: string | null; lastCount: number | null }> {
  return (getDb().prepare("SELECT * FROM searches ORDER BY last_run_at DESC").all() as Record<string, unknown>[]).map((r) => ({
    query: String(r.query),
    lastRunAt: r.last_run_at == null ? null : Number(r.last_run_at),
    lastStatus: (r.last_status as string | null) ?? null,
    lastCount: r.last_count == null ? null : Number(r.last_count),
  }));
}
