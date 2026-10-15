"use client";
import { useState } from "react";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import { IMPORT_SPECS, templateHeader, parseCsv, validateImportRows, canRollback } from "@/lib/import-specs";
import { useCollection, Loading } from "@/lib/use-data";
import { errMsg } from "@/lib/errors";
import { kathmanduDayKey } from "@/lib/progress";
import { mutate } from "@/lib/mutate";

const KEYS = Object.keys(IMPORT_SPECS);

// Template example row is assembled live from existing records so the sample
// always shows real codes from this database — never fixed demo IDs.
function sampleRow(key, ctx = {}) {
  const unit = ctx.units?.[0]?.code || "";
  const user = ctx.users?.[0]?.username || "";
  const work = ctx.works?.[0]?.id || "";
  const subhead = ctx.subheads?.[0] || "";
  const fy = ctx.works?.[0]?.fy || "";
  const samples = {
    units: { parent_code: unit, type: "SECTION", code: `${unit}-NEW`, name_ne: "नयाँ शाखा", name_en: "New Section", short_name: "NS", budget_mode: "MINISTRY", phone: "", email: "", address: "" },
    users: { username: "new.staff", name_ne: "नयाँ कर्मचारी", name_en: "New Staff", employee_code: "", position: "", level: "", unit_code: unit, mobile: "", email: "", role_code: "STAFF", scope_unit_code: unit },
    budget_lines: { fiscal_year: fy, unit_code: unit, budget_subhead_no: "", subhead_name: "Sample", expense_head: "", source: "", nature: "", allocated: "", t1_target: "", t2_target: "", t3_target: "" },
    works: { fiscal_year: fy, unit_code: unit, title_ne: "नमुना कार्य", title_en: "Sample work", work_type: "", start_date: "", deadline: "", priority: "", payment_mode: "STAGED", progress_method: "WEIGHTED_TASKS", owner_username: user, budget_subhead_no: subhead, budget_amount: "", expected_output: "" },
    tasks: { work_code: work, parent_task_ref: "", task_ref: "T9", title: "Sample task", owner_username: user, start_date: "", deadline: "", weight: "10", planned_qty: "", uom: "" },
    expenditures: { fiscal_year: fy, work_code: work, budget_subhead_no: subhead, voucher_no: "", bill_no: "", bill_date: "", paid_date: "", payee: "", gross: "", tds: "", retention: "", net: "", contract_no: "", milestone_no: "" },
  };
  const spec = IMPORT_SPECS[key];
  const s = samples[key] || {};
  return spec.columns.map((c) => s[c.key] ?? "").join(",");
}

export default function Imports() {
  const { lang, toast } = useApp();
  const [tab, setTab] = useState("tasks");
  const [preview, setPreview] = useState([]);
  const batchesQ = useCollection("importbatches");
  const batches = batchesQ.data;
  const [msg, setMsg] = useState("");
  const units = useCollection("units");
  const users = useCollection("users");
  const works = useCollection("works");
  const budget = useCollection("budget");
  const ctx = { units: units.data, users: users.data, works: works.data, subheads: budget.data.map((b) => b.subhead) };

  const dl = (key) => {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + templateHeader(key) + "\n" + sampleRow(key, ctx) + "\n"], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = IMPORT_SPECS[key].file.replace(".xlsx", ".csv"); a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (file) => {
    setMsg("");
    const text = await file.text();
    const rows = parseCsv(text);
    const checked = validateImportRows(tab, rows, ctx);
    // Server re-checks every row too (client + server validation).
    try {
      const res = await fetch("/api/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ form: "import-commit", payload: { template: tab, rows } }) }).then((r) => r.json());
      if (!res.ok && res.errors?.length) setMsg(`${tx("सर्भरले अस्वीकार गर्यो", "Server rejected", lang)}: ${res.errors[0].code}`);
    } catch {}
    setPreview(checked);
  };

  const commit = async () => {
    const good = preview.filter((p) => p.valid);
    if (!good.length) { setMsg(tx("मान्य पङ्क्ति छैन", "No valid rows", lang)); return; }
    const todayStr = kathmanduDayKey(new Date());
    const maxSeq = batches.reduce((a, b) => {
      const m = String(b.id || "").match(/^IMP-(\d+)-(\d+)$/);
      return m ? Math.max(a, Number(m[2])) : a;
    }, 99);
    const id = `IMP-${todayStr.slice(0, 4)}-${String(maxSeq + 1).padStart(3, "0")}`;
    const committed = await mutate("/api/data/importbatches", { method: "POST",
      body: { doc: { id, file: IMPORT_SPECS[tab].file, at: todayStr, rows: preview.length, bad: preview.length - good.length, status: "COMMITTED", committedAt: todayStr,
        dependents: [], note: tab === "expenditures" ? "SUBMITTED — finance must verify" : "" } },
      okMsg: `${id} · ${good.length} ${tx("पङ्क्ति कमिट", "rows committed", lang)}`,
      toast });
    if (!committed.ok) { setMsg(`❌ ${committed.code || "COMMIT_FAILED"}`); return; }
    batchesQ.reload();
    setPreview([]);
    setMsg(`✅ ${id} · ${good.length} ${tx("पङ्क्ति कमिट", "rows committed", lang)}${tab === "expenditures" ? ` · ${tx("SUBMITTED — finance प्रमाणित आवश्यक", "SUBMITTED — finance must verify", lang)}` : ""}`);
  };

  const rollback = async (batch) => {
    const chk = canRollback(batch, kathmanduDayKey(new Date()));
    if (!chk.ok) { setMsg(`❌ ${chk.code}${chk.dependents ? ` (${chk.dependents.length})` : ""} — ${errMsg(chk.code, lang)}`); return; }
    await mutate("/api/data/importbatches", { method: "PATCH",
      body: { match: { id: batch.id }, update: { status: "ROLLED_BACK", archivedAt: new Date().toISOString() }, __v: batch.__v ?? 1 },
      okMsg: `${batch.id} · ${tx("रोलब्याक भयो", "rolled back", lang)}`,
      toast, reload: batchesQ.reload });
    setMsg(`✅ ${batch.id} ${tx("रोलब्याक भयो", "rolled back", lang)}`);
  };

  const bad = preview.filter((p) => !p.valid).length;
  return (<div className="space-y-3"><h1 className="text-xl font-black">{t("importsTitle", lang)}</h1>
  <div className="no-print flex flex-wrap gap-1.5 text-[11px] font-bold">
    {KEYS.map((k) => <button key={k} onClick={() => { setTab(k); setPreview([]); }} className={`rounded-full border px-2.5 py-1 ${tab === k ? "bg-nepal-blue text-white" : "bg-white text-slate-600"}`}>{IMPORT_SPECS[k].file}</button>)}
  </div>
  <Card title={tx("टेम्प्लेट → अपलोड → पङ्क्तिगत त्रुटि → कमिट → ७ दिन रोलब्याक", "Template → upload → row errors → commit → 7d rollback", lang)}
    action={<div className="no-print flex gap-2">
      <button onClick={() => dl(tab)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">⬇ {tx("टेम्प्लेट", "Template", lang)}</button>
      <label className="cursor-pointer rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">{tx("अपलोड", "Upload", lang)}<input type="file" accept=".csv,.xlsx,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
    </div>}>
    <p className="mb-1 text-[12px] text-slate-500">{IMPORT_SPECS[tab].columns.map((c) => c.key + (c.required ? "*" : "")).join(" · ")}</p>
    <p className="mb-2 text-[12px] text-slate-500">{tx("मिति BS (YYYY-MM-DD) · रकम NPR (कमाविना)", "Dates BS (YYYY-MM-DD) · amounts NPR (no commas)", lang)}</p>
    {preview.length > 0 && (
      <div>
        <div className="mb-1 flex items-center gap-2 text-xs font-bold">
          <span>{preview.length - bad} ✅ · {bad} ❌</span>
          <button onClick={commit} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-white">{tx("मान्य पङ्क्ति कमिट", "Commit valid rows", lang)}</button>
        </div>
        <Table cols={["#", tx("त्रुटि", "Errors", lang)]} rows={preview.filter((p) => !p.valid).slice(0, 25).map((p) => [p.row, p.errors.map((e) => `${e.col}: ${e.code}`).join("; ")])} />
        {bad > 25 && <p className="text-xs text-slate-400">…+{bad - 25}</p>}
      </div>
    )}
    {msg && <p className="mt-1 font-mono text-xs font-bold">{msg}</p>}
  </Card>
  <Card title={tx("इतिहास + रोलब्याक (७ दिन, निर्भरता छैन भने)", "History + rollback (7 days, if no dependents)", lang)}>
    {batchesQ.loading ? <Loading lang={lang} /> : batchesQ.error ? <Loading error={batchesQ.error} lang={lang} /> : (
    <Table cols={[tx("आईडी", "ID", lang), tx("फाइल", "File", lang), tx("मिति", "At", lang), tx("पङ्क्ति", "Rows", lang), tx("स्थिति", "Status", lang), ""]}
      rows={batches.map((r) => [r.id, `${r.file}${r.note ? ` (${r.note})` : ""}`, r.at, `${r.rows} (${r.bad} bad)`, <StatusChip key={r.id} status={r.status === "COMMITTED" ? "DONE" : r.status} lang={lang} />,
        r.status === "COMMITTED" ? <button key={r.id + "r"} onClick={() => rollback(r)} className="text-xs font-bold text-red-600">{tx("रोलब्याक", "Rollback", lang)}</button> : <span key={r.id + "r"} className="text-xs text-slate-400">—</span>])} />
    )}
  </Card></div>);
}
