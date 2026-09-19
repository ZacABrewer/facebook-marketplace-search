import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb, getSetting, rowToListing, setSetting } from "../db.js";
import { config, hasClaudeCredentials } from "../config.js";
import { events } from "../events.js";
import { geocode } from "../geo.js";
import { getNotifySettings, listNotifications, markRead, unreadCount } from "../notify.js";
import { verificationStatus, enqueueVerification, scoreAndStore } from "../relevance/index.js";
import { getJob, listSearches, normalizeQuery, queryListings, runSearch } from "../search.js";
import { PRICE_GROUPS } from "../types.js";
import { createWatch, deleteWatch, getWatch, listWatches, runWatch, updateWatch, watchMatches } from "../watches.js";

const num = z.coerce.number();
const optNum = z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().nullable());
const bool = z.preprocess((v) => v === true || v === "true" || v === "1", z.boolean());
const list = z.preprocess((v) => (Array.isArray(v) ? v : typeof v === "string" && v ? v.split(",") : []), z.array(z.string()));

const SearchBody = z.object({
  query: z.string().min(1),
  lat: num,
  lng: num,
  radiusKm: num.default(40),
  minPrice: optNum.optional(),
  maxPrice: optNum.optional(),
  locationSlug: z.string().nullish(),
  daysSinceListed: optNum.optional(),
});

const ListingsQuery = z.object({
  query: z.string().min(1),
  lat: num,
  lng: num,
  radiusKm: num.default(40),
  minPrice: optNum.optional(),
  maxPrice: optNum.optional(),
  includeFree: bool.optional(),
  onlyFree: bool.optional(),
  priceGroup: z.string().nullish(),
  minRelevance: optNum.optional(),
  verifiedOnly: bool.optional(),
  conditions: list.optional(),
  exclude: list.optional(),
  postedWithinDays: optNum.optional(),
  hasPhoto: bool.optional(),
  showHidden: bool.optional(),
  favoritesOnly: bool.optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "distance", "newest", "recently_seen"]).optional(),
  limit: num.optional(),
  offset: num.optional(),
});

const WatchBody = z.object({
  name: z.string().default(""),
  query: z.string().min(1),
  lat: num,
  lng: num,
  locationName: z.string().nullish().default(null),
  locationSlug: z.string().nullish().default(null),
  radiusKm: num.default(40),
  minPrice: optNum.default(null),
  maxPrice: optNum.default(null),
  mustInclude: z.array(z.string()).default([]),
  mustExclude: z.array(z.string()).default([]),
  minRelevance: num.default(0.5),
  requireVerified: z.boolean().default(false),
  notifyNew: z.boolean().default(true),
  notifyPriceDrop: z.boolean().default(true),
  notifyFree: z.boolean().default(true),
  enabled: z.boolean().default(true),
  intervalMinutes: num.default(15),
});

export interface HomeSettings {
  locationName: string;
  lat: number;
  lng: number;
  radiusKm: number;
  locationSlug: string;
}

export async function apiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/health", async () => ({ ok: true, source: config.source, verify: verificationStatus() }));

  app.get("/api/settings", async () => ({
    home: getSetting<HomeSettings | null>("home", null),
    notify: getNotifySettings(),
    source: config.source,
    verifyMode: config.verifyMode,
    claudeConfigured: hasClaudeCredentials(),
    claudeModel: config.claudeModel,
    facebookCookiesConfigured: Boolean(config.facebookCookies),
    priceGroups: PRICE_GROUPS,
  }));

  app.put("/api/settings", async (req) => {
    const body = z
      .object({
        home: z.object({ locationName: z.string(), lat: num, lng: num, radiusKm: num, locationSlug: z.string().default("") }).optional(),
        notify: z.object({ webhookUrl: z.string(), ntfyTopic: z.string(), ntfyServer: z.string() }).optional(),
      })
      .parse(req.body);
    if (body.home) setSetting("home", body.home);
    if (body.notify) setSetting("notify", body.notify);
    return { ok: true };
  });

  app.get("/api/geocode", async (req, reply) => {
    const { q } = z.object({ q: z.string().min(1) }).parse(req.query);
    try {
      const r = await geocode(q);
      if (!r) return reply.code(404).send({ error: "No results" });
      return r;
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "Geocoding failed" });
    }
  });

  /** Kick off (or join) a fetch for a query. Returns immediately; results stream in via SSE. */
  app.post("/api/search", async (req) => {
    const body = SearchBody.parse(req.body);
    const q = normalizeQuery(body.query);
    const job = getJob(q);
    if (!job || job.status !== "running") {
      void runSearch({ ...body, query: q }).catch(() => undefined);
    }
    return { query: q, job: getJob(q) };
  });

  app.get("/api/search/status", async (req) => {
    const { query } = z.object({ query: z.string() }).parse(req.query);
    return { job: getJob(query), verify: verificationStatus() };
  });

  app.get("/api/searches", async () => listSearches());

  app.delete("/api/searches/:query", async (req) => {
    const q = normalizeQuery(decodeURIComponent((req.params as { query: string }).query));
    const db = getDb();
    db.prepare("DELETE FROM search_results WHERE query = ?").run(q);
    db.prepare("DELETE FROM relevance WHERE query = ?").run(q);
    db.prepare("DELETE FROM searches WHERE query = ?").run(q);
    return { ok: true };
  });

  app.get("/api/listings", async (req) => {
    const qy = ListingsQuery.parse(req.query);
    return queryListings(qy);
  });

  app.get("/api/listings/groups", async (req) => {
    const qy = ListingsQuery.parse(req.query);
    const groups: Record<string, number> = {};
    const { items } = queryListings({ ...qy, priceGroup: null, onlyFree: false, minPrice: null, maxPrice: null, limit: 10_000 });
    for (const it of items) groups[it.priceGroup] = (groups[it.priceGroup] ?? 0) + 1;
    return { groups: PRICE_GROUPS.map((g) => ({ ...g, count: groups[g.key] ?? 0 })), unknown: groups.unknown ?? 0 };
  });

  app.get("/api/listings/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const db = getDb();
    const row = db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: "Not found" });
    const history = db.prepare("SELECT price, seen_at AS seenAt FROM price_history WHERE listing_id = ? ORDER BY seen_at").all(id);
    const relevance = db.prepare("SELECT * FROM relevance WHERE listing_id = ?").all(id);
    return { listing: rowToListing(row), history, relevance };
  });

  app.patch("/api/listings/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const body = z.object({ favorite: z.boolean().optional(), hidden: z.boolean().optional(), note: z.string().nullable().optional() }).parse(req.body);
    const db = getDb();
    if (!db.prepare("SELECT 1 FROM listings WHERE id = ?").get(id)) return reply.code(404).send({ error: "Not found" });
    if (body.favorite != null) db.prepare("UPDATE listings SET favorite = ? WHERE id = ?").run(body.favorite ? 1 : 0, id);
    if (body.hidden != null) db.prepare("UPDATE listings SET hidden = ? WHERE id = ?").run(body.hidden ? 1 : 0, id);
    if (body.note !== undefined) db.prepare("UPDATE listings SET note = ? WHERE id = ?").run(body.note, id);
    return rowToListing(db.prepare("SELECT * FROM listings WHERE id = ?").get(id) as Record<string, unknown>);
  });

  /** Force a Claude cross-check for one listing regardless of verify mode. */
  app.post("/api/listings/:id/verify", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const { query } = z.object({ query: z.string().min(1) }).parse(req.body);
    const row = getDb().prepare("SELECT * FROM listings WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: "Not found" });
    if (!hasClaudeCredentials()) return reply.code(400).send({ error: "ANTHROPIC_API_KEY is not set on the server" });
    const listing = rowToListing(row);
    const rel = scoreAndStore(query, listing);
    getDb().prepare("UPDATE relevance SET checked_at = NULL WHERE listing_id = ? AND query = ?").run(id, normalizeQuery(query));
    const prevMode = config.verifyMode;
    config.verifyMode = "all";
    try {
      enqueueVerification(normalizeQuery(query), listing, { ...rel, checkedAt: null });
    } finally {
      config.verifyMode = prevMode;
    }
    return { queued: true };
  });

  // ---- watches ----
  app.get("/api/watches", async () =>
    listWatches().map((w) => ({
      ...w,
      matchCount: Number((getDb().prepare("SELECT COUNT(*) AS c FROM watch_matches WHERE watch_id = ?").get(w.id) as { c: number }).c),
    })),
  );
  app.post("/api/watches", async (req) => createWatch(WatchBody.parse(req.body)));
  app.put("/api/watches/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const w = updateWatch(id, WatchBody.partial().parse(req.body));
    return w ?? reply.code(404).send({ error: "Not found" });
  });
  app.delete("/api/watches/:id", async (req) => {
    deleteWatch(Number((req.params as { id: string }).id));
    return { ok: true };
  });
  app.get("/api/watches/:id/matches", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!getWatch(id)) return reply.code(404).send({ error: "Not found" });
    return watchMatches(id);
  });
  app.post("/api/watches/:id/run", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!getWatch(id)) return reply.code(404).send({ error: "Not found" });
    try {
      return await runWatch(id);
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- notifications ----
  app.get("/api/notifications", async () => ({ items: listNotifications(), unread: unreadCount() }));
  app.post("/api/notifications/read", async (req) => {
    const body = z.object({ ids: z.union([z.literal("all"), z.array(num)]) }).parse(req.body);
    markRead(body.ids);
    return { unread: unreadCount() };
  });

  // ---- server-sent events ----
  app.get("/api/events", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const send = (name: string) => (payload: unknown) => {
      reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
    };
    const handlers: Array<[string, (p: unknown) => void]> = ["job", "listings", "relevance", "notification", "watch"].map((n) => [n, send(n)]);
    for (const [n, h] of handlers) events.on(n, h);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      for (const [n, h] of handlers) events.off(n, h);
    });
  });
}
