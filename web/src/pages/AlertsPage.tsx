import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import { ListingDetail } from "../components/ListingDetail";
import { timeAgo, useAsync } from "../hooks";
import type { Listing } from "../types";

const KIND_LABEL = { new_match: "New match", price_drop: "Price drop", free: "Free item", info: "Info" } as const;

export function AlertsPage() {
  const { setUnread, dataVersion, toast } = useApp();
  const { data, reload } = useAsync(() => api.notifications(), [dataVersion]);
  const [open, setOpen] = useState<Listing | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("Notification" in window ? Notification.permission : "unsupported");

  useEffect(() => {
    if (data) setUnread(data.unread);
  }, [data, setUnread]);

  async function markAll() {
    const r = await api.markRead("all");
    setUnread(r.unread);
    reload();
  }

  async function openListing(id: string) {
    try {
      const r = await api.listing(id);
      setOpen({ ...r.listing, distanceKm: null, relevance: null, priceGroup: r.listing.isFree ? "free" : "", isNew: false, priceDropped: false, previousPrice: null, watchIds: [] } as Listing);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="row" style={{ marginBottom: 14 }}>
        <h1 className="grow">Alerts</h1>
        {perm === "default" && (
          <button className="btn sm" type="button" onClick={() => Notification.requestPermission().then(setPerm)}>Enable browser notifications</button>
        )}
        {perm === "granted" && <span className="chip ok">Browser notifications on</span>}
        <button className="btn sm" type="button" onClick={markAll} disabled={!data?.unread}>Mark all read</button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Alerts also go to the webhook or ntfy topic configured in Settings, so you can get them on your phone.
      </p>
      {data && data.items.length === 0 && <div className="empty">No alerts yet. Tracked items will post here when something matches.</div>}
      <div className="list">
        {(data?.items ?? []).map((n) => (
          <div key={n.id} className={`notif ${n.readAt ? "" : "unread"}`}>
            <span className={`dot ${n.readAt ? "off" : ""}`} />
            <div className="grow">
              <div className="row"><strong>{n.title}</strong><span className="chip">{KIND_LABEL[n.kind]}</span></div>
              <div className="small">{n.body}</div>
              <div className="small faint">{timeAgo(n.createdAt)}</div>
            </div>
            {n.listingId && <button className="btn sm" type="button" onClick={() => openListing(n.listingId!)}>View</button>}
            {!n.readAt && (
              <button className="btn sm ghost" type="button" onClick={async () => { const r = await api.markRead([n.id]); setUnread(r.unread); reload(); }}>Read</button>
            )}
          </div>
        ))}
      </div>
      {open && <ListingDetail l={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
