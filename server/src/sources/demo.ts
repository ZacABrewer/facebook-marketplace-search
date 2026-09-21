/**
 * Demo source: deterministic synthetic listings around the search centre.
 * It intentionally mixes in accessories, parts and want-ads so the relevance
 * cross-check has something to filter. Use SOURCE=facebook for real data.
 */
import type { RawListing, SearchParams, SourceAdapter } from "../types.js";

const CONDITIONS = ["New", "Like new", "Good", "Fair", "Used"];
const SELLERS = ["Alex P.", "Jordan M.", "Sam R.", "Taylor K.", "Casey L.", "Morgan D.", "Riley S.", "Quinn B."];
const TOWNS = ["Northside", "Riverbend", "Oakwood", "Lakeview", "Hillcrest", "Eastgate", "Westfield", "Southport"];

const TEMPLATES: Array<{ title: (q: string) => string; desc: (q: string) => string; kind: "item" | "accessory" | "want" | "part" | "other"; priceMul: number }> = [
  { kind: "item", priceMul: 1, title: (q) => `${cap(q)} - great condition`, desc: (q) => `Selling my ${q}. Works perfectly, only used a handful of times. Pickup only.` },
  { kind: "item", priceMul: 0.8, title: (q) => `Used ${q}, needs a new home`, desc: (q) => `Moving and can't take my ${q} with me. Some cosmetic wear but fully functional.` },
  { kind: "item", priceMul: 1.4, title: (q) => `${cap(q)} (barely used)`, desc: (q) => `Bought this ${q} last year and used it twice. Comes with original box.` },
  { kind: "item", priceMul: 0, title: (q) => `Free ${q} - curb alert`, desc: (q) => `Free ${q} on the curb, first come first served. Message for the address.` },
  { kind: "item", priceMul: 0.6, title: (q) => `${cap(q)} for sale`, desc: (q) => `${cap(q)}, older model but works. Cash only.` },
  { kind: "item", priceMul: 1.1, title: (q) => `${cap(q)} with extras`, desc: (q) => `Comes with everything you need to get started. Includes accessories.` },
  { kind: "item", priceMul: 2.2, title: (q) => `Premium ${q} - top of the line`, desc: (q) => `High end ${q}, retails for much more. Firm on price.` },
  { kind: "accessory", priceMul: 0.15, title: (q) => `${cap(q)} rack / mount`, desc: (q) => `Heavy duty rack for your ${q}. Rack only, ${q} not included.` },
  { kind: "accessory", priceMul: 0.05, title: (q) => `${cap(q)} cover`, desc: (q) => `Waterproof cover, fits most ${q} models.` },
  { kind: "accessory", priceMul: 0.08, title: (q) => `Case for ${q}`, desc: (q) => `Protective case. Just the case.` },
  { kind: "part", priceMul: 0.1, title: (q) => `${cap(q)} parts`, desc: (q) => `Assorted parts pulled from a ${q}. Selling as a lot.` },
  { kind: "want", priceMul: 0, title: (q) => `ISO ${q}`, desc: (q) => `Looking for a ${q} in decent shape, can pick up this weekend.` },
  { kind: "other", priceMul: 0.3, title: (q) => `${cap(q)} lessons`, desc: (q) => `Private ${q} lessons for beginners.` },
  { kind: "other", priceMul: 0, title: (q) => `Free stuff - garage cleanout`, desc: (q) => `Random items including a ${q} that may or may not work.` },
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function basePrice(q: string): number {
  const h = hash(q) % 1000;
  return 40 + h; // $40 – $1040 depending on the query
}

export const demoSource: SourceAdapter = {
  name: "demo",
  async fetch(params: SearchParams, onProgress): Promise<RawListing[]> {
    onProgress?.("Generating demo listings");
    const q = params.query.trim().toLowerCase();
    const rand = rng(hash(q));
    const base = basePrice(q);
    const out: RawListing[] = [];
    const count = 26;
    for (let i = 0; i < count; i++) {
      const t = TEMPLATES[i % TEMPLATES.length];
      const angle = rand() * Math.PI * 2;
      const dist = Math.sqrt(rand()) * params.radiusKm * 1.15; // some just outside the radius
      const lat = params.lat + (dist / 111) * Math.cos(angle);
      const lng = params.lng + (dist / (111 * Math.cos((params.lat * Math.PI) / 180))) * Math.sin(angle);
      let price: number | null = Math.round(base * t.priceMul * (0.7 + rand() * 0.6));
      if (t.priceMul === 0) price = 0;
      if (rand() < 0.05) price = null;
      const id = `demo-${hash(q + i)}`;
      const daysAgo = Math.floor(rand() * 20);
      out.push({
        id,
        source: "demo",
        title: t.title(q),
        description: t.desc(q),
        price,
        currency: "USD",
        locationName: TOWNS[i % TOWNS.length],
        lat,
        lng,
        approxLocation: false,
        imageUrls: [`https://picsum.photos/seed/${id}/480/360`],
        url: `https://www.facebook.com/marketplace/item/${hash(id)}`,
        seller: SELLERS[i % SELLERS.length],
        condition: CONDITIONS[Math.floor(rand() * CONDITIONS.length)],
        postedAt: Date.now() - daysAgo * 86_400_000 - Math.floor(rand() * 3_600_000),
      });
    }
    // Simulate a price drop on one recurring listing to exercise alerts.
    const drop = out[0];
    if (drop.price != null && drop.price > 0) {
      const minute = Math.floor(Date.now() / 600_000); // changes every 10 minutes
      drop.price = Math.max(1, Math.round(drop.price * (minute % 2 === 0 ? 1 : 0.85)));
    }
    await new Promise((r) => setTimeout(r, 400));
    return out;
  },
};
