"use client";
import { useCallback, useEffect, useState } from "react";

// Session id for server-side permission/visibility checks on reads.
// Best-effort: public/error paths work without it.
function sidHeader() {
  try {
    const sid = window.sessionStorage.getItem("wmams-sid");
    return sid ? { "x-sid": sid } : {};
  } catch { return {}; }
}

// Short client cache + in-flight dedup: the dashboard, bell icon and
// reports pages all mount useCollection("works") etc. at once. Without this,
// one page view fires 10-20 identical GETs. Cache lives 15s, inflight
// promises are shared so concurrent mounts do 1 network request, not N.
const CACHE = new Map();
const INFLIGHT = new Map();
const TTL_MS = 15000;

function cacheKey(col, opts) {
  return JSON.stringify({ col, scope: opts.scope || "", q: opts.q || "", sort: opts.sort || "", pageSize: opts.pageSize || 100, page: opts.page || 1, includeArchived: opts.includeArchived || "" });
}

function buildParams(col, opts) {
  const p = new URLSearchParams({ pageSize: String(opts.pageSize || 100) });
  if (opts.page) p.set("page", String(opts.page));
  if (opts.scope) p.set("scope", opts.scope);
  if (opts.q) p.set("q", opts.q);
  if (opts.sort) p.set("sort", opts.sort);
  if (opts.includeArchived) p.set("includeArchived", "1");
  return p;
}

async function fetchCollection(col, opts, bust = false) {
  const key = cacheKey(col, opts);
  if (!bust) {
    const hit = CACHE.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return { items: hit.items ?? hit.data ?? [], total: hit.total ?? 0 };
    const flying = INFLIGHT.get(key);
    if (flying) return flying;
  }
  const p = buildParams(col, opts);
  const promise = fetch(`/api/data/${col}?${p}`, { headers: { ...sidHeader() } })
    .then((r) => r.json())
    .then((res) => {
      if (res.error) throw new Error(res.error.code || "LOAD_FAILED");
      const out = { items: res.items || [], total: res.total ?? (res.items || []).length };
      CACHE.set(key, { at: Date.now(), ...out });
      return out;
    })
    .finally(() => { INFLIGHT.delete(key); });
  INFLIGHT.set(key, promise);
  return promise;
}

// useCollection(col, { scope, q, page, pageSize, sort }) — live Mongo-backed rows.
// Replaces static data.js imports across all pages.
const cachedItems = (key) => CACHE.get(key)?.items ?? CACHE.get(key)?.data ?? [];
export function useCollection(col, opts = {}) {
  const [data, setData] = useState(() => cachedItems(cacheKey(col, opts)));
  const [total, setTotal] = useState(() => CACHE.get(cacheKey(col, opts))?.total || 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const key = cacheKey(col, opts);

  const load = useCallback(async (bust = true) => {
    setLoading(true);
    setError("");
    try {
      const out = await fetchCollection(col, opts, bust);
      setData(Array.isArray(out.items) ? out.items : []);
      setTotal(out.total ?? 0);
    } catch (e) {
      setError(e.message || "LOAD_FAILED");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Serve stale cache instantly, then revalidate in background.
      const hit = CACHE.get(key);
      if (hit && Date.now() - hit.at < TTL_MS) {
        setData(Array.isArray(hit.items) ? hit.items : (Array.isArray(hit.data) ? hit.data : []));
        setTotal(hit.total ?? 0);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const out = await fetchCollection(col, opts, false);
        if (cancelled) return;
        setData(Array.isArray(out.items) ? out.items : []);
        setTotal(out.total ?? 0);
      } catch (e) {
        if (!cancelled) setError(e.message || "LOAD_FAILED");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, total, loading, error, reload: load };
}

export function Loading({ error, lang }) {
  if (error) return <p className="text-xs font-bold text-red-600">❌ {error} — {lang === "ne" ? "DB मा जडान भएन। Mongo चलाउनुहोस् र /api/seed बाट सिड गर्नुहोस्।" : "DB unreachable. Start Mongo and seed via /api/seed."}</p>;
  return (
    <div className="space-y-2 py-1" role="status" aria-label="loading">
      <div className="skel h-3 w-3/4" />
      <div className="skel h-3 w-full" />
      <div className="skel h-3 w-2/3" />
    </div>
  );
}
