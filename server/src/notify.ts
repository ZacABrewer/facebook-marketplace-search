import { getDb, getSetting, rowToNotification } from "./db.js";
import { events } from "./events.js";
import type { Notification } from "./types.js";

export interface NotifySettings {
  webhookUrl: string; // any JSON webhook; Discord/Slack-compatible "content"/"text" fields are sent
  ntfyTopic: string; // https://ntfy.sh topic for phone push, empty to disable
  ntfyServer: string;
}

export function getNotifySettings(): NotifySettings {
  return getSetting<NotifySettings>("notify", { webhookUrl: "", ntfyTopic: "", ntfyServer: "https://ntfy.sh" });
}

export async function notify(input: Omit<Notification, "id" | "createdAt" | "readAt">): Promise<Notification> {
  const db = getDb();
  const now = Date.now();
  const res = db
    .prepare("INSERT INTO notifications (watch_id, listing_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(input.watchId, input.listingId, input.kind, input.title, input.body, now);
  const n = rowToNotification(db.prepare("SELECT * FROM notifications WHERE id = ?").get(Number(res.lastInsertRowid)) as Record<string, unknown>);
  events.emit("notification", n);
  void deliverExternal(n).catch((err) => console.error("[notify] external delivery failed:", err instanceof Error ? err.message : err));
  return n;
}

async function deliverExternal(n: Notification): Promise<void> {
  const s = getNotifySettings();
  const listingUrl = n.listingId
    ? (getDb().prepare("SELECT url FROM listings WHERE id = ?").get(n.listingId) as { url: string } | undefined)?.url
    : undefined;
  const text = `${n.title}\n${n.body}${listingUrl ? `\n${listingUrl}` : ""}`;
  const tasks: Promise<unknown>[] = [];
  if (s.webhookUrl) {
    tasks.push(
      fetch(s.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text, text, notification: n, url: listingUrl }),
      }),
    );
  }
  if (s.ntfyTopic) {
    const base = (s.ntfyServer || "https://ntfy.sh").replace(/\/$/, "");
    tasks.push(
      fetch(`${base}/${encodeURIComponent(s.ntfyTopic)}`, {
        method: "POST",
        headers: { Title: n.title, Priority: n.kind === "free" ? "high" : "default", ...(listingUrl ? { Click: listingUrl } : {}) },
        body: n.body,
      }),
    );
  }
  await Promise.all(tasks);
}

export function listNotifications(limit = 100): Notification[] {
  return (getDb().prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map(rowToNotification);
}

export function markRead(ids: number[] | "all"): void {
  const db = getDb();
  if (ids === "all") db.prepare("UPDATE notifications SET read_at = ? WHERE read_at IS NULL").run(Date.now());
  else for (const id of ids) db.prepare("UPDATE notifications SET read_at = ? WHERE id = ?").run(Date.now(), id);
}

export function unreadCount(): number {
  return Number((getDb().prepare("SELECT COUNT(*) AS c FROM notifications WHERE read_at IS NULL").get() as { c: number }).c);
}
