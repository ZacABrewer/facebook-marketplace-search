import { useState } from "react";
import { api } from "../api";
import { useApp } from "../App";

const RADII = [5, 10, 20, 40, 60, 100, 150, 250];

export function SearchBar() {
  const { ctx, setCtx, runSearch, job, verify, toast } = useApp();
  const [locInput, setLocInput] = useState(ctx.locationName);
  const [geocoding, setGeocoding] = useState(false);

  async function applyLocation(): Promise<boolean> {
    const q = locInput.trim();
    if (!q) return ctx.lat != null;
    if (q === ctx.locationName && ctx.lat != null) return true;
    setGeocoding(true);
    try {
      const g = await api.geocode(q);
      setCtx({ lat: g.lat, lng: g.lng, locationName: q });
      return true;
    } catch (e) {
      toast(`Could not find "${q}": ${(e as Error).message}`);
      return false;
    } finally {
      setGeocoding(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(await applyLocation())) return;
    // runSearch reads ctx from closure; wait a tick for state to settle after geocoding.
    setTimeout(() => void runSearch(), 0);
  }

  const running = job?.status === "running";
  return (
    <form onSubmit={submit}>
      <div className="searchbar">
        <label className="field">
          <span>What are you looking for?</span>
          <input className="input" value={ctx.query} onChange={(e) => setCtx({ query: e.target.value })} placeholder="e.g. kayak, standing desk, iPhone 13" autoFocus />
        </label>
        <label className="field">
          <span>Near</span>
          <input className="input" value={locInput} onChange={(e) => setLocInput(e.target.value)} onBlur={() => void applyLocation()} placeholder="City, ZIP or address" />
        </label>
        <label className="field">
          <span>Radius</span>
          <select className="select" value={ctx.radiusKm} onChange={(e) => setCtx({ radiusKm: Number(e.target.value) })}>
            {RADII.map((r) => (
              <option key={r} value={r}>{r} km</option>
            ))}
          </select>
        </label>
        <button className="btn primary" type="submit" disabled={running || geocoding || !ctx.query.trim()}>
          {running ? "Searching…" : "Search"}
        </button>
      </div>
      <div className="status-line small muted">
        {(running || geocoding) && <span className="spinner" />}
        {geocoding && <span>Finding location…</span>}
        {job && <span>{job.status === "error" ? `Error: ${job.error}` : job.message}</span>}
        {verify.enabled && (verify.queued > 0 || verify.running > 0) && (
          <span className="chip">Cross-checking {verify.running + verify.queued} listings with photos…</span>
        )}
        {ctx.lat != null && <span className="faint">{(job || geocoding) ? "· " : ""}{ctx.locationName || `${ctx.lat.toFixed(3)}, ${ctx.lng?.toFixed(3)}`}</span>}
      </div>
    </form>
  );
}
