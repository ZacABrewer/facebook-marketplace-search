import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import { fmtPrice, timeAgo } from "../hooks";
import type { Listing } from "../types";
import { RelevanceBadge } from "./ListingCard";

export function ListingDetail({ l, onClose, onChange }: { l: Listing; onClose: () => void; onChange?: (l: Listing) => void }) {
  const { ctx, settings, toast } = useApp();
  const [history, setHistory] = useState<Array<{ price: number | null; seenAt: number }>>([]);
  const [note, setNote] = useState(l.note ?? "");

  useEffect(() => {
    api.listing(l.id).then((r) => setHistory(r.history)).catch(() => undefined);
  }, [l.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function saveNote() {
    try {
      const u = await api.patchListing(l.id, { note: note || null });
      onChange?.({ ...l, ...u });
      toast("Note saved");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function verify() {
    try {
      await api.verifyListing(l.id, ctx.query);
      toast("Cross-check queued; the badge updates when it finishes.");
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 12 }}>
          <h1 className="grow">{l.title}</h1>
          <button className="btn ghost" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="detail">
          <div className="stack">
            <div className="img" style={{ borderRadius: 8, overflow: "hidden", background: "var(--bg-soft)" }}>
              {l.imageUrls[0] ? <img src={l.imageUrls[0]} alt="" style={{ width: "100%", display: "block" }} /> : <div className="empty">No photo</div>}
            </div>
            {l.imageUrls.length > 1 && (
              <div className="gallery">
                {l.imageUrls.slice(1).map((u) => <img key={u} src={u} alt="" />)}
              </div>
            )}
          </div>
          <div className="stack">
            <div className="row">
              <span className="price" style={{ fontSize: 22, fontWeight: 600 }}>{fmtPrice(l)}</span>
              {l.previousPrice != null && l.previousPrice !== l.price && <span className="muted">was ${l.previousPrice}</span>}
            </div>
            <div className="row wrap small muted">
              {l.distanceKm != null && <span>{l.distanceKm} km away</span>}
              {l.locationName && <span>· {l.locationName}</span>}
              {l.condition && <span>· {l.condition}</span>}
              {l.seller && <span>· {l.seller}</span>}
              {l.postedAt && <span>· posted {timeAgo(l.postedAt)}</span>}
            </div>
            <div className="row wrap">
              <RelevanceBadge l={l} />
              {l.relevance?.llmReason && <span className="small muted">{l.relevance.llmReason}</span>}
              {settings?.claudeConfigured && (
                <button className="btn sm" type="button" onClick={verify}>Re-check with photo</button>
              )}
            </div>
            <p style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>{l.description || <span className="faint">No description.</span>}</p>
            {history.length > 1 && (
              <div className="small muted">
                Price history: {history.map((h) => (h.price == null ? "?" : `$${h.price}`)).join(" → ")}
              </div>
            )}
            <label className="field">
              <span>Private note</span>
              <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} placeholder="e.g. messaged seller on Tuesday" />
            </label>
            <div className="row">
              <a className="btn primary" href={l.url} target="_blank" rel="noreferrer">Open on Facebook ↗</a>
              <span className="faint small">First seen {timeAgo(l.firstSeenAt)} · last seen {timeAgo(l.lastSeenAt)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
