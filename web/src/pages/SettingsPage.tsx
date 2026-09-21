import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../App";

export function SettingsPage() {
  const { settings, reloadSettings, setCtx, toast } = useApp();
  const [home, setHome] = useState({ locationName: "", radiusKm: 40, locationSlug: "" });
  const [notify, setNotify] = useState({ webhookUrl: "", ntfyTopic: "", ntfyServer: "https://ntfy.sh" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    if (settings.home) setHome({ locationName: settings.home.locationName, radiusKm: settings.home.radiusKm, locationSlug: settings.home.locationSlug ?? "" });
    setNotify(settings.notify);
  }, [settings]);

  async function saveHome(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const g = await api.geocode(home.locationName);
      const h = { locationName: home.locationName, lat: g.lat, lng: g.lng, radiusKm: home.radiusKm, locationSlug: home.locationSlug };
      await api.saveSettings({ home: h });
      setCtx({ lat: g.lat, lng: g.lng, locationName: home.locationName, radiusKm: home.radiusKm, locationSlug: home.locationSlug });
      reloadSettings();
      toast(`Home set to ${g.displayName}`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveNotify(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.saveSettings({ notify });
      reloadSettings();
      toast("Notification settings saved");
    } catch (err) {
      toast((err as Error).message);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1 style={{ marginBottom: 14 }}>Settings</h1>

      <form className="panel" onSubmit={saveHome}>
        <h2>Home location</h2>
        <p className="small muted">Used as the default centre for searches, the map and new tracked items.</p>
        <div className="formgrid">
          <label className="field"><span>City, ZIP or address</span><input className="input" required value={home.locationName} onChange={(e) => setHome({ ...home, locationName: e.target.value })} /></label>
          <label className="field"><span>Default radius (km)</span><input className="input" type="number" min={1} value={home.radiusKm} onChange={(e) => setHome({ ...home, radiusKm: Number(e.target.value) })} /></label>
          <label className="field">
            <span>Facebook location slug (optional)</span>
            <input className="input" value={home.locationSlug} onChange={(e) => setHome({ ...home, locationSlug: e.target.value })} placeholder="e.g. boston or 108100685885621" />
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="small faint grow">Slug: the part after facebook.com/marketplace/ when you browse Marketplace for your city. Improves Facebook result accuracy.</span>
          <button className="btn primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>

      <form className="panel" onSubmit={saveNotify}>
        <h2>Alert delivery</h2>
        <p className="small muted">In-app alerts are always on. Add one of these to get alerts outside the browser.</p>
        <div className="formgrid">
          <label className="field"><span>ntfy topic (phone push, free)</span><input className="input" value={notify.ntfyTopic} onChange={(e) => setNotify({ ...notify, ntfyTopic: e.target.value })} placeholder="my-marketplace-alerts" /></label>
          <label className="field"><span>ntfy server</span><input className="input" value={notify.ntfyServer} onChange={(e) => setNotify({ ...notify, ntfyServer: e.target.value })} /></label>
          <label className="field" style={{ gridColumn: "1 / -1" }}><span>Webhook URL (Discord, Slack, Home Assistant…)</span><input className="input" value={notify.webhookUrl} onChange={(e) => setNotify({ ...notify, webhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/…" /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="small faint grow">Install the ntfy app, subscribe to your topic, and alerts arrive as push notifications.</span>
          <button className="btn primary" type="submit">Save</button>
        </div>
      </form>

      <div className="panel">
        <h2>Server status</h2>
        {settings ? (
          <div className="stack small" style={{ marginTop: 8 }}>
            <div className="row"><span className="muted" style={{ width: 200 }}>Listing source</span><span className="chip">{settings.source}</span>{settings.source === "demo" && <span className="faint">Set SOURCE=facebook to scrape real listings.</span>}</div>
            <div className="row"><span className="muted" style={{ width: 200 }}>Facebook cookies</span><span className="chip">{settings.facebookCookiesConfigured ? "configured" : "not set"}</span><span className="faint">Optional; set FB_COOKIES for logged-in results.</span></div>
            <div className="row"><span className="muted" style={{ width: 200 }}>Photo cross-check (Claude)</span><span className={`chip ${settings.claudeConfigured ? "ok" : ""}`}>{settings.claudeConfigured ? `on · ${settings.claudeModel} · ${settings.verifyMode}` : "off"}</span>{!settings.claudeConfigured && <span className="faint">Set ANTHROPIC_API_KEY to enable.</span>}</div>
          </div>
        ) : (
          <span className="muted small">Loading…</span>
        )}
        <p className="small faint" style={{ marginBottom: 0 }}>These are set with environment variables when starting the server; see the README.</p>
      </div>
    </div>
  );
}
