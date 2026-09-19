import { getDb, rowToListing } from "./db.js";
import { haversineKm } from "./geo.js";
import type { Listing, RawListing, SearchParams } from "./types.js";

export interface IngestResult {
  listings: Listing[];
  newIds: string[];
  priceDrops: Array<{ listing: Listing; from: number; to: number }>;
}

/** Upsert raw listings into SQLite, track price history, link them to the query. */
export function ingest(query: string, params: SearchParams, raws: RawListing[]): IngestResult {
  const db = getDb();
  const now = Date.now();
  const q = query.trim().toLowerCase();
  const newIds: string[] = [];
  const priceDrops: IngestResult["priceDrops"] = [];
  const listings: Listing[] = [];

  const sel = db.prepare("SELECT * FROM listings WHERE id = ?");
  const ins = db.prepare(`INSERT INTO listings
    (id, source, title, description, price, currency, is_free, location_name, lat, lng, approx_location, image_urls, url, seller, condition, posted_at, first_seen_at, last_seen_at, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
  const upd = db.prepare(`UPDATE listings SET title = ?, description = COALESCE(?, description), price = ?, currency = ?, is_free = ?,
    location_name = COALESCE(?, location_name), lat = COALESCE(?, lat), lng = COALESCE(?, lng), approx_location = ?,
    image_urls = CASE WHEN ? = '[]' THEN image_urls ELSE ? END, url = ?, seller = COALESCE(?, seller), condition = COALESCE(?, condition),
    posted_at = COALESCE(?, posted_at), last_seen_at = ?, active = 1 WHERE id = ?`);
  const hist = db.prepare("INSERT INTO price_history (listing_id, price, seen_at) VALUES (?, ?, ?)");
  const link = db.prepare(
    "INSERT INTO search_results (query, listing_id, seen_at) VALUES (?, ?, ?) ON CONFLICT(query, listing_id) DO UPDATE SET seen_at = excluded.seen_at",
  );

  db.exec("BEGIN");
  try {
    for (const r of raws) {
      const isFree = r.price === 0 ? 1 : 0;
      const imgs = JSON.stringify(r.imageUrls ?? []);
      const existing = sel.get(r.id) as Record<string, unknown> | undefined;
      if (!existing) {
        ins.run(
          r.id, r.source, r.title, r.description ?? null, r.price ?? null, r.currency ?? "USD", isFree,
          r.locationName ?? null, r.lat ?? null, r.lng ?? null, r.approxLocation ? 1 : 0, imgs, r.url,
          r.seller ?? null, r.condition ?? null, r.postedAt ?? null, now, now,
        );
        hist.run(r.id, r.price ?? null, now);
        newIds.push(r.id);
      } else {
        const prev = existing.price == null ? null : Number(existing.price);
        upd.run(
          r.title, r.description ?? null, r.price ?? null, r.currency ?? "USD", isFree,
          r.locationName ?? null, r.lat ?? null, r.lng ?? null, r.approxLocation ? 1 : 0,
          imgs, imgs, r.url, r.seller ?? null, r.condition ?? null, r.postedAt ?? null, now, r.id,
        );
        if (prev !== (r.price ?? null)) {
          hist.run(r.id, r.price ?? null, now);
          if (prev != null && r.price != null && r.price < prev) {
            priceDrops.push({ listing: rowToListing(sel.get(r.id) as Record<string, unknown>), from: prev, to: r.price });
          }
        }
      }
      link.run(q, r.id, now);
      listings.push(rowToListing(sel.get(r.id) as Record<string, unknown>));
    }
    // Listings previously linked to this query but absent from a fresh fetch are marked inactive
    // only when the fetch returned a healthy number of results (avoid wiping on a bad scrape).
    if (raws.length >= 5) {
      db.prepare(
        `UPDATE listings SET active = 0 WHERE id IN (
           SELECT listing_id FROM search_results WHERE query = ? AND seen_at < ?
         ) AND last_seen_at < ?`,
      ).run(q, now, now);
    }
    db.prepare(
      "INSERT INTO searches (query, last_run_at, last_status, last_count) VALUES (?, ?, 'ok', ?) ON CONFLICT(query) DO UPDATE SET last_run_at = excluded.last_run_at, last_status = 'ok', last_count = excluded.last_count",
    ).run(q, now, raws.length);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { listings, newIds, priceDrops };
}

export function distanceFor(l: Listing, lat: number, lng: number): number | null {
  if (l.lat == null || l.lng == null) return null;
  return Number(haversineKm(lat, lng, l.lat, l.lng).toFixed(1));
}
