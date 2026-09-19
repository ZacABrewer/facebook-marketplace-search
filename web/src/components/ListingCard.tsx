import { useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import { fmtPrice, timeAgo } from "../hooks";
import type { Listing } from "../types";

export function RelevanceBadge({ l }: { l: Listing }) {
  const r = l.relevance;
  if (!r) return null;
  const pct = Math.round(r.finalScore * 100);
  if (r.llmVerdict === "match") return <span className="chip ok" title={r.llmReason ?? ""}>✓ Verified {pct}%</span>;
  if (r.llmVerdict === "no_match") return <span className="chip bad" title={r.llmReason ?? ""}>✕ Not it {pct}%</span>;
  return (
    <span className="rel muted" title={r.llmVerdict === "unsure" ? r.llmReason ?? "" : "Keyword match; not photo-checked yet"}>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      {pct}%
    </span>
  );
}

export function ListingCard({
  l,
  layout = "grid",
  selected = false,
  onOpen,
  onChange,
  onHover,
}: {
  l: Listing;
  layout?: "grid" | "row";
  selected?: boolean;
  onOpen?: (l: Listing) => void;
  onChange?: (l: Listing) => void;
  onHover?: (l: Listing | null) => void;
}) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const tracked = l.watchIds.length > 0;

  async function patch(body: { favorite?: boolean; hidden?: boolean }) {
    setBusy(true);
    try {
      const updated = await api.patchListing(l.id, body);
      onChange?.({ ...l, ...updated });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      className={`card ${layout === "row" ? "rowcard" : ""} ${tracked ? "tracked" : ""} ${l.hidden ? "dim" : ""} ${selected ? "selected" : ""}`}
      onMouseEnter={() => onHover?.(l)}
      onMouseLeave={() => onHover?.(null)}
    >
      <a className="img" href={l.url} target="_blank" rel="noreferrer" onClick={(e) => { if (onOpen) { e.preventDefault(); onOpen(l); } }}>
        {l.imageUrls[0] ? <img src={l.imageUrls[0]} alt="" loading="lazy" /> : <span className="noimg">No photo</span>}
      </a>
      <div className="corner">
        {tracked && <span className="chip dark">Tracked</span>}
        {l.isNew && <span className="chip">New</span>}
        {l.priceDropped && <span className="chip ok">↓ Price drop</span>}
      </div>
      <div className={`actions ${l.favorite ? "on" : ""}`}>
        <button className="btn icon sm" type="button" disabled={busy} title={l.favorite ? "Unfavorite" : "Favorite"} onClick={() => patch({ favorite: !l.favorite })}>
          {l.favorite ? "★" : "☆"}
        </button>
        <button className="btn icon sm" type="button" disabled={busy} title={l.hidden ? "Unhide" : "Hide"} onClick={() => patch({ hidden: !l.hidden })}>
          {l.hidden ? "↺" : "✕"}
        </button>
      </div>
      <div className="body">
        <div className="price">
          {fmtPrice(l)}
          {l.priceDropped && l.previousPrice != null && <span className="was">${l.previousPrice}</span>}
        </div>
        <div className="title" title={l.title}>{l.title}</div>
        <div className="meta">
          {l.distanceKm != null && <span>{l.distanceKm} km</span>}
          {l.locationName && <span>· {l.locationName}{l.approxLocation ? " (approx.)" : ""}</span>}
          {l.condition && <span>· {l.condition}</span>}
          {l.postedAt && <span>· {timeAgo(l.postedAt)}</span>}
        </div>
        <div className="tags">
          <RelevanceBadge l={l} />
          {!l.active && <span className="chip">Gone</span>}
        </div>
      </div>
    </article>
  );
}
