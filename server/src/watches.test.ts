import { test, before } from "node:test";
import assert from "node:assert/strict";
import { openMemoryDb } from "./db.js";
import { ingest } from "./ingest.js";
import { scoreAndStore } from "./relevance/index.js";
import { queryListings } from "./search.js";
import { createWatch, listingMeetsWatch, runWatch, watchMatches } from "./watches.js";
import { listNotifications } from "./notify.js";
import type { RawListing, SearchParams } from "./types.js";

const params: SearchParams = { query: "kayak", lat: 42.36, lng: -71.06, radiusKm: 40 };
const raw = (id: string, title: string, price: number | null, extra: Partial<RawListing> = {}): RawListing => ({
  id, source: "demo", title, price, url: `https://x/${id}`, lat: 42.37, lng: -71.05, imageUrls: [], ...extra,
});

before(() => openMemoryDb());

test("ingest stores listings, links them to the query and records price drops", () => {
  const first = ingest("kayak", params, [raw("a", "Kayak - great condition", 300), raw("b", "Kayak rack", 40), raw("c", "Free kayak", 0)]);
  assert.equal(first.newIds.length, 3);
  const second = ingest("kayak", params, [raw("a", "Kayak - great condition", 250), raw("b", "Kayak rack", 40), raw("c", "Free kayak", 0)]);
  assert.equal(second.newIds.length, 0);
  assert.equal(second.priceDrops.length, 1);
  assert.equal(second.priceDrops[0].to, 250);
  for (const l of second.listings) scoreAndStore("kayak", l);
  const { items } = queryListings({ query: "kayak", lat: 42.36, lng: -71.06, radiusKm: 40 });
  assert.equal(items.length, 3);
  const a = items.find((i) => i.id === "a")!;
  assert.equal(a.priceDropped, true);
  assert.equal(a.previousPrice, 300);
  assert.equal(items.find((i) => i.id === "c")!.priceGroup, "free");
});

test("listingMeetsWatch applies price, keyword and relevance rules", () => {
  const { items } = queryListings({ query: "kayak", lat: 42.36, lng: -71.06, radiusKm: 40 });
  const a = items.find((i) => i.id === "a")!;
  const rack = items.find((i) => i.id === "b")!;
  const base = { minPrice: null, maxPrice: 260, mustInclude: [], mustExclude: ["rack"], minRelevance: 0.5, requireVerified: false };
  assert.equal(listingMeetsWatch(base, a), true);
  assert.equal(listingMeetsWatch(base, rack), false);
  assert.equal(listingMeetsWatch({ ...base, maxPrice: 100 }, a), false);
  assert.equal(listingMeetsWatch({ ...base, mustInclude: ["tandem"] }, a), false);
  assert.equal(listingMeetsWatch({ ...base, requireVerified: true }, a), false);
});

test("runWatch records matches and creates notifications, including free alerts", async () => {
  const w = createWatch({
    name: "Cheap kayak", query: "kayak", lat: 42.36, lng: -71.06, locationName: null, locationSlug: null, radiusKm: 40,
    minPrice: null, maxPrice: 260, mustInclude: [], mustExclude: ["rack"], minRelevance: 0.5, requireVerified: false,
    notifyNew: true, notifyPriceDrop: true, notifyFree: true, enabled: true, intervalMinutes: 15,
  });
  const r = await runWatch(w.id, { fetch: false });
  assert.equal(r.matches, 2);
  assert.equal(r.notified, 2);
  const kinds = listNotifications().map((n) => n.kind).sort();
  assert.deepEqual(kinds, ["free", "new_match"]);
  assert.equal(watchMatches(w.id).length, 2);

  // A later price drop on a matched listing produces a price_drop alert, no duplicate new_match.
  ingest("kayak", params, [raw("a", "Kayak - great condition", 200), raw("b", "Kayak rack", 40), raw("c", "Free kayak", 0)]);
  const r2 = await runWatch(w.id, { fetch: false });
  assert.equal(r2.notified, 1);
  assert.equal(listNotifications()[0].kind, "price_drop");
  const { items } = queryListings({ query: "kayak", lat: 42.36, lng: -71.06, radiusKm: 40 });
  assert.deepEqual(items.find((i) => i.id === "a")!.watchIds, [w.id]);
});
