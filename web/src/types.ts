export interface Relevance {
  listingId: string;
  query: string;
  keywordScore: number;
  llmVerdict: "match" | "no_match" | "unsure" | null;
  llmConfidence: number | null;
  llmReason: string | null;
  finalScore: number;
  checkedAt: number | null;
}

export interface Listing {
  id: string;
  source: "demo" | "facebook";
  title: string;
  description: string | null;
  price: number | null;
  currency: string;
  isFree: boolean;
  locationName: string | null;
  lat: number | null;
  lng: number | null;
  approxLocation: boolean;
  imageUrls: string[];
  url: string;
  seller: string | null;
  condition: string | null;
  postedAt: number | null;
  firstSeenAt: number;
  lastSeenAt: number;
  active: boolean;
  favorite: boolean;
  hidden: boolean;
  note: string | null;
  distanceKm: number | null;
  relevance: Relevance | null;
  priceGroup: string;
  isNew: boolean;
  priceDropped: boolean;
  previousPrice: number | null;
  watchIds: number[];
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
  matchCount?: number;
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

export interface Job {
  id: string;
  query: string;
  status: "running" | "done" | "error";
  message: string;
  startedAt: number;
  finishedAt: number | null;
  count: number;
  error: string | null;
}

export interface PriceGroup {
  key: string;
  label: string;
  min: number | null;
  max: number | null;
  count?: number;
}

export interface Settings {
  home: { locationName: string; lat: number; lng: number; radiusKm: number; locationSlug: string } | null;
  notify: { webhookUrl: string; ntfyTopic: string; ntfyServer: string };
  source: "demo" | "facebook";
  verifyMode: "ambiguous" | "all" | "off";
  claudeConfigured: boolean;
  claudeModel: string;
  facebookCookiesConfigured: boolean;
  priceGroups: PriceGroup[];
}

export type SortKey = "relevance" | "price_asc" | "price_desc" | "distance" | "newest" | "recently_seen";

export interface Filters {
  minPrice: string;
  maxPrice: string;
  includeFree: boolean;
  minRelevance: number;
  verifiedOnly: boolean;
  conditions: string[];
  exclude: string;
  postedWithinDays: string;
  hasPhoto: boolean;
  favoritesOnly: boolean;
  showHidden: boolean;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  minPrice: "",
  maxPrice: "",
  includeFree: true,
  minRelevance: 0.4,
  verifiedOnly: false,
  conditions: [],
  exclude: "",
  postedWithinDays: "",
  hasPhoto: false,
  favoritesOnly: false,
  showHidden: false,
  sort: "relevance",
};

export interface SearchContext {
  query: string;
  locationName: string;
  locationSlug: string;
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  filters: Filters;
}
