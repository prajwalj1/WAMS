"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, HealthChip, Bars, StatusChip } from "@/components/ui";
import { useList, ListToolbar, Pager, exportCsv } from "@/components/list";
import { useCollection, Loading } from "@/lib/use-data";
import { WORK_STATUSES, statusLabel } from "@/lib/lifecycle";
import { inScopeRecord } from "@/lib/scope";
import { workHealth } from "@/lib/progress";
import { useFiscalYears } from "@/lib/fiscal";

export default function Works() {
  const { lang, user, role, perms } = useApp();
  // Works are determined by the industry side only — creation needs
  // work.create. Monitor-only roles (PMO Super Admin, Auditor, Viewer…)
  // see the list but never the + New work action.
  const canCreateWork = (perms || []).includes("*") || (perms || []).includes("work.create");
  const [scoped, setScoped] = useState(true);
  const { data: WORKS, loading, error } = useCollection("works");
  const enriched = WORKS.map((w) => ({ ...w, ...workHealth(w, new Date()) }));
  const fys = useFiscalYears(WORKS);
  const [fy, setFy] = useState("");
  // PMO monitors everything read-only — national scope like the dashboard,
  // never the unit subtree filter (which would hide works outside pmo).
  // Staff see ONLY their own unit's works: scoping is locked on and the
  // toggle below is hidden, so the overall list never opens for them.
  const isStaff = role === "STAFF";
  const scopeIds = role === "SUPER_ADMIN" ? null : user.scopeUnitIds;
  const effectiveScoped = isStaff || scoped;
  const visible = effectiveScoped ? enriched.filter((w) => !scopeIds || inScopeRecord(w.orgAncestors, scopeIds)) : enriched;
  // Default: all fiscal years — auto-selecting one silently blanks the list
  // whenever works carry a different (or missing) fy value.
  const visibleFy = fy ? visible.filter((w) => w.fy === fy) : visible;
  const hidden = enriched.length - visible.length;
  const ctl = useList({
    rows: visibleFy,
    searchKeys: ["id", "titleNe", "titleEn", "owner", "subhead"],
    filters: [
      { key: "status", label: tx("स्थिति", "Status", lang), options: WORK_STATUSES.map((s) => ({ value: s, label: statusLabel(s, lang) })) },
      { key: "health", label: tx("स्वास्थ्य", "Health", lang), options: ["ON_TRACK", "AT_RISK", "BEHIND", "OVERDUE", "NOT_STARTED"].map((s) => ({ value: s, label: s })) },
      { key: "unit", label: tx("एकाइ", "Unit", lang), options: [...new Set(enriched.map((w) => w.unit))].map((u) => ({ value: u, label: u })) },
    ],
    sortOptions: [
      { value: "gap", label: tx("अन्तर", "Gap", lang), get: (r) => r.gap },
      { value: "expected", label: "Expected", get: (r) => r.expected },
      { value: "title", label: tx("शीर्षक", "Title", lang), get: (r) => r.titleEn },
    ],
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-black">{t("works", lang)}</h1>
        <div className="no-print flex gap-2 text-xs font-bold">
          <select value={fy} onChange={(e) => setFy(e.target.value)} className="rounded-lg border px-2 py-1.5"><option value="">FY {tx("सबै", "All", lang)}</option>{fys.map((f) => <option key={f} value={f}>FY {f}</option>)}</select>
          {canCreateWork && <Link href="/works/new" className="rounded-lg bg-nepal-blue px-3 py-1.5 text-white">{t("newWork", lang)}</Link>}
        </div>
      </div>
      <Card title={t("worksList", lang)}>
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : <>
        <div className="no-print mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold">
          {role !== "SUPER_ADMIN" && !isStaff && (
          <button onClick={() => setScoped((s) => !s)} className={`rounded-full border px-2.5 py-1 ${scoped ? "bg-nepal-blue text-white" : "bg-white text-slate-600"}`}>
            {tx("स्कोप: मेरो एकाइ + मातहत", "Scope: my unit + below", lang)} ({user.unit})
          </button>
          )}
          {isStaff && (
            <span className="rounded-full bg-nepal-blue px-2.5 py-1 text-white">
              {tx("स्कोप: मेरो एकाइ", "Scope: my unit", lang)} ({user.unit || user.unitId || ""})
            </span>
          )}
          {isStaff && !user?.unitId && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">
              {tx("तपाईंको खातामा एकाइ छैन — PMO लाई एकाइ सेट गर्न लगाउनुहोस्।", "Your account has no unit — ask PMO to set your unit.", lang)}
            </span>
          )}
          {!isStaff && scoped && hidden > 0 && <span className="text-slate-500">{hidden} {tx("बाहिर — उत्पादनमा 404", "outside — 404 in prod", lang)}</span>}
        </div>
        <ListToolbar ctl={ctl} lang={lang}
          filters={[
            { key: "status", label: tx("स्थिति", "Status", lang), options: WORK_STATUSES.map((s) => ({ value: s, label: statusLabel(s, lang) })) },
            { key: "health", label: tx("स्वास्थ्य", "Health", lang), options: ["ON_TRACK", "AT_RISK", "BEHIND", "OVERDUE", "NOT_STARTED"].map((s) => ({ value: s, label: s })) },
          ]}
          sortOptions={[{ value: "gap", label: tx("अन्तर", "Gap", lang) }]}
          onExport={() => exportCsv("works", ["ID", "Title", "Status", "Health", "Gap"], ctl.pageRows.map((w) => [w.id, w.titleEn, w.status, w.health, w.gap]))} />
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {ctl.pageRows.map((w) => (
            <Link key={w.id} href={`/works/${w.id}`} className="rounded-xl border p-3 hover:border-nepal-blue">
              <div className="flex items-center justify-between gap-2"><b className="text-sm">{lang === "ne" ? w.titleNe : w.titleEn} <span className="font-mono text-xs text-slate-400">{w.id}</span></b><HealthChip health={w.health} lang={lang} /></div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">{w.unit} · {w.owner} · <StatusChip status={w.status} lang={lang} /> · {tx("ब.उ.शी.नं.", "Sub-head", lang)} {w.subhead}</div>
              <div className="mt-2"><Bars expected={w.expected} physical={w.physical} financial={w.financialCapped ?? w.financial} financialDisplay={w.financialDisplay} lang={lang} /></div>
            </Link>
          ))}
          {ctl.pageRows.length === 0 && <p className="text-sm text-slate-400">{tx("कुनै कार्य छैन", "No works", lang)}</p>}
        </div>
        <Pager ctl={ctl} lang={lang} />
        </>}
      </Card>
      <Card title={t("newWizard", lang)}>
        <p className="text-[13px] text-slate-600">{tx("सूचीमा प्रत्येक कार्य कार्डमा स्वास्थ्य चिप, स्थिति र प्रगति बार हुन्छ — कार्ड खोल्नुहोस्, कार्य प्रगति अद्यावधिक गर्नुहोस्, कागजात हेर्नुहोस् र स्वीकृति चरण चाल्नुहोस्। फिल्टर र खोजले ठूलो सूची छिटो बनाउँछ।", "Each work card shows its health chip, status and progress bars — open it to update progress, view documents and move approvals. Filters and search keep long lists manageable.", lang)}</p>
      </Card>
    </div>
  );
}
