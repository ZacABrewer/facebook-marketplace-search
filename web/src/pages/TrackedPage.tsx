import { useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import { ListingCard } from "../components/ListingCard";
import { ListingDetail } from "../components/ListingDetail";
import { timeAgo, useAsync } from "../hooks";
import type { Listing, Watch } from "../types";

type Draft = {
  name: string;
  query: string;
  locationName: string;
  locationSlug: string;
  lat: number | null;
  lng: number | null;
  radiusKm: number;
  minPrice: string;
  maxPrice: string;
  mustInclude: string;
  mustExclude: string;
  minRelevance: number;
  requireVerified: boolean;
  notifyNew: boolean;
  notifyPriceDrop: boolean;
  notifyFree: boolean;
  enabled: boolean;
  intervalMinutes: number;
};

function toDraft(w: Watch | null, ctx: { query: string; locationName: string; locationSlug: string; lat: number | null; lng: number | null; radiusKm: number }): Draft {
  if (!w)
    return {
      name: "", query: ctx.query, locationName: ctx.locationName, locationSlug: ctx.locationSlug, lat: ctx.lat, lng: ctx.lng, radiusKm: ctx.radiusKm,
      minPrice: "", maxPrice: "", mustInclude: "", mustExclude: "", minRelevance: 0.5, requireVerified: false,
      notifyNew: true, notifyPriceDrop: true, notifyFree: true, enabled: true, intervalMinutes: 15,
    };
  return {
    name: w.name, query: w.query, locationName: w.locationName ?? "", locationSlug: w.locationSlug ?? "", lat: w.lat, lng: w.lng, radiusKm: w.radiusKm,
    minPrice: w.minPrice == null ? "" : String(w.minPrice), maxPrice: w.maxPrice == null ? "" : String(w.maxPrice),
    mustInclude: w.mustInclude.join(", "), mustExclude: w.mustExclude.join(", "), minRelevance: w.minRelevance, requireVerified: w.requireVerified,
    notifyNew: w.notifyNew, notifyPriceDrop: w.notifyPriceDrop, notifyFree: w.notifyFree, enabled: w.enabled, intervalMinutes: w.intervalMinutes,
  };
}

function splitList(s: string): string[] {
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function TrackedPage() {
  const { ctx, settings, toast, dataVersion } = useApp();
  const watches = useAsync(() => api.watches(), [dataVersion]);
  const [editing, setEditing] = useState<Watch | null | "new">(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState<Listing | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const matches = useAsync(() => (selected == null ? Promise.resolve([] as Listing[]) : api.watchMatches(selected)), [selected, dataVersion]);

  function startEdit(w: Watch | "new") {
    setEditing(w);
    setDraft(toDraft(w === "new" ? null : w, ctx));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    let { lat, lng } = draft;
    if (draft.locationName && (lat == null || lng == null || (editing !== "new" && editing && editing.locationName !== draft.locationName))) {
      try {
        const g = await api.geocode(draft.locationName);
        lat = g.lat;
        lng = g.lng;
      } catch (err) {
        toast(`Could not find location: ${(err as Error).message}`);
        return;
      }
    }
    if (lat == null || lng == null) {
      toast("A location is required.");
      return;
    }
    const body: Partial<Watch> = {
      name: draft.name || draft.query, query: draft.query, lat, lng, locationName: draft.locationName || null, locationSlug: draft.locationSlug || null,
      radiusKm: draft.radiusKm, minPrice: draft.minPrice ? Number(draft.minPrice) : null, maxPrice: draft.maxPrice ? Number(draft.maxPrice) : null,
      mustInclude: splitList(draft.mustInclude), mustExclude: splitList(draft.mustExclude), minRelevance: draft.minRelevance, requireVerified: draft.requireVerified,
      notifyNew: draft.notifyNew, notifyPriceDrop: draft.notifyPriceDrop, notifyFree: draft.notifyFree, enabled: draft.enabled, intervalMinutes: draft.intervalMinutes,
    };
    try {
      if (editing === "new") await api.createWatch(body);
      else if (editing) await api.updateWatch(editing.id, body);
      setEditing(null);
      setDraft(null);
      watches.reload();
      toast("Saved. It will run on its schedule; use “Run now” to check immediately.");
    } catch (err) {
      toast((err as Error).message);
    }
  }

  async function run(id: number) {
    setBusy(id);
    try {
      const r = await api.runWatch(id);
      toast(`${r.matches} matching listings, ${r.notified} new alerts`);
      watches.reload();
      if (selected === id) matches.reload();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this tracked item?")) return;
    await api.deleteWatch(id);
    if (selected === id) setSelected(null);
    watches.reload();
  }

  const d = draft;
  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 className="grow">Tracked items</h1>
        <button className="btn primary" type="button" onClick={() => startEdit("new")}>+ Track an item</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Each tracked item re-runs its search on a schedule and alerts you when a listing meets your price, keyword and confidence rules.
        Matches are outlined in black everywhere in the app.
      </p>

      {d && (
        <form className="panel soft" onSubmit={save} style={{ marginBottom: 16 }}>
          <h2 style={{ marginBottom: 10 }}>{editing === "new" ? "New tracked item" : "Edit tracked item"}</h2>
          <div className="formgrid">
            <label className="field"><span>Name</span><input className="input" value={d.name} onChange={(e) => setDraft({ ...d, name: e.target.value })} placeholder={d.query || "e.g. Cheap kayak"} /></label>
            <label className="field"><span>Search term</span><input className="input" required value={d.query} onChange={(e) => setDraft({ ...d, query: e.target.value })} /></label>
            <label className="field"><span>Location</span><input className="input" value={d.locationName} onChange={(e) => setDraft({ ...d, locationName: e.target.value })} placeholder="City or ZIP" /></label>
            <label className="field"><span>Radius (km)</span><input className="input" type="number" min={1} value={d.radiusKm} onChange={(e) => setDraft({ ...d, radiusKm: Number(e.target.value) })} /></label>
            <label className="field"><span>Min price</span><input className="input" type="number" min={0} value={d.minPrice} onChange={(e) => setDraft({ ...d, minPrice: e.target.value })} placeholder="any" /></label>
            <label className="field"><span>Max price</span><input className="input" type="number" min={0} value={d.maxPrice} onChange={(e) => setDraft({ ...d, maxPrice: e.target.value })} placeholder="any" /></label>
            <label className="field"><span>Must include words</span><input className="input" value={d.mustInclude} onChange={(e) => setDraft({ ...d, mustInclude: e.target.value })} placeholder="tandem, inflatable" /></label>
            <label className="field"><span>Must not include</span><input className="input" value={d.mustExclude} onChange={(e) => setDraft({ ...d, mustExclude: e.target.value })} placeholder="rack, parts" /></label>
            <label className="field"><span>Check every</span>
              <select className="select" value={d.intervalMinutes} onChange={(e) => setDraft({ ...d, intervalMinutes: Number(e.target.value) })}>
                {[5, 10, 15, 30, 60, 180, 360, 720, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} h`}</option>)}
              </select>
            </label>
            {settings?.source === "facebook" && (
              <label className="field"><span>Facebook location slug (optional)</span><input className="input" value={d.locationSlug} onChange={(e) => setDraft({ ...d, locationSlug: e.target.value })} placeholder="boston" /></label>
            )}
            <label className="field"><span>Min match confidence: {Math.round(d.minRelevance * 100)}%</span><input type="range" min={0} max={1} step={0.05} value={d.minRelevance} onChange={(e) => setDraft({ ...d, minRelevance: Number(e.target.value) })} /></label>
          </div>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <label className="check"><input type="checkbox" checked={d.notifyNew} onChange={(e) => setDraft({ ...d, notifyNew: e.target.checked })} /> Alert on new match</label>
            <label className="check"><input type="checkbox" checked={d.notifyPriceDrop} onChange={(e) => setDraft({ ...d, notifyPriceDrop: e.target.checked })} /> Alert on price drop</label>
            <label className="check"><input type="checkbox" checked={d.notifyFree} onChange={(e) => setDraft({ ...d, notifyFree: e.target.checked })} /> Alert when free</label>
            <label className="check" title={settings?.claudeConfigured ? "" : "Requires ANTHROPIC_API_KEY on the server"}>
              <input type="checkbox" disabled={!settings?.claudeConfigured} checked={d.requireVerified} onChange={(e) => setDraft({ ...d, requireVerified: e.target.checked })} /> Only photo-verified matches
            </label>
            <label className="check"><input type="checkbox" checked={d.enabled} onChange={(e) => setDraft({ ...d, enabled: e.target.checked })} /> Enabled</label>
            <span className="grow" />
            <button className="btn ghost" type="button" onClick={() => { setEditing(null); setDraft(null); }}>Cancel</button>
            <button className="btn primary" type="submit">Save</button>
          </div>
        </form>
      )}

      {watches.data && watches.data.length === 0 && !d && <div className="empty">No tracked items yet. Track something to start getting alerts.</div>}
      <div className="list">
        {(watches.data ?? []).map((w) => (
          <div key={w.id} className={`panel ${selected === w.id ? "soft" : ""}`} style={{ marginTop: 0 }}>
            <div className="row wrap">
              <div className="grow">
                <div className="row"><strong>{w.name}</strong>{!w.enabled && <span className="chip">Paused</span>}</div>
                <div className="small muted">
                  “{w.query}” · {w.locationName || `${w.lat.toFixed(2)}, ${w.lng.toFixed(2)}`} · {w.radiusKm} km
                  {w.maxPrice != null && ` · up to $${w.maxPrice}`}{w.minPrice != null && ` · from $${w.minPrice}`}
                  {w.mustInclude.length > 0 && ` · must include: ${w.mustInclude.join(", ")}`}
                  {w.mustExclude.length > 0 && ` · exclude: ${w.mustExclude.join(", ")}`}
                  {` · ≥${Math.round(w.minRelevance * 100)}% match`}{w.requireVerified && " · photo-verified"}
                </div>
                <div className="small faint">Every {w.intervalMinutes} min · last run {w.lastRunAt ? timeAgo(w.lastRunAt) : "never"} · {w.matchCount ?? 0} matches</div>
              </div>
              <button className="btn sm" type="button" onClick={() => setSelected(selected === w.id ? null : w.id)}>{selected === w.id ? "Hide matches" : "Matches"}</button>
              <button className="btn sm" type="button" disabled={busy === w.id} onClick={() => run(w.id)}>{busy === w.id ? "Running…" : "Run now"}</button>
              <button className="btn sm" type="button" onClick={() => startEdit(w)}>Edit</button>
              <button className="btn sm danger ghost" type="button" onClick={() => remove(w.id)}>Delete</button>
            </div>
            {selected === w.id && (
              <div style={{ marginTop: 12 }}>
                {matches.data && matches.data.length === 0 && <div className="empty">No matches yet.</div>}
                <div className="grid compact">
                  {(matches.data ?? []).map((l) => <ListingCard key={l.id} l={l} onOpen={setOpen} />)}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {open && <ListingDetail l={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
