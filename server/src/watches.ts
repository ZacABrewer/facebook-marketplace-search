import { getDb, rowToWatch } from "./db.js";
import { config } from "./config.js";
import { events } from "./events.js";
import { notify } from "./notify.js";
import { runSearch, queryListings, normalizeQuery, type ListingView } from "./search.js";
import type { Watch } from "./types.js";

export type WatchInput = Omit<Watch, "id" | "createdAt" | "lastRunAt">;

export function listWatches(): Watch[] {
  return (getDb().prepare("SELECT * FROM watches ORDER BY created_at DESC").all() as Record<string, unknown>[]).map(rowToWatch);
}

export function getWatch(id: number): Watch | null {
  const r = getDb().prepare("SELECT * FROM watches WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? rowToWatch(r) : null;
}

export function createWatch(w: WatchInput): Watch {
  const res = getDb()
    .prepare(
      `INSERT INTO watches (name, query, lat, lng, location_name, location_slug, radius_km, min_price, max_price, must_include, must_exclude,
        min_relevance, require_verified, notify_new, notify_price_drop, notify_free, enabled, interval_minutes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      w.name || w.query, normalizeQuery(w.query), w.lat, w.lng, w.locationName, w.locationSlug, w.radiusKm, w.minPrice, w.maxPrice,
      JSON.stringify(w.mustInclude), JSON.stringify(w.mustExclude), w.minRelevance, w.requireVerified ? 1 : 0,
      w.notifyNew ? 1 : 0, w.notifyPriceDrop ? 1 : 0, w.notifyFree ? 1 : 0, w.enabled ? 1 : 0, Math.max(1, w.intervalMinutes), Date.now(),
    );
  return getWatch(Number(res.lastInsertRowid))!;
}

export function updateWatch(id: number, w: Partial<WatchInput>): Watch | null {
  const cur = getWatch(id);
  if (!cur) return null;
  const m = { ...cur, ...w };
  getDb()
    .prepare(
      `UPDATE watches SET name = ?, query = ?, lat = ?, lng = ?, location_name = ?, location_slug = ?, radius_km = ?, min_price = ?, max_price = ?,
        must_include = ?, must_exclude = ?, min_relevance = ?, require_verified = ?, notify_new = ?, notify_price_drop = ?, notify_free = ?,
        enabled = ?, interval_minutes = ? WHERE id = ?`,
    )
    .run(
      m.name, normalizeQuery(m.query), m.lat, m.lng, m.locationName, m.locationSlug, m.radiusKm, m.minPrice, m.maxPrice,
      JSON.stringify(m.mustInclude), JSON.stringify(m.mustExclude), m.minRelevance, m.requireVerified ? 1 : 0,
      m.notifyNew ? 1 : 0, m.notifyPriceDrop ? 1 : 0, m.notifyFree ? 1 : 0, m.enabled ? 1 : 0, Math.max(1, m.intervalMinutes), id,
    );
  return getWatch(id);
}

export function deleteWatch(id: number): void {
  getDb().prepare("DELETE FROM watches WHERE id = ?").run(id);
}

export function watchMatches(id: number): ListingView[] {
  const w = getWatch(id);
  if (!w) return [];
  const { items } = queryListings({ query: w.query, lat: w.lat, lng: w.lng, radiusKm: w.radiusKm, includeInactive: true, showHidden: true, limit: 500 });
  const ids = new Set(
    (getDb().prepare("SELECT listing_id FROM watch_matches WHERE watch_id = ?").all(id) as Array<{ listing_id: string }>).map((r) => r.listing_id),
  );
  return items.filter((i) => ids.has(i.id));
}

/** Pure criteria check, exported for tests. */
export function listingMeetsWatch(w: Pick<Watch, "minPrice" | "maxPrice" | "mustInclude" | "mustExclude" | "minRelevance" | "requireVerified">, it: ListingView): boolean {
  const text = `${it.title} ${it.description ?? ""}`.toLowerCase();
  if (w.mustInclude.some((k) => k && !text.includes(k.toLowerCase()))) return false;
  if (w.mustExclude.some((k) => k && text.includes(k.toLowerCase()))) return false;
  const price = it.isFree ? 0 : it.price;
  if (w.maxPrice != null && (price == null || price > w.maxPrice)) return false;
  if (w.minPrice != null && (price ?? 0) < w.minPrice) return false;
  if ((it.relevance?.finalScore ?? 0) < w.minRelevance) return false;
  if (w.requireVerified && it.relevance?.llmVerdict !== "match") return false;
  return true;
}

/** Run one watch now: fetch, evaluate criteria, record matches and send notifications. */
export async function runWatch(id: number, opts: { fetch?: boolean } = {}): Promise<{ matches: number; notified: number }> {
  const w = getWatch(id);
  if (!w) throw new Error("Watch not found");
  const db = getDb();
  if (opts.fetch !== false) {
    await runSearch({ query: w.query, lat: w.lat, lng: w.lng, radiusKm: w.radiusKm, minPrice: w.minPrice, maxPrice: w.maxPrice, locationSlug: w.locationSlug });
  }
  const { items } = queryListings({ query: w.query, lat: w.lat, lng: w.lng, radiusKm: w.radiusKm, limit: 1000 });
  const known = new Map(
    (db.prepare("SELECT listing_id, last_price FROM watch_matches WHERE watch_id = ?").all(id) as Array<{ listing_id: string; last_price: number | null }>).map(
      (r) => [r.listing_id, r.last_price],
    ),
  );
  let matches = 0;
  let notified = 0;
  for (const it of items) {
    if (!listingMeetsWatch(w, it)) continue;
    matches++;
    const price = it.isFree ? 0 : it.price;
    if (!known.has(it.id)) {
      db.prepare("INSERT INTO watch_matches (watch_id, listing_id, matched_at, last_price) VALUES (?, ?, ?, ?)").run(id, it.id, Date.now(), price);
      const free = it.priceGroup === "free";
      if ((free && w.notifyFree) || (!free && w.notifyNew)) {
        await notify({
          watchId: id,
          listingId: it.id,
          kind: free ? "free" : "new_match",
          title: free ? `Free: ${it.title}` : `New match for "${w.name}"`,
          body: `${it.title} · ${free ? "Free" : price == null ? "price unknown" : `$${price}`}${it.distanceKm != null ? ` · ${it.distanceKm} km away` : ""}`,
        });
        notified++;
      }
    } else {
      const prev = known.get(it.id);
      if (prev != null && price != null && price < prev) {
        db.prepare("UPDATE watch_matches SET last_price = ? WHERE watch_id = ? AND listing_id = ?").run(price, id, it.id);
        if (w.notifyPriceDrop) {
          await notify({
            watchId: id,
            listingId: it.id,
            kind: "price_drop",
            title: `Price drop: ${it.title}`,
            body: `$${prev} → $${price}${it.distanceKm != null ? ` · ${it.distanceKm} km away` : ""}`,
          });
          notified++;
        }
      } else if (price !== prev) {
        db.prepare("UPDATE watch_matches SET last_price = ? WHERE watch_id = ? AND listing_id = ?").run(price, id, it.id);
      }
    }
  }
  db.prepare("UPDATE watches SET last_run_at = ? WHERE id = ?").run(Date.now(), id);
  events.emit("watch", { id, matches, notified });
  return { matches, notified };
}

let timer: NodeJS.Timeout | null = null;
let ticking = false;

export function startScheduler(): void {
  if (timer) return;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      for (const w of listWatches()) {
        if (!w.enabled) continue;
        const due = w.lastRunAt == null || now - w.lastRunAt >= w.intervalMinutes * 60_000;
        if (!due) continue;
        try {
          await runWatch(w.id);
        } catch (err) {
          console.error(`[scheduler] watch ${w.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      ticking = false;
    }
  };
  timer = setInterval(tick, config.schedulerTickSeconds * 1000);
  timer.unref();
  void tick();
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
