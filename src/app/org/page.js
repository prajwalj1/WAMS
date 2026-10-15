"use client";
import { useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table } from "@/components/ui";
import { useList, ListToolbar, Pager, exportCsv } from "@/components/list";
import { Field, ServerErrors, useForm, vRequired } from "@/components/forms";
import { useCollection, Loading } from "@/lib/use-data";
import { mutate } from "@/lib/mutate";
import { UNIT_TYPE } from "@/lib/enums";

// Unit types offerable in the add-unit form — everything except the PMO
// root (it already exists; creating a second one would fork the tree).
const CREATABLE_TYPES = UNIT_TYPE.filter((x) => x !== "PMO");

export default function Org() {
  const { lang, role, perms, ready, toast, user } = useApp();
  // PMO creates ministries only — lower levels are staffed beneath them.
  // So at PMO level (SUPER_ADMIN or a PMO-unit posting) the Type picker
  // offers MINISTRY alone; everyone else keeps the full creatable list.
  const isPmo = role === "SUPER_ADMIN" || user?.unitType === "PMO";
  const typeOptions = isPmo ? ["MINISTRY"] : CREATABLE_TYPES;
  // Unit management is PMO-only: SUPER_ADMIN alone can add / activate /
  // deactivate units. Ministers and everyone else get a read-only view —
  // no actions at ministry level in Organisation.
  const canManageUnits = role === "SUPER_ADMIN";
  // Deactivated units are hidden by default (?includeArchived=1 reveals them
  // for managers so they can be re-activated).
  const [showArchived, setShowArchived] = useState(false);
  const { data, loading, error, reload } = useCollection("units", { includeArchived: showArchived && canManageUnits ? "1" : "" });
  const worksQ = useCollection("works");
  const units = data;
  // View filter: active-only (default) vs deactivated-only. The server hides
  // archived units unless ?includeArchived=1, so the deactivated view filters
  // the revealed rows down to archived ones client-side.
  const visible = showArchived ? units.filter((u) => u.archivedAt) : units.filter((u) => !u.archivedAt);
  // Live work counts per unit — never stored aggregates.
  const worksByUnit = {};
  (worksQ.data || []).forEach((w) => {
    const k = w.orgUnitId || "";
    worksByUnit[k] = (worksByUnit[k] || 0) + 1;
  });
  const liveWorks = (u) => worksByUnit[u.id] ?? 0;
  const [showAdd, setShowAdd] = useState(false);
  const f = useForm({ code: "", nameEn: "", type: "", parentId: "" }, { code: vRequired, nameEn: vRequired, type: vRequired });
  const ctl = useList({
    rows: visible,
    searchKeys: ["code", "nameNe", "nameEn", "type"],
    filters: [{ key: "type", label: tx("प्रकार", "Type", lang), options: [...new Set(visible.map((u) => u.type))].map((x) => ({ value: x, label: x })) }],
    sortOptions: [{ value: "code", label: tx("कोड", "Code", lang), get: (r) => r.code || r.id || "" }],
  });
  const add = async () => {
    if (units.some((u) => u.code.toUpperCase() === f.values.code.toUpperCase())) { await f.submit("activity", { date: new Date().toISOString() }); f.set("code")(""); return; }
    const r = await f.submit("activity", { date: new Date().toISOString() });
    void r;
    const errs = f.validateClient();
    // PMO level has no choice to make — MINISTRY is the only type.
    if (isPmo) delete errs.type;
    if (Object.keys(errs).length) return;
    // Parent accepts an existing unit (matched by id/code/name) or free text
    // for a unit not in the list — typed value is kept as-is (lowercased).
    const typedParent = (f.values.parentId || "").trim();
    const parentMatch = typedParent
      ? units.find((u) => [u.id, u.code, u.nameEn].filter(Boolean).map((x) => String(x).toLowerCase()).includes(typedParent.toLowerCase()))
      : null;
    const parentId = parentMatch ? parentMatch.id : (typedParent ? typedParent.toLowerCase() : null);
    // PMO level always creates ministries — the picker offers nothing else.
    const saveType = isPmo ? "MINISTRY" : f.values.type;
    await mutate("/api/data/units", { method: "POST",
      body: { doc: { id: f.values.code.toLowerCase(), code: f.values.code.toUpperCase(), nameNe: f.values.nameEn, nameEn: f.values.nameEn, type: saveType, parent: parentId, mode: saveType === "MINISTRY" ? "—" : "INHERIT", works: 0, head: "—" } },
      okMsg: `${f.values.code.toUpperCase()} · ${tx("एकाइ थपियो", "Unit added", lang)}`,
      toast, reload });
    // Clear the form so the next add starts blank — never reopening stuck
    // on the previous type/value.
    f.set("code")(""); f.set("nameEn")(""); f.set("type")(""); f.set("parentId")("");
    setShowAdd(false);
  };
  const deactivate = async (u) => {
    await mutate("/api/data/units", { method: "PATCH",
      body: { match: { id: u.id || u.code }, update: { archivedAt: new Date().toISOString() }, __v: u.__v ?? 1 },
      okMsg: `${u.code || u.id} · ${tx("एकाइ निष्क्रिय", "Unit deactivated", lang)}`,
      toast, reload });
    // Keep the row visible: flip to the deactivated view so the unit shows
    // its ⛔ status (with ✅ Activate) instead of just disappearing.
    setShowArchived(true);
  };
  const activate = async (u) => {
    await mutate("/api/data/units", { method: "PATCH",
      body: { match: { id: u.id || u.code }, update: { archivedAt: null }, __v: u.__v ?? 1 },
      okMsg: `${u.code || u.id} · ${tx("एकाइ सक्रिय", "Unit activated", lang)}`,
      toast, reload });
    // Keep the row visible: flip back to the active-only view.
    setShowArchived(false);
  };
  const isOff = (u) => !!u.archivedAt;
  // Hard delete is PMO-only and permanent: the server refuses units that
  // still have child units, users or works (move/remove those first).
  const canDelete = role === "SUPER_ADMIN";
  // Organisation is PMO-only: roles without org.unit.manage (ministry since
  // the permission was removed) get Page Not Found here — never a redirect,
  // never a read-only table. Gated on `ready` so the first render before
  // session hydration never 404s a legitimate user.
  if (ready && !(perms || []).includes("org.unit.manage")) notFound();
  const removeUnit = async (u) => {
    const label = u.code || u.id;
    try {
      if (!window.confirm(`${tx("पक्का मेट्ने?", "Delete for sure?", lang)} ${label}`)) return;
    } catch { return; }
    await mutate("/api/data/units", { method: "DELETE",
      body: { match: { id: u.id || u.code } },
      okMsg: `${label} · ${tx("एकाइ मेटियो", "Unit deleted", lang)}`,
      toast, reload });
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{t("orgTitle", lang)}</h1>
      <Card title={tx("PMO → मन्त्रालय → विभाग / महाशाखा → शाखा", "PMO → Ministry → Department / Mahashakha → Section", lang)}
        action={canManageUnits ? <div className="flex gap-2">
          <button onClick={() => setShowArchived((s) => !s)} className="cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-bold">{showArchived ? tx("सक्रिय मात्र", "Active only", lang) : tx("निष्क्रिय मात्र", "Deactivated only", lang)}</button>
          <button onClick={() => setShowAdd((s) => !s)} className="cursor-pointer rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">+ {tx("एकाइ", "Unit", lang)}</button>
        </div> : null}>
        {showAdd && (
          <div className="mb-2 grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-5">
            <Field label={tx("कोड", "Code", lang)} error={f.errors.code} lang={lang} required><input value={f.values.code} onChange={f.set("code")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
            <Field label={tx("नाम", "Name", lang)} error={f.errors.nameEn} lang={lang} required><input value={f.values.nameEn} onChange={f.set("nameEn")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
            <Field label={tx("प्रकार", "Type", lang)} error={f.errors.type} lang={lang} required><select value={isPmo ? "MINISTRY" : f.values.type} onChange={f.set("type")} className="mt-1 w-full rounded-lg border px-2 py-1.5">{isPmo ? null : <option value="">—</option>}{typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
            <Field label={tx("माउ एकाइ", "Parent unit", lang)} lang={lang}>
              <input value={f.values.parentId} onChange={f.set("parentId")} placeholder={tx("माउ एकाइ ID टाइप गर्नुहोस्", "Type the parent unit ID", lang)} className="mt-1 w-full rounded-lg border px-2 py-1.5" />
            </Field>
            <div className="flex items-end gap-2"><button onClick={add} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">{t("add", lang)}</button><ServerErrors errors={f.serverErrors} lang={lang} /></div>
          </div>
        )}
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : <>
        <ListToolbar ctl={ctl} lang={lang}
          filters={[{ key: "type", label: tx("प्रकार", "Type", lang), options: [...new Set(units.map((u) => u.type))].map((x) => ({ value: x, label: x })) }]}
          sortOptions={[{ value: "code", label: tx("कोड", "Code", lang) }]}
          onExport={() => exportCsv("units", ["Code", "Name", "Type", "Mode", "Works"], ctl.pageRows.map((u) => [u.code || u.id || "", u.nameEn, u.type, u.mode, liveWorks(u)]))} />
        <div className="mt-2">
        <Table cols={[tx("कोड", "Code", lang), tx("नाम", "Name", lang), tx("प्रकार", "Type", lang), tx("बजेट मोड", "Budget mode", lang), tx("कार्य", "Works", lang), tx("स्थिति", "Status", lang), ""]}
          rows={ctl.pageRows.map((u) => [u.code || u.id || "—", <Link key={u.id} href={`/org/${u.id}`} className="font-bold text-nepal-blue">{lang === "ne" ? u.nameNe : u.nameEn}</Link>, u.type, u.mode, liveWorks(u),
            isOff(u) ? <span key={u.id + "s"} className="font-bold text-slate-400">⛔ {tx("निष्क्रिय", "Deactivated", lang)}</span> : <span key={u.id + "s"} className="font-bold text-emerald-600">✅ {tx("सक्रिय", "Active", lang)}</span>,
            canManageUnits ? (<span key={u.id + "ops"} className="flex gap-2">{isOff(u)
              ? <button key={u.id + "a"} onClick={() => activate(u)} title={tx("सक्रिय गर्नुहोस्", "Activate", lang)} className="cursor-pointer text-xs font-bold text-emerald-600">✅ {tx("सक्रिय", "Activate", lang)}</button>
              : <button key={u.id + "d"} onClick={() => deactivate(u)} title={tx("निष्क्रिय गर्नुहोस्", "Deactivate", lang)} className="cursor-pointer text-xs font-bold text-red-600">⏸ {tx("निष्क्रिय", "Deactivate", lang)}</button>}
              {canDelete && <button key={u.id + "x"} onClick={() => removeUnit(u)} title={tx("स्थायी रूपमा मेट्नुहोस्", "Delete permanently", lang)} className="cursor-pointer text-xs font-bold text-red-700">🗑 {tx("मेट्नुहोस्", "Delete", lang)}</button>}</span>) : null])} />
        </div>
        <Pager ctl={ctl} lang={lang} />
        </>}
      </Card>
    </div>
  );
}
