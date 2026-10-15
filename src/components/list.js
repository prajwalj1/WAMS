"use client";
import { useMemo, useState } from "react";
import { tx } from "@/lib/i18n";

export const PAGE_SIZE = 25;

// Generic client-side list engine: search + filters + sort + pagination.
// rows: array of objects. searchKeys: fields scanned by the query.
// filters: [{key, label, options:[{value,label}], get?}] — get(row) defaults to row[key].
// sortOptions: [{value,label,get}] — get(row) sortable value.
export function useList({ rows = [], searchKeys = [], filters = [], sortOptions = [], pageSize = PAGE_SIZE }) {
  const [q, setQ] = useState("");
  const [fv, setFv] = useState({});
  const [sort, setSort] = useState(sortOptions[0]?.value || "");
  const [dir, setDir] = useState("asc");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    let r = [...rows];
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((row) => searchKeys.some((k) => String(row[k] ?? "").toLowerCase().includes(needle)));
    for (const f of filters) {
      const v = fv[f.key];
      if (v && v !== "ALL") {
        const get = f.get || ((row) => row[f.key]);
        r = r.filter((row) => String(get(row)) === String(v));
      }
    }
    const opt = sortOptions.find((o) => o.value === sort);
    if (opt) {
      r.sort((a, b) => {
        const av = opt.get(a);
        const bv = opt.get(b);
        const c = av < bv ? -1 : av > bv ? 1 : 0;
        return dir === "asc" ? c : -c;
      });
    }
    return r;
  }, [rows, q, fv, sort, dir, searchKeys, filters, sortOptions]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  return { q, setQ, fv, setFv, sort, setSort, dir, setDir, page: safePage, setPage, pages, total: filtered.length, pageRows,
    resetPage: () => setPage(1) };
}

// Excel-compatible export (UTF-8 BOM CSV opens in Excel). Browser download.
export function exportCsv(filename, cols, rows) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "\uFEFF" + [cols.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ListToolbar({ ctl, lang = "en", filters = [], sortOptions = [], onExport, searchPh }) {
  return (
    <div className="no-print space-y-2">
      <div className="flex flex-wrap gap-2 text-xs font-bold">
        <input value={ctl.q} onChange={(e) => { ctl.setQ(e.target.value); ctl.resetPage(); }}
          placeholder={searchPh || tx("खोज्नुहोस्…", "Search…", lang)} className="min-w-40 flex-1 rounded-lg border px-3 py-1.5" />
        {filters.map((f) => (
          <select key={f.key} value={ctl.fv[f.key] || "ALL"} onChange={(e) => { ctl.setFv({ ...ctl.fv, [f.key]: e.target.value }); ctl.resetPage(); }}
            className="rounded-lg border px-2 py-1.5">
            <option value="ALL">{f.label}: {tx("सबै", "All", lang)}</option>
            {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {sortOptions.length > 0 && (
          <>
            <select value={ctl.sort} onChange={(e) => ctl.setSort(e.target.value)} className="rounded-lg border px-2 py-1.5">
              {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={() => ctl.setDir(ctl.dir === "asc" ? "desc" : "asc")} className="rounded-lg border px-2 py-1.5" aria-label="sort direction">
              {ctl.dir === "asc" ? "↑" : "↓"}
            </button>
          </>
        )}
        {onExport && <button onClick={onExport} className="rounded-lg border px-3 py-1.5">Excel ⬇</button>}
      </div>
    </div>
  );
}

export function Pager({ ctl, lang = "en" }) {
  if (ctl.pages <= 1) return <p className="mt-2 text-[11px] text-slate-400">{ctl.total} {tx("पङ्क्ति", "rows", lang)}</p>;
  return (
    <div className="no-print mt-2 flex flex-wrap items-center gap-1.5 text-xs font-bold">
      <button disabled={ctl.page <= 1} onClick={() => ctl.setPage(ctl.page - 1)} className="rounded-lg border px-2 py-1 disabled:opacity-40">←</button>
      <span className="text-slate-500">{ctl.page} / {ctl.pages} · {ctl.total}</span>
      <button disabled={ctl.page >= ctl.pages} onClick={() => ctl.setPage(ctl.page + 1)} className="rounded-lg border px-2 py-1 disabled:opacity-40">→</button>
    </div>
  );
}
