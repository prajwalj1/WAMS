// Shared fiscal-year source (client only). FY dropdowns must never be empty:
// options resolve live from the DB-backed admin list (/admin → fiscal-years,
// `lookups` collection) first, then FYs already used by works, then built-in
// defaults. No per-browser localStorage — every client sees the same years.
"use client";
import { useMemo } from "react";
import { useCollection } from "./use-data";

export const DEFAULT_FYS = ["2083/84 (current)", "2082/83", "2081/82"];

export function fiscalYearsOf(works = [], configured = null) {
  const used = [...new Set((works || []).map((w) => w?.fy).filter(Boolean))].map(String);
  const base = Array.isArray(configured) && configured.length ? configured : [...DEFAULT_FYS];
  return [...new Set([...base, ...used])];
}

// Normalized FY for comparisons: "2083/84 (current)" → "2083/84".
// Procurement rows carry no fy of their own, and dropdown labels mix the
// "(current)" suffix with bare values — compare normalized on both sides.
export function normFy(v) {
  return String(v || "").replace(/\s*\(.*\)\s*$/, "").trim();
}

export function useFiscalYears(works = []) {
  const lookups = useCollection("lookups");
  const configured = useMemo(() => {
    const doc = (lookups.data || []).find((d) => d?.key === "fiscal-years");
    if (Array.isArray(doc?.value) && doc.value.length) return doc.value.map(String);
    return null;
  }, [lookups.data]);
  return fiscalYearsOf(works, configured);
}
