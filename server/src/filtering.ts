/**
 * Pure filtering and sorting of listing views. No I/O, so it is shared by the
 * server and by the in-browser demo used on GitHub Pages.
 */
import type { Listing, Relevance } from "./types.js";

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

export function filterAndSort(input: ListingView[], opts: ListingQuery, now = Date.now()): { items: ListingView[]; total: number } {
  const excl = (opts.exclude ?? []).map((w) => w.toLowerCase()).filter(Boolean);
  const conds = (opts.conditions ?? []).map((c) => c.toLowerCase());

  const items = input.filter((it) => {
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
    if (opts.postedWithinDays && it.postedAt != null && it.postedAt < now - opts.postedWithinDays * 86_400_000) return false;
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
