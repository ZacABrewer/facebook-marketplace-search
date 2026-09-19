/**
 * Facebook Marketplace source.
 *
 * Facebook has no public Marketplace API, so this drives a real Chromium via
 * Playwright, loads the Marketplace search page and captures the listing
 * objects Facebook embeds in the page and in its GraphQL responses. That is
 * far more stable than scraping class names, which change constantly.
 *
 * Reliability tips (see README):
 *  - Provide FB_COOKIES pointing at a cookies export from a logged-in browser;
 *    anonymous sessions are often shown a login wall or a reduced result set.
 *  - Provide a Facebook location slug or id (e.g. "boston", "108100685885621")
 *    in the search's "Facebook location" field so Marketplace searches around
 *    that place with the radius you chose.
 */
import fs from "node:fs";
import { chromium, type Browser, type BrowserContext, type Cookie } from "playwright";
import { config } from "../config.js";
import { geocode } from "../geo.js";
import type { RawListing, SearchParams, SourceAdapter } from "../types.js";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: config.headless,
    executablePath: config.chromiumPath || undefined,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close().catch(() => undefined);
    browser = null;
  }
}

function loadCookies(): Cookie[] {
  if (!config.facebookCookies || !fs.existsSync(config.facebookCookies)) return [];
  const raw = fs.readFileSync(config.facebookCookies, "utf8");
  if (raw.trim().startsWith("[")) {
    const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
    return arr.map((c) => ({
      name: String(c.name),
      value: String(c.value),
      domain: String(c.domain ?? ".facebook.com"),
      path: String(c.path ?? "/"),
      expires: typeof c.expirationDate === "number" ? c.expirationDate : typeof c.expires === "number" ? c.expires : -1,
      httpOnly: Boolean(c.httpOnly),
      secure: c.secure == null ? true : Boolean(c.secure),
      sameSite: "Lax",
    }));
  }
  // Netscape cookies.txt
  return raw
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("\t"))
    .filter((p) => p.length >= 7)
    .map((p) => ({
      name: p[5],
      value: p[6].trim(),
      domain: p[0],
      path: p[2],
      expires: Number(p[4]) || -1,
      httpOnly: false,
      secure: p[3] === "TRUE",
      sameSite: "Lax" as const,
    }));
}

export function buildSearchUrl(params: SearchParams): string {
  const base = params.locationSlug
    ? `https://www.facebook.com/marketplace/${encodeURIComponent(params.locationSlug)}/search`
    : "https://www.facebook.com/marketplace/search";
  const url = new URL(base);
  url.searchParams.set("query", params.query);
  url.searchParams.set("exact", "false");
  if (params.minPrice != null) url.searchParams.set("minPrice", String(Math.max(0, Math.floor(params.minPrice))));
  if (params.maxPrice != null) url.searchParams.set("maxPrice", String(Math.floor(params.maxPrice)));
  if (params.daysSinceListed) url.searchParams.set("daysSinceListed", String(params.daysSinceListed));
  // Facebook accepts radius in km on the location-scoped search page.
  url.searchParams.set("radius", String(Math.max(1, Math.round(params.radiusKm))));
  return url.toString();
}

type Json = Record<string, unknown>;

/** Recursively collect objects that look like Marketplace listing nodes. */
export function extractListingNodes(value: unknown, out: Json[] = [], depth = 0): Json[] {
  if (depth > 60 || value == null) return out;
  if (Array.isArray(value)) {
    for (const v of value) extractListingNodes(v, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    const obj = value as Json;
    if (typeof obj.id === "string" && typeof obj.marketplace_listing_title === "string") {
      out.push(obj);
      return out; // do not descend into a listing's own children
    }
    for (const v of Object.values(obj)) extractListingNodes(v, out, depth + 1);
  }
  return out;
}

function get(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Json)[p];
  }
  return cur;
}

export function nodeToRaw(node: Json): RawListing | null {
  const id = String(node.id);
  const title = String(node.marketplace_listing_title ?? "").trim();
  if (!id || !title) return null;
  const amountStr = get(node, ["listing_price", "amount"]) ?? get(node, ["listing_price", "formatted_amount"]);
  let price: number | null = null;
  if (typeof amountStr === "string" || typeof amountStr === "number") {
    const n = Number(String(amountStr).replace(/[^0-9.]/g, ""));
    price = Number.isFinite(n) ? n : null;
  }
  const currency = String(get(node, ["listing_price", "currency"]) ?? "USD");
  const photo = get(node, ["primary_listing_photo", "image", "uri"]);
  const extra = get(node, ["listing_photos"]);
  const imageUrls: string[] = [];
  if (typeof photo === "string") imageUrls.push(photo);
  if (Array.isArray(extra)) {
    for (const p of extra) {
      const u = get(p, ["image", "uri"]);
      if (typeof u === "string" && !imageUrls.includes(u)) imageUrls.push(u);
    }
  }
  const city = get(node, ["location", "reverse_geocode", "city"]);
  const state = get(node, ["location", "reverse_geocode", "state"]);
  const cityPage = get(node, ["location", "reverse_geocode", "city_page", "display_name"]);
  const locationName =
    typeof cityPage === "string" ? cityPage : [city, state].filter((s) => typeof s === "string").join(", ") || null;
  const lat = get(node, ["location", "latitude"]);
  const lng = get(node, ["location", "longitude"]);
  const seller = get(node, ["marketplace_listing_seller", "name"]);
  const desc = get(node, ["redacted_description", "text"]) ?? get(node, ["description", "text"]);
  const created = get(node, ["creation_time"]);
  const condition = get(node, ["condition"]) ?? get(node, ["attribute_data", "condition"]);
  return {
    id: `fb-${id}`,
    source: "facebook",
    title,
    description: typeof desc === "string" ? desc : null,
    price,
    currency,
    locationName,
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
    approxLocation: typeof lat !== "number",
    imageUrls,
    url: `https://www.facebook.com/marketplace/item/${id}/`,
    seller: typeof seller === "string" ? seller : null,
    condition: typeof condition === "string" ? condition.replace(/_/g, " ").toLowerCase() : null,
    postedAt: typeof created === "number" ? created * 1000 : null,
  };
}

/** Pull JSON blobs out of the initial HTML (Facebook embeds relay data in script tags). */
export function extractFromHtml(html: string): Json[] {
  const out: Json[] = [];
  const re = /<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      extractListingNodes(JSON.parse(m[1]), out);
    } catch {
      /* not JSON */
    }
  }
  return out;
}

export const facebookSource: SourceAdapter = {
  name: "facebook",
  async fetch(params, onProgress): Promise<RawListing[]> {
    const b = await getBrowser();
    let context: BrowserContext | null = null;
    try {
      context = await b.newContext({
        userAgent: config.userAgent,
        locale: "en-US",
        viewport: { width: 1280, height: 900 },
        geolocation: { latitude: params.lat, longitude: params.lng },
        permissions: ["geolocation"],
      });
      const cookies = loadCookies();
      if (cookies.length) await context.addCookies(cookies);
      const page = await context.newPage();
      const nodes = new Map<string, Json>();

      page.on("response", async (res) => {
        if (!res.url().includes("/api/graphql")) return;
        try {
          const text = await res.text();
          // GraphQL responses may be several JSON documents separated by newlines.
          for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            try {
              for (const n of extractListingNodes(JSON.parse(line))) nodes.set(String(n.id), n);
            } catch {
              /* skip */
            }
          }
        } catch {
          /* response body unavailable */
        }
      });

      const url = buildSearchUrl(params);
      onProgress?.(`Loading ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForTimeout(2500);
      // Dismiss the login dialog if it appears (anonymous sessions).
      const closeBtn = page.locator('div[role="dialog"] [aria-label="Close"]').first();
      if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => undefined);

      for (const n of extractFromHtml(await page.content())) nodes.set(String(n.id), n);

      // Scroll to trigger a few pages of results.
      for (let i = 0; i < 6; i++) {
        onProgress?.(`Scrolling for more results (${nodes.size} so far)`);
        await page.mouse.wheel(0, 2400);
        await page.waitForTimeout(1200);
      }
      onProgress?.(`Captured ${nodes.size} listings`);

      const raws: RawListing[] = [];
      for (const n of nodes.values()) {
        const r = nodeToRaw(n);
        if (r) raws.push(r);
      }
      // Listings usually only carry a city name; geocode it so the map works.
      const seen = new Map<string, { lat: number; lng: number } | null>();
      for (const r of raws) {
        if (r.lat != null || !r.locationName) continue;
        if (!seen.has(r.locationName)) {
          try {
            const g = await geocode(r.locationName);
            seen.set(r.locationName, g ? { lat: g.lat, lng: g.lng } : null);
            await new Promise((res) => setTimeout(res, 1100)); // Nominatim rate limit
          } catch {
            seen.set(r.locationName, null);
          }
        }
        const g = seen.get(r.locationName);
        if (g) {
          r.lat = g.lat;
          r.lng = g.lng;
          r.approxLocation = true;
        }
      }
      return raws;
    } finally {
      await context?.close().catch(() => undefined);
    }
  },
};
