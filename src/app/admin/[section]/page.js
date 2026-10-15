"use client";
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { Loading } from "@/lib/use-data";
import { mutate } from "@/lib/mutate";
import { useAdminList, readLocalAdminList, clearLocalAdminList } from "@/lib/admin-config";

const SECTIONS = {
  "fiscal-years": { items: ["2083/84 (current)", "2082/83", "2081/82"], hint: "FY · start Shrawan 1 → end Ashadh 31" },
  holidays: { items: ["Dashain — 5 days", "Tihar — 3 days", "Saturday (weekly)"], hint: "Holidays pause expected-progress clock via ON_HOLD-style exclusion" },
  "work-types": { items: ["Infrastructure", "IT System", "Policy", "Procurement"], hint: "Work types drive templates + confirmation rules" },
  templates: { items: ["Standard (20/60/20)", "Procurement-first", "Policy draft"], hint: "Task templates for /works/new" },
  "procurement-methods": { items: ["NCB", "Sealed Quotation", "Direct Purchase", "Framework"], hint: "eGP-linked methods" },
  "expense-heads": { items: ["Consulting", "Goods", "Works", "Training"], hint: "Voucher heads" },
  "document-types": { items: ["TOR", "Agreement", "Bill", "Evidence", "Report"], hint: "DOC types with versioning" },
  thresholds: { items: ["ON_TRACK ≥ −5", "AT_RISK −15…−5", "BEHIND < −15", "Large band NPR 1cr"], hint: "Health + route bands (band editable in Approval routes)" },
  system: { items: ["Timezone Asia/Kathmandu", "Page size 25", "OTP 6-digit · 5 min", "Audit insert-only", "Retention: works + audit 10 years"], hint: "System settings + retention (configurable)" },
};

export default function AdminSection({ params }) {
  const { lang, toast } = useApp();
  const { section } = use(params);
  const def = SECTIONS[section];
  // DB-backed list (shared across browsers). Seed defaults first (SSR-safe);
  // the stored values arrive with the lookups collection.
  const { items, loading, error, reload, save, fromDb } = useAdminList(section, def?.items || []);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  // One-time migration: upload any pre-existing browser-local list once, then
  // delete the local key so the database stays the single source of truth.
  const migrated = useRef(false);
  // One-time migration: upload any pre-existing browser-local list once, then
  // delete the local key so the database stays the single source of truth.
  // No set-state inside — it only POSTs, then reloads the collection.
  useEffect(() => {
    if (migrated.current || loading || fromDb || !def) return;
    const local = readLocalAdminList(section);
    if (!local) return;
    migrated.current = true;
    mutate("/api/data/lookups", {
      method: "POST",
      body: { doc: { key: section, value: local } },
      toast: null,
      reload,
    }).then((r) => {
      if (r?.ok) {
        clearLocalAdminList(section);
        toast(tx("स्थानीय सेटिङ डाटाबेसमा सारियो", "Local settings moved to database", lang));
      }
    });
  }, [loading, fromDb, section, def, reload, toast, lang]);
  if (!def) return <div className="space-y-3"><Link href="/admin" className="text-xs font-bold text-nepal-blue">← Admin</Link><p>Unknown section: {section}</p></div>;
  const saveItems = async (next, label, kind) => {
    const r = await save({ next, toast, label: label || tx("सेभ भयो", "Saved", lang) });
    const m = r?.ok ? (label || tx("सेभ भयो", "Saved", lang)) : (r?.code || "SAVE_FAILED");
    setMsg(m);
    if (!r?.ok) toast(m, kind || "err");
    setTimeout(() => setMsg(""), 1500);
  };
  return (
    <div className="space-y-3">
      <Link href="/admin" className="text-xs font-bold text-nepal-blue">← Admin</Link>
      <h1 className="text-xl font-black">{section} {msg && <span className="text-sm font-bold text-emerald-600">✅ {msg}</span>}</h1>
      <Card title={def.hint} action={<div className="no-print flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="+" className="rounded-lg border px-2 py-1 text-xs" />
        <button onClick={() => { if (draft.trim()) { saveItems([...items, draft.trim()]); setDraft(""); } }} className="cursor-pointer rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white">+ {tx("थप्नुहोस्", "Add", lang)}</button>
      </div>}>
        {loading && !items.length ? <Loading lang={lang} /> : error && !items.length ? <Loading error={error} lang={lang} /> : (
        <Table cols={["#", tx("मान", "Value", lang), ""]} rows={items.map((v, i) => [i + 1, v, <button key={i} onClick={() => saveItems(items.filter((_, j) => j !== i), tx("हटाइयो", "Removed", lang), "del")} className="cursor-pointer text-xs font-bold text-red-600 hover:underline">{tx("हटाउनुहोस्", "Remove", lang)}</button>])} />)}
        {fromDb ? null : <p className="mt-2 text-[11px] text-slate-400">{tx("डिफल्ट सूची · पहिलो सम्पादन डाटाबेसमा सेभ हुनेछ", "Default list · first edit saves to database", lang)}</p>}
      </Card>
    </div>
  );
}
