/**
 * In-browser replacement for the server API, used for the static demo on
 * GitHub Pages. It reuses the server's demo generator, keyword scorer and
 * filtering code, keeps state in localStorage, and runs tracked items on a
 * timer while the tab is open. Scraping and the Claude photo cross-check need
 * the real server and are reported as unavailable.
 */
import { demoSource } from "../../../server/src/sources/demo.js";
import { keywordScore } from "../../../server/src/relevance/keyword.js";
import { filterAndSort, type ListingQuery, type ListingView } from "../../../server/src/filtering.js";
import { PRICE_GROUPS, priceGroupFor, type Listing, type Relevance, type Watch, type Notification } from "../../../server/src/types.js";

export const isStaticDemo = import.meta.env.VITE_STATIC_DEMO === "true";

type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();
export const demoEvents = {
  on(name: string, h: Handler) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name)!.add(h);
  },
  off(name: string, h: Handler) {
    listeners.get(name)?.delete(h);
  },
  emit(name: string, payload: unknown) {
    for (const h of listeners.get(name) ?? []) h(payload);
  },
};

interface Store {
  listings: Record<string, Listing>;
  history: Record<string, Array<{ price: number | null; seenAt: number }>>;
  relevance: Record<string, Relevance>; // `${query}::${id}`
  results: Record<string, string[]>; // query -> listing ids
  searches: Record<string, { lastRunAt: number; lastStatus: string; lastCount: number }>;
  watches: Watch[];
  matches: Record<string, number | null>; // `${watchId}::${id}` -> last price
  notifications: Notification[];
  settings: Record<string, unknown>;
  nextId: number;
}

const KEY = "fbms.demo.store";
function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* ignore */
  }
  return { listings: {}, history: {}, relevance: {}, results: {}, searches: {}, watches: [], matches: {}, notifications: [], settings: {}, nextId: 1 };
}
const store = load();
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore quota errors */
  }
}

const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// ---------- search / ingest ----------

const running = new Set<string>();

async function runSearch(p: { query: string; lat: number; lng: number; radiusKm: number }): Promise<void> {
  const q = norm(p.query);
  if (running.has(q)) return;
  running.add(q);
  const job = { id: `${q}:${Date.now()}`, query: q, status: "running", message: "Generating demo listings", startedAt: Date.now(), finishedAt: null as number | null, count: 0, error: null };
  demoEvents.emit("job", { ...job });
  try {
    const raws = await demoSource.fetch({ query: q, lat: p.lat, lng: p.lng, radiusKm: p.radiusKm });
    const now = Date.now();
    const ids: string[] = [];
    const newIds: string[] = [];
    for (const r of raws) {
      const existing = store.listings[r.id];
      const price = r.price ?? null;
      if (!existing) {
        store.listings[r.id] = {
          id: r.id, source: r.source, title: r.title, description: r.description ?? null, price, currency: r.currency ?? "USD", isFree: price === 0,
          locationName: r.locationName ?? null, lat: r.lat ?? null, lng: r.lng ?? null, approxLocation: Boolean(r.approxLocation), imageUrls: r.imageUrls ?? [],
          url: r.url, seller: r.seller ?? null, condition: r.condition ?? null, postedAt: r.postedAt ?? null, firstSeenAt: now, lastSeenAt: now,
          active: true, favorite: false, hidden: false, note: null,
        };
        store.history[r.id] = [{ price, seenAt: now }];
        newIds.push(r.id);
      } else {
        if (existing.price !== price) store.history[r.id].push({ price, seenAt: now });
        Object.assign(existing, { title: r.title, price, isFree: price === 0, lastSeenAt: now, active: true });
      }
      ids.push(r.id);
      const key = `${q}::${r.id}`;
      const kw = keywordScore(q, r.title, r.description).score;
      const rel = store.relevance[key];
      store.relevance[key] = rel ? { ...rel, keywordScore: kw, finalScore: rel.llmVerdict ? rel.finalScore : kw } : { listingId: r.id, query: q, keywordScore: kw, llmVerdict: null, llmConfidence: null, llmReason: null, finalScore: kw, checkedAt: null };
    }
    store.results[q] = ids;
    store.searches[q] = { lastRunAt: now, lastStatus: "ok", lastCount: ids.length };
    persist();
    Object.assign(job, { status: "done", count: ids.length, message: `Found ${ids.length} listings`, finishedAt: Date.now() });
    demoEvents.emit("job", { ...job });
    demoEvents.emit("listings", { query: q, count: ids.length, newIds });
  } finally {
    running.delete(q);
  }
}

function views(q: string, lat: number, lng: number): ListingView[] {
  const dayAgo = Date.now() - 86_400_000;
  return (store.results[q] ?? []).map((id) => store.listings[id]).filter(Boolean).map((l) => {
    const h = store.history[l.id] ?? [];
    const prev = h.length >= 2 ? h[h.length - 2].price : null;
    return {
      ...l,
      distanceKm: l.lat != null && l.lng != null ? Number(haversineKm(lat, lng, l.lat, l.lng).toFixed(1)) : null,
      relevance: store.relevance[`${q}::${l.id}`] ?? null,
      priceGroup: priceGroupFor(l),
      isNew: l.firstSeenAt >= dayAgo,
      priceDropped: prev != null && l.price != null && l.price < prev,
      previousPrice: prev,
      watchIds: store.watches.filter((w) => store.matches[`${w.id}::${l.id}`] !== undefined).map((w) => w.id),
    };
  });
}

function parseQuery(sp: URLSearchParams): ListingQuery {
  const num = (k: string) => (sp.get(k) == null || sp.get(k) === "" ? null : Number(sp.get(k)));
  const bool = (k: string) => sp.get(k) === "true";
  const list = (k: string) => (sp.get(k) ? sp.get(k)!.split(",") : []);
  return {
    query: norm(sp.get("query") ?? ""), lat: Number(sp.get("lat") ?? 0), lng: Number(sp.get("lng") ?? 0), radiusKm: num("radiusKm") ?? 40,
    minPrice: num("minPrice"), maxPrice: num("maxPrice"), includeFree: bool("includeFree"), onlyFree: bool("onlyFree"), priceGroup: sp.get("priceGroup"),
    minRelevance: num("minRelevance"), verifiedOnly: bool("verifiedOnly"), conditions: list("conditions"), exclude: list("exclude"),
    postedWithinDays: num("postedWithinDays"), hasPhoto: bool("hasPhoto"), showHidden: bool("showHidden"), favoritesOnly: bool("favoritesOnly"),
    sort: (sp.get("sort") as ListingQuery["sort"]) ?? "relevance", limit: num("limit") ?? 200, offset: num("offset") ?? 0,
  };
}

// ---------- watches ----------

function notify(n: Omit<Notification, "id" | "createdAt" | "readAt">): void {
  const full: Notification = { ...n, id: store.nextId++, createdAt: Date.now(), readAt: null };
  store.notifications.unshift(full);
  demoEvents.emit("notification", full);
}

async function runWatch(id: number): Promise<{ matches: number; notified: number }> {
  const w = store.watches.find((x) => x.id === id);
  if (!w) throw new Error("Watch not found");
  await runSearch({ query: w.query, lat: w.lat, lng: w.lng, radiusKm: w.radiusKm });
  const { items } = filterAndSort(views(w.query, w.lat, w.lng), { query: w.query, lat: w.lat, lng: w.lng, radiusKm: w.radiusKm, limit: 1000 });
  let matches = 0;
  let notified = 0;
  for (const it of items) {
    const text = `${it.title} ${it.description ?? ""}`.toLowerCase();
    const price = it.isFree ? 0 : it.price;
    if (w.mustInclude.some((k) => k && !text.includes(k.toLowerCase()))) continue;
    if (w.mustExclude.some((k) => k && text.includes(k.toLowerCase()))) continue;
    if (w.maxPrice != null && (price == null || price > w.maxPrice)) continue;
    if (w.minPrice != null && (price ?? 0) < w.minPrice) continue;
    if ((it.relevance?.finalScore ?? 0) < w.minRelevance) continue;
    if (w.requireVerified && it.relevance?.llmVerdict !== "match") continue;
    matches++;
    const key = `${w.id}::${it.id}`;
    if (!(key in store.matches)) {
      store.matches[key] = price;
      const free = it.priceGroup === "free";
      if ((free && w.notifyFree) || (!free && w.notifyNew)) {
        notify({ watchId: w.id, listingId: it.id, kind: free ? "free" : "new_match", title: free ? `Free: ${it.title}` : `New match for "${w.name}"`, body: `${it.title} · ${free ? "Free" : price == null ? "price unknown" : `$${price}`}${it.distanceKm != null ? ` · ${it.distanceKm} km away` : ""}` });
        notified++;
      }
    } else {
      const prev = store.matches[key];
      if (prev != null && price != null && price < prev) {
        store.matches[key] = price;
        if (w.notifyPriceDrop) {
          notify({ watchId: w.id, listingId: it.id, kind: "price_drop", title: `Price drop: ${it.title}`, body: `$${prev} → $${price}` });
          notified++;
        }
      } else if (price !== prev) store.matches[key] = price;
    }
  }
  w.lastRunAt = Date.now();
  persist();
  demoEvents.emit("watch", { id, matches, notified });
  return { matches, notified };
}

if (isStaticDemo) {
  setInterval(() => {
    const now = Date.now();
    for (const w of store.watches) {
      if (w.enabled && (w.lastRunAt == null || now - w.lastRunAt >= w.intervalMinutes * 60_000)) void runWatch(w.id).catch(() => undefined);
    }
  }, 60_000);
}

// ---------- geocoding (browser-side, CORS-enabled free services) ----------

async function geocode(q: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=1`);
    if (r.ok) {
      const d = (await r.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (d.length) return { lat: Number(d[0].lat), lng: Number(d[0].lon), displayName: d[0].display_name };
      return null;
    }
  } catch {
    /* fall through */
  }
  const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`);
  if (!r.ok) throw new Error(`Geocoding failed (HTTP ${r.status})`);
  const d = (await r.json()) as { features: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> };
  const f = d.features?.[0];
  if (!f) return null;
  const p = f.properties;
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], displayName: [p.name, p.city, p.state, p.country].filter(Boolean).join(", ") || q };
}

// ---------- router ----------

export async function demoFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input, location.origin);
  const path = url.pathname.replace(/^.*\/api\//, "/api/");
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  const sp = url.searchParams;

  if (path === "/api/health") return json({ ok: true, source: "demo", verify: { queued: 0, running: 0, enabled: false } });
  if (path === "/api/settings" && method === "GET")
    return json({ home: store.settings.home ?? null, notify: store.settings.notify ?? { webhookUrl: "", ntfyTopic: "", ntfyServer: "https://ntfy.sh" }, source: "demo", verifyMode: "off", claudeConfigured: false, claudeModel: "", facebookCookiesConfigured: false, priceGroups: PRICE_GROUPS, staticDemo: true });
  if (path === "/api/settings" && method === "PUT") {
    if (body.home) store.settings.home = body.home;
    if (body.notify) store.settings.notify = body.notify;
    persist();
    return json({ ok: true });
  }
  if (path === "/api/geocode") {
    try {
      const g = await geocode(sp.get("q") ?? "");
      return g ? json(g) : json({ error: "No results" }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, 502);
    }
  }
  if (path === "/api/search" && method === "POST") {
    const q = norm(String(body.query));
    void runSearch({ query: q, lat: Number(body.lat), lng: Number(body.lng), radiusKm: Number(body.radiusKm ?? 40) });
    return json({ query: q, job: { id: q, query: q, status: "running", message: "Starting", startedAt: Date.now(), finishedAt: null, count: 0, error: null } });
  }
  if (path === "/api/search/status") return json({ job: null, verify: { queued: 0, running: 0, enabled: false } });
  if (path === "/api/searches" && method === "GET") return json(Object.entries(store.searches).map(([query, s]) => ({ query, ...s })).sort((a, b) => b.lastRunAt - a.lastRunAt));
  if (path.startsWith("/api/searches/") && method === "DELETE") {
    const q = norm(decodeURIComponent(path.slice("/api/searches/".length)));
    delete store.results[q];
    delete store.searches[q];
    persist();
    return json({ ok: true });
  }
  if (path === "/api/listings" && method === "GET") {
    const o = parseQuery(sp);
    return json(filterAndSort(views(o.query, o.lat, o.lng), o));
  }
  if (path === "/api/listings/groups") {
    const o = parseQuery(sp);
    const { items } = filterAndSort(views(o.query, o.lat, o.lng), { ...o, priceGroup: null, onlyFree: false, minPrice: null, maxPrice: null, limit: 10_000 });
    const counts: Record<string, number> = {};
    for (const it of items) counts[it.priceGroup] = (counts[it.priceGroup] ?? 0) + 1;
    return json({ groups: PRICE_GROUPS.map((g) => ({ ...g, count: counts[g.key] ?? 0 })), unknown: counts.unknown ?? 0 });
  }
  const listingMatch = path.match(/^\/api\/listings\/([^/]+)(\/verify)?$/);
  if (listingMatch) {
    const l = store.listings[listingMatch[1]];
    if (!l) return json({ error: "Not found" }, 404);
    if (listingMatch[2]) return json({ error: "Photo cross-check needs the real server with ANTHROPIC_API_KEY. This static demo runs entirely in your browser." }, 400);
    if (method === "PATCH") {
      if (body.favorite != null) l.favorite = Boolean(body.favorite);
      if (body.hidden != null) l.hidden = Boolean(body.hidden);
      if (body.note !== undefined) l.note = body.note as string | null;
      persist();
      return json(l);
    }
    return json({ listing: l, history: store.history[l.id] ?? [], relevance: [] });
  }
  if (path === "/api/watches" && method === "GET") return json(store.watches.map((w) => ({ ...w, matchCount: Object.keys(store.matches).filter((k) => k.startsWith(`${w.id}::`)).length })));
  if (path === "/api/watches" && method === "POST") {
    const w = { ...(body as unknown as Watch), id: store.nextId++, createdAt: Date.now(), lastRunAt: null, query: norm(String(body.query)), name: String(body.name || body.query) };
    store.watches.unshift(w);
    persist();
    return json(w);
  }
  const watchMatch = path.match(/^\/api\/watches\/(\d+)(\/matches|\/run)?$/);
  if (watchMatch) {
    const id = Number(watchMatch[1]);
    const w = store.watches.find((x) => x.id === id);
    if (!w) return json({ error: "Not found" }, 404);
    if (watchMatch[2] === "/run") return json(await runWatch(id));
    if (watchMatch[2] === "/matches") return json(views(w.query, w.lat, w.lng).filter((v) => `${id}::${v.id}` in store.matches));
    if (method === "PUT") {
      Object.assign(w, body, { id, query: norm(String(body.query ?? w.query)) });
      persist();
      return json(w);
    }
    if (method === "DELETE") {
      store.watches = store.watches.filter((x) => x.id !== id);
      for (const k of Object.keys(store.matches)) if (k.startsWith(`${id}::`)) delete store.matches[k];
      persist();
      return json({ ok: true });
    }
  }
  if (path === "/api/notifications" && method === "GET") return json({ items: store.notifications.slice(0, 100), unread: store.notifications.filter((n) => !n.readAt).length });
  if (path === "/api/notifications/read") {
    const ids = body.ids as number[] | "all";
    for (const n of store.notifications) if (!n.readAt && (ids === "all" || ids.includes(n.id))) n.readAt = Date.now();
    persist();
    return json({ unread: store.notifications.filter((n) => !n.readAt).length });
  }
  return json({ error: `Not found: ${method} ${path}` }, 404);
}
