import type { Filters, Job, Listing, Notification, PriceGroup, SearchContext, Settings, Watch } from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export function listingParams(ctx: SearchContext, extra: Record<string, string | number | boolean | null | undefined> = {}): URLSearchParams {
  const f: Filters = ctx.filters;
  const p = new URLSearchParams();
  p.set("query", ctx.query);
  p.set("lat", String(ctx.lat ?? 0));
  p.set("lng", String(ctx.lng ?? 0));
  p.set("radiusKm", String(ctx.radiusKm));
  if (f.minPrice) p.set("minPrice", f.minPrice);
  if (f.maxPrice) p.set("maxPrice", f.maxPrice);
  p.set("includeFree", String(f.includeFree));
  p.set("minRelevance", String(f.minRelevance));
  if (f.verifiedOnly) p.set("verifiedOnly", "true");
  if (f.conditions.length) p.set("conditions", f.conditions.join(","));
  if (f.exclude.trim()) p.set("exclude", f.exclude.split(",").map((s) => s.trim()).filter(Boolean).join(","));
  if (f.postedWithinDays) p.set("postedWithinDays", f.postedWithinDays);
  if (f.hasPhoto) p.set("hasPhoto", "true");
  if (f.favoritesOnly) p.set("favoritesOnly", "true");
  if (f.showHidden) p.set("showHidden", "true");
  p.set("sort", f.sort);
  for (const [k, v] of Object.entries(extra)) if (v != null && v !== "") p.set(k, String(v));
  return p;
}

export const api = {
  settings: () => req<Settings>("/api/settings"),
  saveSettings: (body: Partial<Pick<Settings, "home" | "notify">>) => req<{ ok: true }>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  geocode: (q: string) => req<{ lat: number; lng: number; displayName: string }>(`/api/geocode?q=${encodeURIComponent(q)}`),
  search: (ctx: SearchContext) =>
    req<{ query: string; job: Job | null }>("/api/search", {
      method: "POST",
      body: JSON.stringify({
        query: ctx.query,
        lat: ctx.lat,
        lng: ctx.lng,
        radiusKm: ctx.radiusKm,
        minPrice: ctx.filters.minPrice || null,
        maxPrice: ctx.filters.maxPrice || null,
        locationSlug: ctx.locationSlug || null,
      }),
    }),
  searchStatus: (query: string) => req<{ job: Job | null; verify: { queued: number; running: number; enabled: boolean } }>(`/api/search/status?query=${encodeURIComponent(query)}`),
  searches: () => req<Array<{ query: string; lastRunAt: number | null; lastStatus: string | null; lastCount: number | null }>>("/api/searches"),
  deleteSearch: (q: string) => req<{ ok: true }>(`/api/searches/${encodeURIComponent(q)}`, { method: "DELETE" }),
  listings: (ctx: SearchContext, extra?: Record<string, string | number | boolean | null | undefined>) =>
    req<{ items: Listing[]; total: number }>(`/api/listings?${listingParams(ctx, extra)}`),
  groups: (ctx: SearchContext) => req<{ groups: PriceGroup[]; unknown: number }>(`/api/listings/groups?${listingParams(ctx)}`),
  listing: (id: string) => req<{ listing: Listing; history: Array<{ price: number | null; seenAt: number }> }>(`/api/listings/${id}`),
  patchListing: (id: string, body: { favorite?: boolean; hidden?: boolean; note?: string | null }) =>
    req<Listing>(`/api/listings/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  verifyListing: (id: string, query: string) => req<{ queued: true }>(`/api/listings/${id}/verify`, { method: "POST", body: JSON.stringify({ query }) }),
  watches: () => req<Watch[]>("/api/watches"),
  createWatch: (w: Partial<Watch>) => req<Watch>("/api/watches", { method: "POST", body: JSON.stringify(w) }),
  updateWatch: (id: number, w: Partial<Watch>) => req<Watch>(`/api/watches/${id}`, { method: "PUT", body: JSON.stringify(w) }),
  deleteWatch: (id: number) => req<{ ok: true }>(`/api/watches/${id}`, { method: "DELETE" }),
  watchMatches: (id: number) => req<Listing[]>(`/api/watches/${id}/matches`),
  runWatch: (id: number) => req<{ matches: number; notified: number }>(`/api/watches/${id}/run`, { method: "POST" }),
  notifications: () => req<{ items: Notification[]; unread: number }>("/api/notifications"),
  markRead: (ids: number[] | "all") => req<{ unread: number }>("/api/notifications/read", { method: "POST", body: JSON.stringify({ ids }) }),
};
