import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_FILTERS, type SearchContext } from "./types";

const CTX_KEY = "fbms.searchContext";

export function loadContext(): SearchContext {
  try {
    const raw = localStorage.getItem(CTX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SearchContext>;
      return { ...defaultContext(), ...parsed, filters: { ...DEFAULT_FILTERS, ...(parsed.filters ?? {}) } };
    }
  } catch {
    /* ignore */
  }
  return defaultContext();
}

export function defaultContext(): SearchContext {
  return { query: "", locationName: "", locationSlug: "", lat: null, lng: null, radiusKm: 40, filters: { ...DEFAULT_FILTERS } };
}

export function saveContext(ctx: SearchContext): void {
  try {
    localStorage.setItem(CTX_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore */
  }
}

/** Minimal hash router: "#/map" -> "map". */
export function useRoute(): [string, (r: string) => void] {
  const parse = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "search");
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onHash = () => setRoute(parse());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return [route, (r: string) => (location.hash = `#/${r}`)];
}

export type SseHandler = (name: string, payload: unknown) => void;

/** Subscribe to server-sent events; reconnects automatically. */
export function useSse(handler: SseHandler): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let retry = 1000;
    const connect = () => {
      es = new EventSource("/api/events");
      for (const name of ["job", "listings", "relevance", "notification", "watch"]) {
        es.addEventListener(name, (ev) => {
          try {
            ref.current(name, JSON.parse((ev as MessageEvent).data));
          } catch {
            /* ignore */
          }
        });
      }
      es.onopen = () => (retry = 1000);
      es.onerror = () => {
        es?.close();
        if (!closed) setTimeout(connect, (retry = Math.min(retry * 2, 15_000)));
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
    };
  }, []);
}

/** Debounce a value. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Simple async loader with manual refresh. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef
      .current()
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload };
}

export function fmtPrice(l: { isFree: boolean; price: number | null; currency?: string }): string {
  if (l.isFree || l.price === 0) return "Free";
  if (l.price == null) return "—";
  return `$${l.price.toLocaleString()}`;
}

export function timeAgo(ts: number | null): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
