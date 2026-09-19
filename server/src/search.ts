import { getDb, rowToListing, rowToRelevance } from "./db.js";
import { events } from "./events.js";
import { ingest, distanceFor, type IngestResult } from "./ingest.js";
import { enqueueVerification, scoreAndStore } from "./relevance/index.js";
import { getSource } from "./sources/index.js";
import type { Listing, Relevance, SearchParams } from "./types.js";
import { priceGroupFor } from "./types.js";

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

export interface ListingQuery {
  query: string;
  lat: number;
  lng: number;
  radiusKm: number;
  minPrice?: number | null;
  maxPrice?: number | null;
  includeFree?: boolean;
  onlyFree?: boolean;
  priceGroup?: string | null;
  minRelevance?: number | null;
  verifiedOnly?: boolean;
  conditions?: string[];
  exclude?: string[]; // words to exclude from title
  postedWithinDays?: number | null;
  hasPhoto?: boolean;
  showHidden?: boolean;
  favoritesOnly?: boolean;
  includeInactive?: boolean;
  sort?: "relevance" | "price_asc" | "price_desc" | "distance" | "newest" | "recently_seen";
  limit?: number;
  offset?: number;
}

export interface ListingView extends Listing {
  distanceKm: number | null;
  relevance: Relevance | null;
  priceGroup: string;
  isNew: boolean; // first seen in the last 24h
  priceDropped: boolean;
  previousPrice: number | null;
  watchIds: number[];
}

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
  const excl = (opts.exclude ?? []).map((w) => w.toLowerCase()).filter(Boolean);
  const conds = (opts.conditions ?? []).map((c) => c.toLowerCase());
  const watchMap = watchIdsByListing();

  let items: ListingView[] = rows.map((r) => {
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

  items = items.filter((it) => {
    if (!opts.includeInactive && !it.active) return false;
    if (!opts.showHidden && it.hidden) return false;
    if (opts.favoritesOnly && !it.favorite) return false;
    if (it.distanceKm != null && it.distanceKm > opts.radiusKm) return false;
    if (opts.onlyFree && it.priceGroup !== "free") return false;
    if (opts.priceGroup && it.priceGroup !== opts.priceGroup) return false;
    if (!opts.onlyFree && !opts.priceGroup) {
      if (opts.minPrice != null && (it.price ?? 0) < opts.minPrice && !(opts.includeFree && it.priceGroup === "free")) return false;
      if (opts.maxPrice != null && it.price != null && it.price > opts.maxPrice) return false;
    }
    if (opts.minRelevance != null && (it.relevance?.finalScore ?? 0) < opts.minRelevance) return false;
    if (opts.verifiedOnly && it.relevance?.llmVerdict !== "match") return false;
    if (conds.length && !conds.includes((it.condition ?? "").toLowerCase())) return false;
    if (excl.length && excl.some((w) => it.title.toLowerCase().includes(w))) return false;
    if (opts.postedWithinDays && it.postedAt != null && it.postedAt < Date.now() - opts.postedWithinDays * 86_400_000) return false;
    if (opts.hasPhoto && !it.imageUrls.length) return false;
    return true;
  });

  const sort = opts.sort ?? "relevance";
  items.sort((a, b) => {
    switch (sort) {
      case "price_asc":
        return (a.price ?? Infinity) - (b.price ?? Infinity);
      case "price_desc":
        return (b.price ?? -1) - (a.price ?? -1);
      case "distance":
        return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
      case "newest":
        return (b.postedAt ?? b.firstSeenAt) - (a.postedAt ?? a.firstSeenAt);
      case "recently_seen":
        return b.lastSeenAt - a.lastSeenAt;
      default: {
        const d = (b.relevance?.finalScore ?? 0) - (a.relevance?.finalScore ?? 0);
        return d !== 0 ? d : (b.postedAt ?? 0) - (a.postedAt ?? 0);
      }
    }
  });

  const total = items.length;
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 200;
  return { items: items.slice(offset, offset + limit), total };
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
