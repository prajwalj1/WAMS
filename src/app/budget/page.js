"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/lib/store";

import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip, TrendChart } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import TransitionBox from "@/components/transitions";
import { verifiedSpentBySubhead } from "@/lib/metrics";
import { mutate } from "@/lib/mutate";
import { useFiscalYears } from "@/lib/fiscal";
import { ancestorsOfUnit } from "@/lib/scope";
import { useProcurementRole } from "@/lib/procurement";

// Monthly spending targets (lakh) for the dashboard trend's gold line.
// Stored in the `trimester` collection as { m: "YYYY-MM", target, kind: "target" }.
// Ministry/finance only (budget.manage) — enforced server-side too.
function MonthlyTargets({ lang, canEdit }) {
  const { toast } = useApp();
  const tri = useCollection("trimester");
  const rows = [...(tri.data || []).filter((r) => r.kind === "target")].sort((a, b) => (a.m < b.m ? -1 : 1));
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const m = String(month || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(m)) { toast("MONTH_FORMAT_YYYY-MM", "err"); return; }
    const num = Number(val);
    if (!Number.isFinite(num) || num < 0) { toast("AMOUNT_POSITIVE", "err"); return; }
    setSaving(true);
    try {
      const ex = rows.find((r) => r.m === m);
      if (ex) {
        await mutate("/api/data/trimester", { method: "PATCH",
          body: { match: { _id: ex._id }, update: { target: num }, __v: ex.__v ?? 1 },
          okMsg: `${m} → ${num} lakh`, toast, reload: tri.reload });
      } else {
        await mutate("/api/data/trimester", { method: "POST",
          body: { doc: { m, target: num, kind: "target" } },
          okMsg: `${m} → ${num} lakh`, toast, reload: tri.reload });
      }
      setVal("");
    } finally { setSaving(false); }
  };
  return (
    <Card title={tx("मासिक खर्च लक्ष्य (लाख) — ड्यासबोर्ड ट्रेन्ड", "Monthly spending targets (lakh) — dashboard trend", lang)}
      action={canEdit ? <span className="text-[11px] text-slate-400">{tx("सुनौलो रेखा", "gold line", lang)}</span> : null}>
      {tri.loading ? <Loading lang={lang} /> : (
        <>
          {rows.length > 0 && <div className="mb-2"><TrendChart series={rows.map((r) => ({ m: r.m, spent: 0, target: Number(r.target) || 0 }))} lang={lang} /></div>}
          <Table cols={["YYYY-MM", tx("लक्ष्य (लाख)", "Target (lakh)", lang)]}
            rows={rows.map((r) => [r.m, String(r.target ?? "—")])} />
          {rows.length === 0 && <p className="mt-1 text-[12px] text-slate-400">{tx("अहिलेसम्म लक्ष्य छैन — तल थप्नुहोस्।", "No targets yet — add one below.", lang)}</p>}
        </>
      )}
      {canEdit ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
          <label className="text-xs font-bold text-slate-600">{tx("महिना", "Month", lang)}<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="mt-1 block rounded-lg border px-2 py-1.5 font-normal" /></label>
          <label className="text-xs font-bold text-slate-600">{tx("लक्ष्य (लाख)", "Target (lakh)", lang)}<input type="number" min={0} step={0.1} value={val} onChange={(e) => setVal(e.target.value)} placeholder="25.5" className="mt-1 block w-32 rounded-lg border px-2 py-1.5 font-normal" /></label>
          <button onClick={save} disabled={saving} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{saving ? "…" : t("add", lang)}</button>
          {tri.error && <span className="font-mono text-xs font-bold text-red-600">{tri.error}</span>}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-slate-400">{tx("लक्ष्य मन्त्रालय/वित्तले सेट गर्छ (budget.manage)।", "Targets are set by ministry/finance (budget.manage).", lang)}</p>
      )}
    </Card>
  );
}

export default function Budget() {
  const { lang, perms, toast, user, role } = useApp();
  // Budget LINES are made by the finance officer ONLY (role-gated,
  // enforced server-side as well). Ministry and everyone else get the
  // read-only table. Monthly targets stay ministry/finance (budget.manage).
  const canManageBudget = (perms || []).includes("*") || (perms || []).includes("budget.manage");
  const canEditLines = role === "FINANCE_OFFICER";
  // Expenditure approval lives with the SECTION (verify/return) and the
  // DEPARTMENT (payment approval) — same rule as /expenditures; ministers
  // cannot decide here. Reversal and payment stay with finance there.
  const canDecideExp = role === "SECTION_HEAD" || (perms || []).includes("*");
  const { isDeptApprover: canApproveExpDept } = useProcurementRole(role, user);
  const canApproveExp = canApproveExpDept || (perms || []).includes("*");
  const boxAllowExp = canApproveExp ? ["submit", "approve"] : canDecideExp ? ["verify", "return"] : null;
  const [showAdd, setShowAdd] = useState(false);
  const [subhead, setSubhead] = useState("");
  const [lineName, setLineName] = useState("");
  const [allocated, setAllocated] = useState("");
  const [fiscalYear, setFiscalYear] = useState("");
  const [fundingSource, setFundingSource] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const budget = useCollection("budget");
  const exps = useCollection("expenditures");
  const revs = useCollection("budgetrevisions");
  const worksQ = useCollection("works");
  const unitsQ = useCollection("units");
  const BUDGET = budget.data;
  const fys = useFiscalYears(BUDGET.map((b) => ({ fy: b.fiscalYear })).filter((x) => x.fy));
  // Spent is derived live from verified expenditures — never the stored snapshot.
  const liveSpent = verifiedSpentBySubhead(exps.data, worksQ.data);
  const spentOf = (b) => liveSpent[b.subhead] ?? 0;
  const loading = budget.loading || exps.loading || revs.loading || worksQ.loading;
  const error = budget.error || exps.error || revs.error || worksQ.error;
  const rev = revs.data[0];
  const setExpStatus = async (voucher, next, cur, note = "") => {
    const clean = String(note || "").trim();
    const update = { status: next };
    if (clean && next === "SUBMITTED") update.submitNote = clean;
    if (clean && ["VERIFIED", "APPROVED", "RETURNED", "REVERSED"].includes(next)) {
      update.decisionNote = clean;
      update.decidedBy = user?.username || "";
    }
    await mutate("/api/data/expenditures", { method: "PATCH",
      body: { match: { voucher }, update, __v: cur?.__v ?? 1 },
      okMsg: `${voucher} → ${next}`,
      toast, reload: exps.reload });
  };
  const setRevStatus = async (next, cur) => {
    const action = next === "APPROVED" ? "approve" : next === "REJECTED" ? "reject" : null;
    if (!action) {
      await mutate("/api/data/budgetrevisions", { method: "PATCH",
        body: { match: { id: cur.id }, update: { status: next }, __v: cur?.__v ?? 1 },
        okMsg: `${cur.id} → ${next}`,
        toast, reload: revs.reload });
      return;
    }
    const res = await mutate(`/api/budget/revisions/${cur.id}/transition`, { method: "POST",
      body: { action, actor: user?.username || "", scopeUnitIds: user?.scopeUnitIds, __v: cur?.__v ?? 1 },
      toast });
    if (!res.ok) return;
    toast(`${cur.id} → ${res.status}${action === "approve" ? ` · ${tx("रकमान्तर लागू", "Transfer applied", lang)}` : ""}`);
    revs.reload();
    budget.reload();
  };
  // New budget line: allocated = revised, nothing committed/spent yet.
  // The sub-head created here is what /works/new offers in its Sub-head step.
  const addLine = async () => {
    setAddMsg("");
    const sh = subhead.trim();
    if (!sh) { setAddMsg(tx("ब.उ.शी.नं. आवश्यक", "Sub-head required", lang)); return; }
    if (BUDGET.some((b) => String(b.subhead).toUpperCase() === sh.toUpperCase())) { setAddMsg("SUBHEAD_TAKEN"); return; }
    const amt = Number(allocated) || 0;
    if (amt < 0) { setAddMsg("AMOUNT_POSITIVE"); return; }
    // Stamp the creator's unit chain so scoped dashboards keep the line.
    const chain = ancestorsOfUnit(user?.unitId, unitsQ.data || []);
    const saved = await mutate("/api/data/budget", { method: "POST",
      body: { doc: { subhead: sh, name: lineName.trim() || sh, fiscalYear: fiscalYear || fys[0] || "", fundingSource: fundingSource.trim() || "GoN", allocated: amt, revised: amt, committed: 0, spent: 0, orgUnitId: user?.unitId || "", orgAncestors: chain, orgPath: chain.join(".") } },
      okMsg: `${sh} · ${tx("बजेट लाइन थपियो", "Budget line added", lang)}`,
      toast, reload: budget.reload });
    if (!saved.ok) { setAddMsg(saved.code || "CREATE_FAILED"); return; }
    setSubhead(""); setLineName(""); setAllocated(""); setFiscalYear(""); setFundingSource(""); setShowAdd(false);
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{t("budgetTitle", lang)}</h1>
      <Card title={tx("आ.व. + ब.उ.शी.नं. अनुसार लाइन: विनियोजित · संशोधित · प्रतिबद्ध · खर्च · बाँकी", "Lines by FY + sub-head: allocated · revised · committed · spent · available", lang)} action={<div className="flex gap-2"><Link href="/budget/revisions" className="rounded-lg border px-3 py-1.5 text-xs font-bold">{tx("संशोधन", "Revisions", lang)}</Link><Link href="/expenditures" className="rounded-lg border px-3 py-1.5 text-xs font-bold">{tx("खर्च", "Expenditures", lang)}</Link>{canEditLines && <button onClick={() => setShowAdd((s) => !s)} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">+ {tx("बजेट लाइन", "Budget line", lang)}</button>}</div>}>
        {showAdd && canEditLines && (
          <div className="mb-2 grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-5">
            <label className="text-xs font-bold text-slate-600">{tx("ब.उ.शी.नं.", "Sub-head", lang)}<input value={subhead} onChange={(e) => setSubhead(e.target.value)} placeholder="30201" className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" /></label>
            <label className="text-xs font-bold text-slate-600">{tx("नाम", "Name", lang)}<input value={lineName} onChange={(e) => setLineName(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" /></label>
            <label className="text-xs font-bold text-slate-600">{tx("विनियोजित (NPR)", "Allocated (NPR)", lang)}<input type="number" min={0} value={allocated} onChange={(e) => setAllocated(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" /></label>
            <label className="text-xs font-bold text-slate-600">{tx("आ.व.", "FY", lang)}<select value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal"><option value="">—</option>{fys.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
            <label className="text-xs font-bold text-slate-600">{tx("स्रोत", "Funding source", lang)}<input value={fundingSource} onChange={(e) => setFundingSource(e.target.value)} placeholder="GoN" className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" /></label>
            <div className="flex items-end gap-2 sm:col-span-5"><button onClick={addLine} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">{t("add", lang)}</button>{addMsg && <span className="font-mono text-xs font-bold">{addMsg}</span>}</div>
          </div>
        )}
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : (
        <Table cols={[tx("ब.उ.शी.नं.", "Sub-head", lang), tx("नाम", "Name", lang), tx("आ.व.", "FY", lang), tx("स्रोत", "Source", lang), tx("विनियोजित", "Allocated", lang), tx("संशोधित", "Revised", lang), tx("प्रतिबद्ध", "Committed", lang), tx("खर्च", "Spent", lang), tx("बाँकी", "Available", lang)]} rows={BUDGET.map((b) => [<Link key={b.subhead} href={`/budget/lines/${b.subhead}`} className="font-mono font-bold text-nepal-blue">{b.subhead}</Link>, b.name, b.fiscalYear || "—", b.fundingSource || "—", (Number(b.allocated) || 0).toLocaleString("en-IN"), (Number(b.revised) || 0).toLocaleString("en-IN"), (Number(b.committed) || 0).toLocaleString("en-IN"), spentOf(b).toLocaleString("en-IN"), ((Number(b.revised) || 0) - spentOf(b)).toLocaleString("en-IN")])} />
        )}
      </Card>
      <MonthlyTargets lang={lang} canEdit={canManageBudget} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("खर्च — ड्राफ्ट → पेश → प्रमाणित", "Expenditures — draft → submitted → verified", lang)}>
          <Table cols={[tx("भौचर", "Voucher", lang), tx("कार्य", "Work", lang), tx("भुक्तानी", "Payee", lang), tx("खुद", "Net", lang), tx("स्थिति", "Status", lang), tx("टिप्पणी", "Notes", lang), tx("कार्य", "Action", lang)]}
            rows={exps.data.map((v) => [v.voucher, v.work, v.payee, Number(v.net).toLocaleString("en-IN"), <StatusChip key={v.voucher} status={v.status} lang={lang} />,
              <span key={v.voucher + "n"} className="block max-w-44 whitespace-normal text-[11px] text-slate-600">
                {v.submitNote ? <span className="block">📤 {v.submitNote}</span> : null}
                {v.decisionNote ? <span className="block font-semibold text-slate-800">✅ {v.decidedBy ? `${v.decidedBy}: ` : ""}{v.decisionNote}</span> : null}
                {!v.submitNote && !v.decisionNote ? "—" : null}
              </span>,
              canDecideExp || canApproveExp ? <div key={v.voucher + "a"} className="max-w-56"><TransitionBox recordType="expenditure" status={v.status} lang={lang} allow={boxAllowExp} onStatus={(next, _r, note) => setExpStatus(v.voucher, next, v, note)} /></div> : <span key={v.voucher + "a"} className="text-xs text-slate-400">—</span>])} />
        </Card>
        <Card title={tx("संशोधन", "Revisions", lang)} action={<Link href="/budget/revisions" className="text-xs font-bold text-nepal-blue">{tx("सबै", "All", lang)} →</Link>}>
          {rev ? (<>
          <div className="mt-2 flex items-center gap-2 text-xs"><span className="text-slate-500">{rev.id}</span><StatusChip status={rev.status} lang={lang} /></div>
          {["MINISTRY_ADMIN", "APPROVER"].includes(role)
            ? <div className="mt-2"><TransitionBox recordType="budgetRevision" status={rev.status} lang={lang} onStatus={(next) => setRevStatus(next, rev)} /></div>
            : <p className="mt-2 text-[12px] text-slate-400">{tx("निर्णय मन्त्रालय स्तरमा हुन्छ।", "Decisions are made at ministry level.", lang)}</p>}
          </>) : <p className="text-[13px] text-slate-400">—</p>}
        </Card>
      </div>
    </div>
  );
}
