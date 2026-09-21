import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import { FilterPanel } from "../components/Filters";
import { ListingCard } from "../components/ListingCard";
import { ListingDetail } from "../components/ListingDetail";
import { SearchBar } from "../components/SearchBar";
import { useAsync, useDebounced } from "../hooks";
import type { Listing, PriceGroup } from "../types";

export function GroupsPage() {
  const { ctx, dataVersion } = useApp();
  const debounced = useDebounced(ctx, 200);
  const [group, setGroup] = useState<string>("free");
  const [open, setOpen] = useState<Listing | null>(null);
  const [local, setLocal] = useState<Listing[] | null>(null);
  const [trackedFirst, setTrackedFirst] = useState(true);

  const enabled = Boolean(debounced.query.trim() && debounced.lat != null);
  const groups = useAsync(() => (enabled ? api.groups(debounced) : Promise.resolve({ groups: [] as PriceGroup[], unknown: 0 })), [JSON.stringify(debounced), dataVersion]);
  const { data, loading } = useAsync(
    () => (enabled ? api.listings(debounced, { priceGroup: group, limit: 500 }) : Promise.resolve({ items: [] as Listing[], total: 0 })),
    [JSON.stringify(debounced), group, dataVersion],
  );
  useEffect(() => setLocal(data?.items ?? null), [data]);

  let items = local ?? [];
  if (trackedFirst) items = [...items].sort((a, b) => Number(b.watchIds.length > 0) - Number(a.watchIds.length > 0));
  const trackedCount = items.filter((l) => l.watchIds.length > 0).length;
  const update = (u: Listing) => setLocal((cur) => (cur ? cur.map((x) => (x.id === u.id ? u : x)) : cur));

  return (
    <div className="page">
      <SearchBar />
      <div className="results">
        <FilterPanel hidePrice />
        <section>
          <div className="tabs">
            {(groups.data?.groups ?? []).map((g) => (
              <button key={g.key} className={group === g.key ? "active" : ""} type="button" onClick={() => setGroup(g.key)}>
                {g.label}<span className="n">{g.count ?? 0}</span>
              </button>
            ))}
            {(groups.data?.unknown ?? 0) > 0 && (
              <button className={group === "unknown" ? "active" : ""} type="button" onClick={() => setGroup("unknown")}>
                No price<span className="n">{groups.data?.unknown}</span>
              </button>
            )}
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="muted small">
              {items.length} listings{trackedCount > 0 && ` · ${trackedCount} matched by your tracked items`}{loading && " · updating…"}
            </span>
            <span className="grow" />
            <label className="check small"><input type="checkbox" checked={trackedFirst} onChange={(e) => setTrackedFirst(e.target.checked)} /> Tracked first</label>
          </div>
          {group === "free" && (
            <p className="small muted" style={{ marginTop: 0 }}>
              Free listings go fast. Add a tracked item with “notify on free” to get pinged the moment one appears.
            </p>
          )}
          {enabled && items.length === 0 && !loading && <div className="empty">Nothing in this price group right now.</div>}
          {!enabled && <div className="empty">Enter a search and location to see price groups.</div>}
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
