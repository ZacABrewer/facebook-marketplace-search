import { useEffect, useMemo, useState } from "react";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api";
import { useApp } from "../App";
import { ListingCard } from "../components/ListingCard";
import { ListingDetail } from "../components/ListingDetail";
import { SearchBar } from "../components/SearchBar";
import { fmtPrice, useAsync, useDebounced } from "../hooks";
import type { Listing } from "../types";

const GROUP_COLORS: Record<string, string> = {
  free: "#1f7a3a",
  under25: "#7a7a7a",
  "25to100": "#4f6d9a",
  "100to500": "#8a5a00",
  "500plus": "#161616",
  unknown: "#bbbbbb",
};
const GROUP_LABELS: Record<string, string> = { free: "Free", under25: "< $25", "25to100": "$25–100", "100to500": "$100–500", "500plus": "$500+", unknown: "Unknown" };

function FitBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
  }, [bounds, map]);
  return null;
}

export function MapPage() {
  const { ctx, dataVersion } = useApp();
  const debounced = useDebounced(ctx, 200);
  const [satellite, setSatellite] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<Listing | null>(null);
  const [local, setLocal] = useState<Listing[] | null>(null);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);

  const enabled = Boolean(debounced.query.trim() && debounced.lat != null);
  const { data } = useAsync(
    () => (enabled ? api.listings(debounced, { limit: 500 }) : Promise.resolve({ items: [] as Listing[], total: 0 })),
    [JSON.stringify(debounced), dataVersion],
  );
  useEffect(() => setLocal(data?.items ?? null), [data]);
  const items = (local ?? []).filter((l) => !groupFilter || l.priceGroup === groupFilter);
  const mapped = items.filter((l) => l.lat != null && l.lng != null);

  const center: [number, number] = [ctx.lat ?? 39.5, ctx.lng ?? -98.35];
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (!mapped.length) return null;
    return mapped.map((l) => [l.lat!, l.lng!] as [number, number]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapped.length, debounced.query]);

  const update = (u: Listing) => setLocal((cur) => (cur ? cur.map((x) => (x.id === u.id ? u : x)) : cur));

  return (
    <div className="page full">
      <div style={{ padding: "12px 20px 0" }}>
        <SearchBar />
      </div>
      <div className="mapwrap" style={{ height: "calc(100vh - 52px - 96px)" }}>
        <div style={{ position: "relative" }}>
          <div className="maptools">
            <button className="btn sm" type="button" onClick={() => setSatellite((s) => !s)}>{satellite ? "Street map" : "Satellite"}</button>
          </div>
          <MapContainer center={center} zoom={ctx.lat != null ? 10 : 4} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
            {satellite ? (
              <TileLayer
                attribution="Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            ) : (
              <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            )}
            {ctx.lat != null && ctx.lng != null && (
              <Circle center={[ctx.lat, ctx.lng]} radius={ctx.radiusKm * 1000} pathOptions={{ color: "#161616", weight: 1, dashArray: "4 4", fillOpacity: 0.02 }} />
            )}
            {mapped.map((l) => {
              const tracked = l.watchIds.length > 0;
              const active = hover === l.id;
              return (
                <CircleMarker
                  key={l.id}
                  center={[l.lat!, l.lng!]}
                  radius={active ? 10 : tracked ? 8 : 6}
                  pathOptions={{ color: tracked ? "#161616" : "#fff", weight: tracked ? 2 : 1.5, fillColor: GROUP_COLORS[l.priceGroup] ?? "#999", fillOpacity: active ? 1 : 0.85 }}
                  eventHandlers={{ mouseover: () => setHover(l.id), mouseout: () => setHover(null) }}
                >
                  <Popup>
                    <strong>{fmtPrice(l)}</strong> · {l.title}
                    <br />
                    <span className="muted small">{l.distanceKm} km{l.approxLocation ? " · approx. location" : ""}</span>
                    <br />
                    <button className="btn sm" style={{ marginTop: 6 }} type="button" onClick={() => setOpen(l)}>Details</button>{" "}
                    <a className="btn sm" href={l.url} target="_blank" rel="noreferrer">Open ↗</a>
                  </Popup>
                </CircleMarker>
              );
            })}
            <FitBounds bounds={bounds} />
          </MapContainer>
        </div>
        <aside className="mapside">
          <div className="legend">
            {Object.entries(GROUP_LABELS).map(([k, label]) => (
              <span key={k} className={`chip clickable ${groupFilter === k ? "dark" : ""}`} onClick={() => setGroupFilter(groupFilter === k ? null : k)}>
                <i style={{ background: GROUP_COLORS[k], display: "inline-block", width: 10, height: 10, borderRadius: "50%" }} /> {label}
              </span>
            ))}
          </div>
          <div className="small muted">
            {items.length} listings · {items.length - mapped.length} without a location
          </div>
          <div className="list">
            {items.map((l) => (
              <ListingCard key={l.id} l={l} layout="row" selected={hover === l.id} onHover={(h) => setHover(h?.id ?? null)} onOpen={setOpen} onChange={update} />
            ))}
            {enabled && items.length === 0 && <div className="empty">No listings yet.</div>}
          </div>
        </aside>
      </div>
      {open && <ListingDetail l={open} onClose={() => setOpen(null)} onChange={(u) => { update(u); setOpen(u); }} />}
    </div>
  );
}
