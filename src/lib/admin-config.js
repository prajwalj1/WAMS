// DB-backed admin config (client only). Admin sections (/admin/*) used to
// persist to per-browser localStorage (`wmams-admin-*`), so every machine saw
// different fiscal years / methods / heads. They now live in the shared
// `lookups` collection ({ key: section, value: [items] }) — one read path for
// every client. localStorage is only touched once: a one-time migration that
// uploads a pre-existing browser list, then deletes the local key.
"use client";
import { useMemo } from "react";
import { useCollection } from "./use-data";
import { mutate } from "./mutate";

export function useAdminList(section, fallback = []) {
  const q = useCollection("lookups");
  const doc = useMemo(
    () => (q.data || []).find((d) => d?.key === section),
    [q.data, section]
  );
  const items = useMemo(() => {
    if (Array.isArray(doc?.value) && doc.value.length) return doc.value.map(String);
    return [...fallback];
  }, [doc, fallback]);
  const save = async ({ next, toast, label }) => {
    const arr = (next || []).map(String);
    if (doc) {
      // __v travels INSIDE body — mutate() only serializes body, so a sibling
      // __v never reached the server and every admin save failed with
      // STALE_VERSION (server compared doc.__v against the default 1).
      return mutate("/api/data/lookups", {
        method: "PATCH",
        body: { match: { _id: doc._id }, update: { value: arr }, __v: doc.__v ?? 1 },
        okMsg: label,
        toast,
        reload: q.reload,
      });
    }
    return mutate("/api/data/lookups", {
      method: "POST",
      body: { doc: { key: section, value: arr } },
      okMsg: label,
      toast,
      reload: q.reload,
    });
  };
  return { items, loading: q.loading, error: q.error, reload: q.reload, save, fromDb: !!doc };
}

// One-time migration: pre-existing browser-local list for this section, if any.
export function readLocalAdminList(section) {
  try {
    const raw = window.localStorage.getItem(`wmams-admin-${section}`);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return arr.map(String);
  } catch {}
  return null;
}

export function clearLocalAdminList(section) {
  try {
    window.localStorage.removeItem(`wmams-admin-${section}`);
  } catch {}
}
