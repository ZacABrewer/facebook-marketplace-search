import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { loadContext, saveContext, useRoute, useSse } from "./hooks";
import type { Job, Notification, SearchContext, Settings } from "./types";
import { SearchPage } from "./pages/SearchPage";
import { MapPage } from "./pages/MapPage";
import { GroupsPage } from "./pages/GroupsPage";
import { TrackedPage } from "./pages/TrackedPage";
import { AlertsPage } from "./pages/AlertsPage";
import { SettingsPage } from "./pages/SettingsPage";

export interface AppState {
  ctx: SearchContext;
  setCtx: (patch: Partial<SearchContext> | ((c: SearchContext) => SearchContext)) => void;
  settings: Settings | null;
  reloadSettings: () => void;
  job: Job | null;
  verify: { queued: number; running: number; enabled: boolean };
  /** Increments whenever listings or relevance change on the server; pages refetch on it. */
  dataVersion: number;
  runSearch: () => Promise<void>;
  unread: number;
  setUnread: (n: number) => void;
  toast: (msg: string) => void;
}

const Ctx = createContext<AppState | null>(null);
export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("AppState missing");
  return v;
}

const NAV: Array<[string, string]> = [
  ["search", "Search"],
  ["map", "Map"],
  ["groups", "Price groups"],
  ["tracked", "Tracked"],
  ["alerts", "Alerts"],
  ["settings", "Settings"],
];

export function App() {
  const [route] = useRoute();
  const [ctx, setCtxState] = useState<SearchContext>(loadContext);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [verify, setVerify] = useState({ queued: 0, running: 0, enabled: false });
  const [dataVersion, setDataVersion] = useState(0);
  const [unread, setUnread] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const setCtx = useCallback((patch: Partial<SearchContext> | ((c: SearchContext) => SearchContext)) => {
    setCtxState((c) => {
      const next = typeof patch === "function" ? patch(c) : { ...c, ...patch };
      saveContext(next);
      return next;
    });
  }, []);

  const reloadSettings = useCallback(() => {
    api.settings().then((s) => {
      setSettings(s);
      // First run: adopt the saved home location if the search context has none.
      setCtxState((c) => {
        if (c.lat != null || !s.home) return c;
        const next = { ...c, lat: s.home.lat, lng: s.home.lng, locationName: s.home.locationName, radiusKm: s.home.radiusKm, locationSlug: s.home.locationSlug };
        saveContext(next);
        return next;
      });
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    reloadSettings();
    api.notifications().then((n) => setUnread(n.unread)).catch(() => undefined);
  }, [reloadSettings]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3500);
  }, []);

  useSse((name, payload) => {
    if (name === "job") {
      const j = payload as Job;
      if (j.query === ctx.query.trim().toLowerCase().replace(/\s+/g, " ")) setJob(j);
    } else if (name === "listings" || name === "relevance" || name === "watch") {
      setDataVersion((v) => v + 1);
      if (name === "listings") api.searchStatus((payload as { query: string }).query).then((s) => setVerify(s.verify)).catch(() => undefined);
    } else if (name === "notification") {
      const n = payload as Notification;
      setUnread((u) => u + 1);
      toast(`${n.title} — ${n.body}`);
      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(n.title, { body: n.body });
        } catch {
          /* ignore */
        }
      }
    }
  });

  // Poll verification queue while it is busy so the badge stays accurate.
  useEffect(() => {
    if (!verify.queued && !verify.running) return;
    const t = setInterval(() => {
      api.searchStatus(ctx.query || "-").then((s) => {
        setVerify(s.verify);
        setDataVersion((v) => v + 1);
      }).catch(() => undefined);
    }, 4000);
    return () => clearInterval(t);
  }, [verify.queued, verify.running, ctx.query]);

  const runSearch = useCallback(async () => {
    if (!ctx.query.trim()) return;
    if (ctx.lat == null || ctx.lng == null) {
      toast("Set a location first (Settings or the location box).");
      return;
    }
    try {
      const r = await api.search(ctx);
      setJob(r.job);
    } catch (e) {
      toast((e as Error).message);
    }
  }, [ctx, toast]);

  const state = useMemo<AppState>(
    () => ({ ctx, setCtx, settings, reloadSettings, job, verify, dataVersion, runSearch, unread, setUnread, toast }),
    [ctx, setCtx, settings, reloadSettings, job, verify, dataVersion, runSearch, unread, toast],
  );

  let page: React.ReactNode;
  switch (route) {
    case "map": page = <MapPage />; break;
    case "groups": page = <GroupsPage />; break;
    case "tracked": page = <TrackedPage />; break;
    case "alerts": page = <AlertsPage />; break;
    case "settings": page = <SettingsPage />; break;
    default: page = <SearchPage />;
  }

  return (
    <Ctx.Provider value={state}>
      <div className="app">
        <header className="topbar">
          <span className="brand">Marketplace Search</span>
          <nav className="nav">
            {NAV.map(([key, label]) => (
              <a key={key} href={`#/${key}`} className={route === key ? "active" : ""}>
                {label}
                {key === "alerts" && unread > 0 && <span className="badge-count">{unread}</span>}
              </a>
            ))}
          </nav>
          <span className="grow" />
          {settings && (
            <span className="small muted row">
              <span className="chip">{settings.source === "demo" ? "Demo data" : "Facebook"}</span>
              <span className={`chip ${settings.claudeConfigured && settings.verifyMode !== "off" ? "ok" : ""}`}>
                {settings.claudeConfigured && settings.verifyMode !== "off" ? "Cross-check on" : "Cross-check off"}
              </span>
            </span>
          )}
        </header>
        {settings?.staticDemo && (
          <div className="banner">
            Browser-only demo with generated listings: searches, filters, the map, price groups, tracked items and alerts all work, but
            nothing is fetched from Facebook and there is no photo cross-check. Run the server for real data —{" "}
            <a href="https://github.com/ZacABrewer/facebook-marketplace-search#quick-start" target="_blank" rel="noreferrer">see the README</a>.
          </div>
        )}
        <main className="main">{page}</main>
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </Ctx.Provider>
  );
}
