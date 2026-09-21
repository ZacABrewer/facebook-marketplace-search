import { useApp } from "../App";
import { DEFAULT_FILTERS, type Filters, type SortKey } from "../types";

const CONDITIONS = ["New", "Like new", "Good", "Fair", "Used"];
const SORTS: Array<[SortKey, string]> = [
  ["relevance", "Best match"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["distance", "Distance"],
  ["newest", "Newest"],
  ["recently_seen", "Recently seen"],
];

export function FilterPanel({ hidePrice = false }: { hidePrice?: boolean }) {
  const { ctx, setCtx, settings } = useApp();
  const f = ctx.filters;
  const set = (patch: Partial<Filters>) => setCtx({ filters: { ...f, ...patch } });
  const canVerify = Boolean(settings?.claudeConfigured && settings.verifyMode !== "off");

  return (
    <aside className="filters">
      <div className="row">
        <h3 className="grow">Filters</h3>
        <button className="btn ghost sm" type="button" onClick={() => set({ ...DEFAULT_FILTERS })}>Reset</button>
      </div>
      <label className="field">
        <span>Sort</span>
        <select className="select sm" value={f.sort} onChange={(e) => set({ sort: e.target.value as SortKey })}>
          {SORTS.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      {!hidePrice && (
        <div className="stack">
          <span className="small muted">Price</span>
          <div className="row">
            <input className="input sm grow" type="number" min={0} placeholder="Min" value={f.minPrice} onChange={(e) => set({ minPrice: e.target.value })} style={{ width: 0 }} />
            <span className="faint">–</span>
            <input className="input sm grow" type="number" min={0} placeholder="Max" value={f.maxPrice} onChange={(e) => set({ maxPrice: e.target.value })} style={{ width: 0 }} />
          </div>
          <label className="check small"><input type="checkbox" checked={f.includeFree} onChange={(e) => set({ includeFree: e.target.checked })} /> Always include free items</label>
        </div>
      )}
      <div className="stack">
        <span className="small muted">Match confidence: {Math.round(f.minRelevance * 100)}%+</span>
        <input type="range" min={0} max={1} step={0.05} value={f.minRelevance} onChange={(e) => set({ minRelevance: Number(e.target.value) })} />
        <label className="check small" title={canVerify ? "" : "Set ANTHROPIC_API_KEY on the server to enable photo cross-checks"}>
          <input type="checkbox" checked={f.verifiedOnly} disabled={!canVerify} onChange={(e) => set({ verifiedOnly: e.target.checked })} /> Photo-verified matches only
        </label>
      </div>
      <div className="stack">
        <span className="small muted">Condition</span>
        <div className="row wrap">
          {CONDITIONS.map((c) => {
            const on = f.conditions.includes(c);
            return (
              <span key={c} className={`chip clickable ${on ? "dark" : ""}`} onClick={() => set({ conditions: on ? f.conditions.filter((x) => x !== c) : [...f.conditions, c] })}>
                {c}
              </span>
            );
          })}
        </div>
      </div>
      <label className="field">
        <span>Exclude words (comma separated)</span>
        <input className="input sm" value={f.exclude} onChange={(e) => set({ exclude: e.target.value })} placeholder="rack, parts, wanted" />
      </label>
      <label className="field">
        <span>Posted within</span>
        <select className="select sm" value={f.postedWithinDays} onChange={(e) => set({ postedWithinDays: e.target.value })}>
          <option value="">Any time</option>
          <option value="1">24 hours</option>
          <option value="3">3 days</option>
          <option value="7">7 days</option>
          <option value="30">30 days</option>
        </select>
      </label>
      <div className="stack">
        <label className="check small"><input type="checkbox" checked={f.hasPhoto} onChange={(e) => set({ hasPhoto: e.target.checked })} /> Has photo</label>
        <label className="check small"><input type="checkbox" checked={f.favoritesOnly} onChange={(e) => set({ favoritesOnly: e.target.checked })} /> Favorites only</label>
        <label className="check small"><input type="checkbox" checked={f.showHidden} onChange={(e) => set({ showHidden: e.target.checked })} /> Show hidden</label>
      </div>
    </aside>
  );
}
