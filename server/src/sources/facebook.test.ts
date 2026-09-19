import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSearchUrl, extractFromHtml, extractListingNodes, nodeToRaw } from "./facebook.js";

const node = {
  __typename: "MarketplaceListing",
  id: "123",
  marketplace_listing_title: "Old Town kayak",
  listing_price: { amount: "250.00", currency: "USD" },
  primary_listing_photo: { image: { uri: "https://cdn/x.jpg" } },
  location: { reverse_geocode: { city: "Boston", state: "MA" } },
  marketplace_listing_seller: { name: "Sam" },
  creation_time: 1_700_000_000,
};

test("extractListingNodes finds nested listing objects", () => {
  const blob = { data: { marketplace_search: { feed_units: { edges: [{ node: { listing: node } }, { node: { other: 1 } }] } } } };
  const found = extractListingNodes(blob);
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "123");
});

test("nodeToRaw maps fields", () => {
  const r = nodeToRaw(node)!;
  assert.equal(r.id, "fb-123");
  assert.equal(r.price, 250);
  assert.equal(r.locationName, "Boston, MA");
  assert.equal(r.approxLocation, true);
  assert.deepEqual(r.imageUrls, ["https://cdn/x.jpg"]);
  assert.equal(r.postedAt, 1_700_000_000_000);
});

test("extractFromHtml parses embedded JSON script tags", () => {
  const html = `<html><script type="application/json" data-x="1">${JSON.stringify({ a: [node] })}</script><script type="application/json">not json</script></html>`;
  assert.equal(extractFromHtml(html).length, 1);
});

test("buildSearchUrl uses location slug and filters", () => {
  const u = buildSearchUrl({ query: "kayak", lat: 0, lng: 0, radiusKm: 40, locationSlug: "boston", maxPrice: 300 });
  assert.ok(u.startsWith("https://www.facebook.com/marketplace/boston/search?"));
  assert.ok(u.includes("query=kayak") && u.includes("maxPrice=300") && u.includes("radius=40"));
});
