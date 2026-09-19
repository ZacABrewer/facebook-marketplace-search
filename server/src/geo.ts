import { getDb } from "./db.js";

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

export interface GeoResult {
  lat: number;
  lng: number;
  displayName: string;
}

/**
 * Geocode a free-text place with OpenStreetMap Nominatim (free, no key).
 * Results are cached in SQLite; Nominatim asks for at most 1 req/s and a UA.
 */
export async function geocode(query: string): Promise<GeoResult | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  const db = getDb();
  const cached = db.prepare("SELECT lat, lng, display_name FROM geocache WHERE query = ?").get(key) as
    | { lat: number; lng: number; display_name: string }
    | undefined;
  if (cached) return { lat: cached.lat, lng: cached.lng, displayName: cached.display_name };

  let out: GeoResult | null = null;
  try {
    out = await nominatim(query);
  } catch (err) {
    console.warn("[geo] Nominatim failed, trying Photon:", err instanceof Error ? err.message : err);
    out = await photon(query);
  }
  if (!out) return null;
  db.prepare(
    "INSERT INTO geocache (query, lat, lng, display_name, cached_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(query) DO NOTHING",
  ).run(key, out.lat, out.lng, out.displayName, Date.now());
  return out;
}

async function nominatim(query: string): Promise<GeoResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const res = await fetch(url, { headers: { "User-Agent": "facebook-marketplace-search/0.1 (self-hosted tool)" } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!data.length) return null;
  return { lat: Number(data[0].lat), lng: Number(data[0].lon), displayName: data[0].display_name };
}

/** Photon (komoot) is a second free OSM-based geocoder used when Nominatim is unavailable. */
async function photon(query: string): Promise<GeoResult | null> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (Photon HTTP ${res.status})`);
  const data = (await res.json()) as { features: Array<{ geometry: { coordinates: [number, number] }; properties: Record<string, string> }> };
  const f = data.features?.[0];
  if (!f) return null;
  const p = f.properties;
  const name = [p.name, p.city, p.state, p.country].filter(Boolean).join(", ");
  return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], displayName: name || query };
}
