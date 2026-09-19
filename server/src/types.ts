export type Source = "demo" | "facebook";

export interface Listing {
  id: string;
  source: Source;
  title: string;
  description: string | null;
  price: number | null; // dollars; null when unknown
  currency: string;
  isFree: boolean;
  locationName: string | null;
  lat: number | null;
  lng: number | null;
  approxLocation: boolean; // true when only a city centroid is known
  imageUrls: string[];
  url: string;
  seller: string | null;
  condition: string | null;
  postedAt: number | null; // epoch ms
  firstSeenAt: number;
  lastSeenAt: number;
  active: boolean;
  favorite: boolean;
  hidden: boolean;
  note: string | null;
}

export interface RawListing {
  id: string;
  source: Source;
  title: string;
  description?: string | null;
  price?: number | null;
  currency?: string;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
  approxLocation?: boolean;
  imageUrls?: string[];
  url: string;
  seller?: string | null;
  condition?: string | null;
  postedAt?: number | null;
}

export interface SearchParams {
  query: string;
  lat: number;
  lng: number;
  radiusKm: number;
  minPrice?: number | null;
  maxPrice?: number | null;
  locationSlug?: string | null; // facebook city slug / id, e.g. "boston"
  daysSinceListed?: number | null;
  condition?: string[] | null;
}

export interface SourceAdapter {
  readonly name: Source;
  fetch(params: SearchParams, onProgress?: (msg: string) => void): Promise<RawListing[]>;
}

export interface Relevance {
  listingId: string;
  query: string;
  keywordScore: number; // 0..1
  llmVerdict: "match" | "no_match" | "unsure" | null;
  llmConfidence: number | null;
  llmReason: string | null;
  finalScore: number; // 0..1
  checkedAt: number | null; // when LLM ran
}

export interface Watch {
  id: number;
  name: string;
  query: string;
  lat: number;
  lng: number;
  locationName: string | null;
  locationSlug: string | null;
  radiusKm: number;
  minPrice: number | null;
  maxPrice: number | null;
  mustInclude: string[];
  mustExclude: string[];
  minRelevance: number;
  requireVerified: boolean;
  notifyNew: boolean;
  notifyPriceDrop: boolean;
  notifyFree: boolean;
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: number | null;
  createdAt: number;
}

export interface Notification {
  id: number;
  watchId: number | null;
  listingId: string | null;
  kind: "new_match" | "price_drop" | "free" | "info";
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export interface PriceGroup {
  key: string;
  label: string;
  min: number | null; // inclusive
  max: number | null; // exclusive
}

export const PRICE_GROUPS: PriceGroup[] = [
  { key: "free", label: "Free", min: null, max: null },
  { key: "under25", label: "Under $25", min: 0, max: 25 },
  { key: "25to100", label: "$25 – $100", min: 25, max: 100 },
  { key: "100to500", label: "$100 – $500", min: 100, max: 500 },
  { key: "500plus", label: "$500+", min: 500, max: null },
];

export function priceGroupFor(l: { isFree: boolean; price: number | null }): string {
  if (l.isFree || l.price === 0) return "free";
  if (l.price == null) return "unknown";
  if (l.price < 25) return "under25";
  if (l.price < 100) return "25to100";
  if (l.price < 500) return "100to500";
  return "500plus";
}
