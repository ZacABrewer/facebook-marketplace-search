import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config, ensureDataDir } from "./config.js";
import type { Listing, Notification, Relevance, Watch } from "./types.js";

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  ensureDataDir();
  db = new DatabaseSync(path.join(config.dataDir, "marketplace.sqlite"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

/** Open an isolated in-memory database (tests). */
export function openMemoryDb(): DatabaseSync {
  const mem = new DatabaseSync(":memory:");
  migrate(mem);
  db = mem;
  return mem;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      price REAL,
      currency TEXT NOT NULL DEFAULT 'USD',
      is_free INTEGER NOT NULL DEFAULT 0,
      location_name TEXT,
      lat REAL,
      lng REAL,
      approx_location INTEGER NOT NULL DEFAULT 0,
      image_urls TEXT NOT NULL DEFAULT '[]',
      url TEXT NOT NULL,
      seller TEXT,
      condition TEXT,
      posted_at INTEGER,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      favorite INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_listings_price ON listings(price);
    CREATE INDEX IF NOT EXISTS idx_listings_seen ON listings(last_seen_at);

    CREATE TABLE IF NOT EXISTS price_history (
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      price REAL,
      seen_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_price_history ON price_history(listing_id, seen_at);

    CREATE TABLE IF NOT EXISTS relevance (
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      keyword_score REAL NOT NULL,
      llm_verdict TEXT,
      llm_confidence REAL,
      llm_reason TEXT,
      final_score REAL NOT NULL,
      checked_at INTEGER,
      PRIMARY KEY (listing_id, query)
    );

    CREATE TABLE IF NOT EXISTS search_results (
      query TEXT NOT NULL,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY (query, listing_id)
    );

    CREATE TABLE IF NOT EXISTS searches (
      query TEXT PRIMARY KEY,
      last_run_at INTEGER,
      last_status TEXT,
      last_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS watches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      location_name TEXT,
      location_slug TEXT,
      radius_km REAL NOT NULL,
      min_price REAL,
      max_price REAL,
      must_include TEXT NOT NULL DEFAULT '[]',
      must_exclude TEXT NOT NULL DEFAULT '[]',
      min_relevance REAL NOT NULL DEFAULT 0.5,
      require_verified INTEGER NOT NULL DEFAULT 0,
      notify_new INTEGER NOT NULL DEFAULT 1,
      notify_price_drop INTEGER NOT NULL DEFAULT 1,
      notify_free INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      interval_minutes INTEGER NOT NULL DEFAULT 15,
      last_run_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watch_matches (
      watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
      listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      matched_at INTEGER NOT NULL,
      last_price REAL,
      PRIMARY KEY (watch_id, listing_id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watch_id INTEGER REFERENCES watches(id) ON DELETE SET NULL,
      listing_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS geocache (
      query TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      display_name TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    );
  `);
}

// ---------- row mappers ----------

type Row = Record<string, unknown>;

export function rowToListing(r: Row): Listing {
  return {
    id: String(r.id),
    source: r.source as Listing["source"],
    title: String(r.title),
    description: (r.description as string | null) ?? null,
    price: r.price == null ? null : Number(r.price),
    currency: String(r.currency ?? "USD"),
    isFree: Boolean(r.is_free),
    locationName: (r.location_name as string | null) ?? null,
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
    approxLocation: Boolean(r.approx_location),
    imageUrls: safeJson<string[]>(r.image_urls, []),
    url: String(r.url),
    seller: (r.seller as string | null) ?? null,
    condition: (r.condition as string | null) ?? null,
    postedAt: r.posted_at == null ? null : Number(r.posted_at),
    firstSeenAt: Number(r.first_seen_at),
    lastSeenAt: Number(r.last_seen_at),
    active: Boolean(r.active),
    favorite: Boolean(r.favorite),
    hidden: Boolean(r.hidden),
    note: (r.note as string | null) ?? null,
  };
}

export function rowToRelevance(r: Row): Relevance {
  return {
    listingId: String(r.listing_id),
    query: String(r.query),
    keywordScore: Number(r.keyword_score),
    llmVerdict: (r.llm_verdict as Relevance["llmVerdict"]) ?? null,
    llmConfidence: r.llm_confidence == null ? null : Number(r.llm_confidence),
    llmReason: (r.llm_reason as string | null) ?? null,
    finalScore: Number(r.final_score),
    checkedAt: r.checked_at == null ? null : Number(r.checked_at),
  };
}

export function rowToWatch(r: Row): Watch {
  return {
    id: Number(r.id),
    name: String(r.name),
    query: String(r.query),
    lat: Number(r.lat),
    lng: Number(r.lng),
    locationName: (r.location_name as string | null) ?? null,
    locationSlug: (r.location_slug as string | null) ?? null,
    radiusKm: Number(r.radius_km),
    minPrice: r.min_price == null ? null : Number(r.min_price),
    maxPrice: r.max_price == null ? null : Number(r.max_price),
    mustInclude: safeJson<string[]>(r.must_include, []),
    mustExclude: safeJson<string[]>(r.must_exclude, []),
    minRelevance: Number(r.min_relevance),
    requireVerified: Boolean(r.require_verified),
    notifyNew: Boolean(r.notify_new),
    notifyPriceDrop: Boolean(r.notify_price_drop),
    notifyFree: Boolean(r.notify_free),
    enabled: Boolean(r.enabled),
    intervalMinutes: Number(r.interval_minutes),
    lastRunAt: r.last_run_at == null ? null : Number(r.last_run_at),
    createdAt: Number(r.created_at),
  };
}

export function rowToNotification(r: Row): Notification {
  return {
    id: Number(r.id),
    watchId: r.watch_id == null ? null : Number(r.watch_id),
    listingId: (r.listing_id as string | null) ?? null,
    kind: r.kind as Notification["kind"],
    title: String(r.title),
    body: String(r.body),
    createdAt: Number(r.created_at),
    readAt: r.read_at == null ? null : Number(r.read_at),
  };
}

export function safeJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

// ---------- settings ----------

export function getSetting<T>(key: string, fallback: T): T {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
  if (!row) return fallback;
  return safeJson<T>(row.value, fallback);
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, JSON.stringify(value));
}
