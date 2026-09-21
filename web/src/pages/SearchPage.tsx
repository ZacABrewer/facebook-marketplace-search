import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import { FilterPanel } from "../components/Filters";
import { ListingCard } from "../components/ListingCard";
import { ListingDetail } from "../components/ListingDetail";
import { SearchBar } from "../components/SearchBar";
import { useAsync, useDebounced } from "../hooks";
import type { Listing } from "../types";

export function SearchPage() {
  const { ctx, dataVersion, job } = useApp();
  const debounced = useDebounced(ctx, 200);
  const [open, setOpen] = useState<Listing | null>(null);
  const [local, setLocal] = useState<Listing[] | null>(null);
  const [recent, setRecent] = useState<Array<{ query: string; lastCount: number | null }>>([]);
  const { setCtx, runSearch } = useApp();

  const enabled = Boolean(debounced.query.trim() && debounced.lat != null);
  const { data, loading, error } = useAsync(
    () => (enabled ? api.listings(debounced) : Promise.resolve({ items: [] as Listing[], total: 0 })),
    [JSON.stringify(debounced), dataVersion],
  );
  useEffect(() => setLocal(data?.items ?? null), [data]);
  useEffect(() => {
    api.searches().then((s) => setRecent(s.slice(0, 8))).catch(() => undefined);
  }, [dataVersion]);

  const items = local ?? [];
  const update = (u: Listing) => setLocal((cur) => (cur ? cur.map((x) => (x.id === u.id ? u : x)) : cur));

  return (
    <div className="page">
      <SearchBar />
      {!ctx.query.trim() && recent.length > 0 && (
        <div className="row wrap small" style={{ marginTop: 10 }}>
          <span className="muted">Recent:</span>
          {recent.map((r) => (
            <span key={r.query} className="chip clickable" onClick={() => { setCtx({ query: r.query }); setTimeout(() => void runSearch(), 0); }}>
              {r.query}{r.lastCount != null && <span className="faint"> {r.lastCount}</span>}
            </span>
          ))}
        </div>
      )}
      <div className="results">
        <FilterPanel />
        <section>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="muted small">
              {enabled ? `${data?.total ?? 0} listings` : "Enter a search and location to begin"}
              {loading && " · updating…"}
            </span>
            <span className="grow" />
            <span className="faint small">Cards outlined in black are matched by one of your tracked items</span>
          </div>
          {error && <div className="empty">Error: {error}</div>}
          {!error && enabled && items.length === 0 && !loading && (
            <div className="empty">
              {job?.status === "running" ? "Fetching listings…" : "No listings match. Try a wider radius, lower confidence threshold, or run the search."}
            </div>
          )}
          <div className="grid">
            {items.map((l) => (
              <ListingCard key={l.id} l={l} onOpen={setOpen} onChange={update} />
            ))}
          </div>
        </section>
      </div>
      {open && <ListingDetail l={open} onClose={() => setOpen(null)} onChange={(u) => { update(u); setOpen(u); }} />}
    </div>
  );
}
