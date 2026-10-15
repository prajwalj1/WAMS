"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, Stat } from "@/components/ui";
import { exportCsv } from "@/components/list";
import { useCollection, Loading } from "@/lib/use-data";
import { enrichWorks, delayedWorks, completedWorks, avgPhysical, avgExpected, utilisation, spentVerified, committedTotal, pendingApprovals, workingDaysBetween, verifiedSpentBySubhead } from "@/lib/metrics";
import { kathmanduDayKey } from "@/lib/progress";
import { useFiscalYears, normFy } from "@/lib/fiscal";
import { mutate } from "@/lib/mutate";

function procurementFy(p, workFyById) {
  const direct = normFy(p?.fy || p?.fiscalYear || p?.fiscalYearId);
  if (direct) return direct;
  return normFy(workFyById.get(p?.work) || "");
}

// Fallback definitions when the DB `reports` collection is empty — same
// shapes the detail page renders, so every link works out of the box.
// DB rows (when present) override these by code.
export const FALLBACK_REPORTS = [
  { code: "RPT-SUMMARY", en: "Management summary", ne: "व्यवस्थापन सारांश", filters: ["fy", "unit", "as-of"] },
  { code: "RPT-PROGRESS", en: "Progress", ne: "प्रगति", filters: ["fy", "unit"] },
  { code: "RPT-BUDGET", en: "Budget", ne: "बजेट", filters: ["fy", "unit"] },
  { code: "RPT-PROCUREMENT", en: "Procurement status", ne: "खरिद स्थिति", filters: ["fy", "unit", "method", "stage"] },
  { code: "RPT-DELAYED", en: "Delayed works", ne: "ढिला कार्य", filters: ["fy", "unit"] },
  { code: "RPT-UNIT", en: "Unit performance", ne: "एकाइ कार्यसम्पादन", filters: ["fy", "level"] },
  { code: "RPT-RESPONSIBILITY", en: "Responsibility", ne: "जिम्मेवारी", filters: ["fy", "unit"] },
  { code: "RPT-COMPLETION", en: "Completion", ne: "सम्पन्न", filters: ["fy", "unit", "date range"] },
  { code: "RPT-TIPPANI", en: "Tippani", ne: "टिप्पणी", filters: ["fy", "unit"] },
  { code: "RPT-TRIMESTER", en: "Trimester", ne: "चौमासिक", filters: ["fy", "trimester", "unit"] },
];
export const fallbackDef = (code) => FALLBACK_REPORTS.find((r) => r.code === code);

function previewRows(code, D, fyVal, flt = {}) {
  const { WORKS, BUDGET, PROCUREMENTS, TASKS, TIPPANIS, UNITS, TRIMESTER_TARGETS, EXPENDITURES, CONTRACTS } = D;
  const { unit, trimester, method, stage, level, dateFrom, dateTo, asOf } = flt;
  const today = asOf ? new Date(`${asOf}T00:00:00`) : new Date();
  const todayStr = asOf || kathmanduDayKey(today);
  const fy = fyVal === "__ALL__" ? "" : normFy(fyVal);
  const inFy = (v) => !fy || normFy(v) === fy;
  // Unit filter: record's own unit or any ancestor (covers descendant units).
  const inUnit = (rec) => !unit || (rec?.orgAncestors || []).includes(unit) || rec?.orgUnitId === unit;
  const worksU = (WORKS || []).filter(inUnit);
  const workIds = new Set(worksU.map((w) => w.id));
  const W = worksU;
  const BUD = (BUDGET || []).filter(inUnit);
  const PROCS = (PROCUREMENTS || []).filter((p) => inUnit(p) || workIds.has(p?.work));
  const TSK = (TASKS || []).filter((x) => workIds.has(x.workId));
  const TIPS = (TIPPANIS || []).filter((x) => (x.work && workIds.has(x.work)) || inUnit(x));
  const EXPS = (EXPENDITURES || []).filter((e) => workIds.has(e.work) && (!asOf || String(e.date || e.paidDate || "") <= asOf));
  const workFyById = new Map((W || []).map((w) => [w.id, w.fy]));
  const worksInFy = (W || []).filter((w) => inFy(w.fy));
  const enriched = enrichWorks(fy ? worksInFy : W, today);
  const latestTri = [...TRIMESTER_TARGETS].reverse().find((x) => x.actual != null) || [...TRIMESTER_TARGETS].pop();
  const triSel = trimester ? (TRIMESTER_TARGETS || []).find((x) => x.m === trimester) : null;
  const triLabel = triSel ? `${triSel.actual ?? "—"} vs ${triSel.target} (${triSel.m})` : latestTri ? `${latestTri.actual ?? "—"}% vs ${latestTri.target}%` : "—";
  const liveSpent = verifiedSpentBySubhead(EXPS, W);
  switch (code) {
    case "RPT-BUDGET":
      return { cols: ["Sub-head", "Allocated", "Revised", "Committed", "Spent", "Available", "Util %", "Tri target vs spent"],
        rows: BUD.filter((b) => inFy(b.fiscalYear)).map((b) => {
          const spent = liveSpent[b.subhead] ?? 0;
          return [b.subhead, b.allocated, b.revised, b.committed, spent, (Number(b.revised) || 0) - spent, `${Math.round(utilisation(spent, Number(b.revised) || 0))}%`, triLabel];
        }) };
    case "RPT-PROCUREMENT": {
      const procs = PROCS.filter((p) => inFy(procurementFy(p, workFyById)))
        .filter((p) => !method || p.method === method)
        .filter((p) => !stage || p.stage === stage);
      return { cols: ["Package", "Work", "Method", "Estimate", "Current stage", "Days in stage", "Bidder", "Contract"],
        rows: procs.map((p) => {
          // Live winner + contract (same join as /procurements list): the
          // frozen p.bidder / p.contract fields never update after
          // evaluation, so read selection + contracts instead. Matched by
          // package only — never another package's result via shared work.
          const contract = (CONTRACTS || []).find((c) => c.pkg === p.pkg || (!c.pkg && p.work && c.work === p.work));
          const bidder = contract?.contractor || p.selection?.bidder || p.bidder || "—";
          const contractAmt = contract ? Number(contract.amount) || 0 : Number(p.contract) || 0;
          return [p.pkg, p.work, p.method, p.estimate, p.stage, p.stageSince ? workingDaysBetween(p.stageSince, todayStr) : "—", bidder, contractAmt || "—"];
        }) };
    }
    case "RPT-DELAYED":
      return { cols: ["Work", "Unit", "Owner", "Deadline", "Days overdue", "Gap", "Delay reason", "Action"],
        rows: delayedWorks(enriched).map((w) => [w.id, w.unit, w.owner, w.deadline, w.deadline ? workingDaysBetween(w.deadline, todayStr) : "—", w.gap, w.delayReason || "—", w.status]) };
    case "RPT-UNIT":
      return { cols: ["Unit", "Works", "Completed %", "Avg physical", "Avg expected", "Delayed", "Spent %", "Update compliance"],
        rows: UNITS.filter((u) => u.type !== "PMO").filter((u) => !level || u.type === level).map((u) => {
          const ws = enriched.filter((w) => w.unit === u.nameEn || w.orgUnitId === u.id);
          const wsIds = new Set(ws.map((w) => w.id));
          const unitTasks = TSK.filter((x) => wsIds.has(x.workId));
          const doneTasks = unitTasks.filter((x) => x.status === "DONE").length;
          const done = ws.filter((w) => ["VERIFIED", "CLOSED"].includes(w.status)).length;
          const spent = ws.reduce((a, w) => a + (Number(w.spentPaisa) || 0), 0);
          const budgets = ws.reduce((a, w) => a + (Number(w.budgetPaisa) || 0), 0);
          if (!ws.length) return [u.code, 0, "—", "—", "—", 0, "—", "—"];
          return [u.code, ws.length, `${Math.round((done / ws.length) * 100)}%`, `${Math.round(avgPhysical(ws, false))}%`, `${Math.round(avgExpected(ws, false))}%`, delayedWorks(ws).length, `${Math.round(utilisation(spent, budgets))}%`, unitTasks.length ? `${Math.round((doneTasks / unitTasks.length) * 100)}%` : "—"];
        }) };
    case "RPT-RESPONSIBILITY": {
      const tasks = TSK.filter((x) => inFy(workFyById.get(x.workId)));
      return { cols: ["Task", "Work", "Owner", "Deadline", "Physical %", "Last update", "Overdue"],
        rows: tasks.map((x) => [x.ref, x.workId, x.owner, x.deadline, `${x.physical}%`, x.lastUpdate || "—", x.deadline && x.deadline < todayStr && !["DONE", "CANCELLED"].includes(x.status) ? "YES" : ""]) };
    }
    case "RPT-COMPLETION": {
      const done = completedWorks(enriched)
        .filter((w) => !dateFrom || String(w.deadline || "") >= dateFrom)
        .filter((w) => !dateTo || String(w.deadline || "") <= dateTo);
      return { cols: ["Work", "Output", "Completion vs deadline", "Final cost vs budget", "Verifier", "Closure"],
        rows: done.map((w) => [w.id, w.titleEn || w.titleNe, w.deadline, `${(w.spentPaisa || 0).toLocaleString("en-IN")} vs ${(w.budgetPaisa || 0).toLocaleString("en-IN")}`, w.verifier || w.owner || "—", w.status]) };
    }
    case "RPT-TIPPANI": {
      const tips = TIPS.filter((x) => !x.work || inFy(workFyById.get(x.work)));
      return { cols: ["Ref", "Subject", "Amount", "Drafter", "Current step", "Days at step", "Decision"],
        rows: tips.map((x) => [x.ref, x.subject, x.amount || "—", x.drafter || x.submitter || x.owner || "—", x.step, x.stepSince ? workingDaysBetween(x.stepSince, todayStr) : (Number(x.waitDays) || 0), x.status]) };
    }
    case "RPT-TRIMESTER":
      return { cols: ["Programme", "Annual target", `Trimester target${triSel ? ` (${triSel.m})` : ""}`, "Achievement (phy/fin)", "%", "Remarks"],
        rows: enriched.map((w) => [w.id, "100%", triSel ? `${triSel.target}` : `${Math.round(w.expected)}%`, `${Math.round(w.physical)}% / ${w.financialDisplay ?? "—"}`, `${Math.round(w.expected ? (w.physical / w.expected) * 100 : 0)}%`, w.health]) };
    case "RPT-PROGRESS":
    default:
      return { cols: ["Work", "Title", "Unit", "Budget", "Expected %", "Physical %", "Financial %", "Gap", "Health", "Status"],
        rows: enriched.map((w) => [w.id, w.titleEn, w.unit, w.budgetPaisa, `${Math.round(w.expected)}%`, `${Math.round(w.physical)}%`, w.financialDisplay ?? "—", w.gap, w.health, w.status]) };
  }
}

// One page: KPIs, top risks, top delayed, budget status, decisions needed.
function Summary({ lang, D, flt = {} }) {
  const { WORKS, BUDGET, TIPPANIS, DIRECTIVES, ISSUES, EXPENDITURES, REVISIONS, CONTRACTS } = D;
  const { unit, asOf } = flt;
  const inUnit = (rec) => !unit || (rec?.orgAncestors || []).includes(unit) || rec?.orgUnitId === unit;
  const WORKS_F = (WORKS || []).filter(inUnit);
  const workIds = new Set(WORKS_F.map((w) => w.id));
  const asOfDate = asOf ? new Date(`${asOf}T00:00:00`) : new Date();
  const enriched = enrichWorks(WORKS_F, asOfDate);
  const delayed = delayedWorks(enriched);
  const EXPS_F = (EXPENDITURES || []).filter((e) => workIds.has(e.work) && (!asOf || String(e.date || e.paidDate || "") <= asOf));
  const spent = spentVerified(EXPS_F);
  const revised = (BUDGET || []).filter(inUnit).reduce((a, b) => a + (Number(b.revised) || 0), 0);
  const committed = (CONTRACTS || []).filter(inUnit).filter((c) => c.status !== "CANCELLED").reduce((a, c) => a + (Number(c.amount ?? c.amountPaisa) || 0), 0) || committedTotal(BUDGET);
  const pend = pendingApprovals({ tippanis: (TIPPANIS || []).filter(inUnit), works: WORKS_F, revisions: (REVISIONS || []).filter(inUnit) });
  const asOfLabel = asOf ? ` · ${tx("यथास्थिति", "as of", lang)} ${asOf}` : "";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label={t("totalWorks", lang)} value={WORKS_F.length} />
        <Stat label={t("delayed", lang)} value={delayed.length} accent="border-nepal-crimson" />
        <Stat label={tx("औसत भौतिक", "Avg physical", lang)} value={`${Math.round(avgPhysical(enriched))}%`} />
        <Stat label={t("spentPct", lang)} value={`${Math.round(utilisation(spent, revised))}%`} accent="border-nepal-gold" />
        <Stat label={tx("प्रतिबद्ध", "Committed", lang)} value={(committed / 10000000).toFixed(1) + "cr"} />
        <Stat label={tx("बाँकी स्वीकृति", "Pending approvals", lang)} value={pend.total} accent="border-amber-500" />
      </div>
      {asOfLabel && <p className="text-[12px] font-bold text-slate-500">{asOfLabel}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("शीर्ष जोखिम", "Top risks", lang)}>
          {delayed.map((w) => <div key={w.id} className="border-b py-1 text-[13px] last:border-0"><b>{w.id}</b> · gap {w.gap} · {w.delayReason || tx("कारण छैन", "no reason", lang)}</div>)}
          <div className="py-1 text-[13px]">{tx("प्रमाणित खर्च", "Verified spend", lang)}: {spent.toLocaleString("en-IN")}</div>
        </Card>
        <Card title={tx("निर्णय आवश्यक (खुला निर्देशन + बाँकी)", "Decisions needed (directives + pending)", lang)}>
          {DIRECTIVES.filter((d) => d.status !== "CLOSED").map((d) => <div key={d.id} className="border-b py-1 text-[13px] last:border-0"><b>{d.id}</b> · {d.text} · {d.due}</div>)}
          {ISSUES.filter((x) => x.status !== "CLOSED").map((x) => <div key={x.id} className="py-1 text-[13px]"><b>{x.id}</b> · {x.text}</div>)}
        </Card>
      </div>
    </div>
  );
}

export default function ReportDetail({ params }) {
  const { lang, toast, user, role } = useApp();
  const { code } = use(params);
  // PMO (SUPER_ADMIN or pmo scope) sees every unit's rows in reports;
  // everyone else sees only their own subtree (same BR-03 rule as the
  // dashboard). Reports fetch big pages so the national view is complete,
  // not just the first 100 rows.
  const scopeIds = (role === "SUPER_ADMIN" || (user?.scopeUnitIds || []).includes("pmo"))
    ? null
    : (() => {
        const raw = user?.scopeUnitIds?.length ? user.scopeUnitIds : user?.unitId ? [user.unitId] : [];
        return raw.filter(Boolean);
      })();
  const inScope = (rec) => !scopeIds || (rec?.orgAncestors || []).some((a) => scopeIds.includes(a));
  const BIG = { pageSize: 2000 };
  const defs = useCollection("reports", BIG);
  const works = useCollection("works", BIG);
  const budget = useCollection("budget", BIG);
  const procs = useCollection("procurements", BIG);
  const tasks = useCollection("tasks", BIG);
  const tippanis = useCollection("tippanis", BIG);
  const dirs = useCollection("directives", BIG);
  const issues = useCollection("issues", BIG);
  const units = useCollection("units", BIG);
  const tri = useCollection("trimester", BIG);
  const exps = useCollection("expenditures", BIG);
  const revs = useCollection("budgetrevisions", BIG);
  const contractsQ = useCollection("contracts", BIG);
  const schedQ = useCollection("reportschedules", BIG);
  const qs = [defs, works, budget, procs, tasks, tippanis, dirs, issues, units, tri, exps, revs, contractsQ];
  const loading = qs.some((c) => c.loading && !(c.data || []).length);
  const error = qs.find((c) => c.error)?.error;
  const scopedWorks = (works.data || []).filter(inScope);
  const scopedWorkIds = new Set(scopedWorks.map((w) => w.id));
  const D = {
    WORKS: scopedWorks, BUDGET: (budget.data || []).filter(inScope), PROCUREMENTS: (procs.data || []).filter(inScope), TASKS: (tasks.data || []).filter(inScope),
    TIPPANIS: (tippanis.data || []).filter(inScope), DIRECTIVES: (dirs.data || []).filter(inScope), ISSUES: (issues.data || []).filter(inScope), UNITS: units.data || [],
    TRIMESTER_TARGETS: (tri.data || []).filter((r) => r.kind === "target"),
    // Expenditures carry no orgAncestors — scope via their parent work.
    EXPENDITURES: scopeIds ? (exps.data || []).filter((e) => scopedWorkIds.has(e.work)) : (exps.data || []),
    REVISIONS: (revs.data || []).filter(inScope), CONTRACTS: (contractsQ.data || []).filter(inScope),
  };
  const dbDef = (defs.data || []).find((r) => r.code === code);
  const def = dbDef || fallbackDef(code) || (defs.data || [])[0] || { code, ne: code, en: code, filters: ["fy"] };
  const hasFilter = (k) => (def.filters || []).includes(k);
  const fys = useFiscalYears(works.data || []);
  const [fy, setFy] = useState("");
  const showAll = fy === "__ALL__";
  const fyVal = showAll ? "__ALL__" : (fy || fys[0] || "—");
  const fyArg = fyVal;
  // Working filters (all dynamic — every control below filters live data):
  // unit (subtree via orgAncestors), trimester (target month), method, stage,
  // level (unit type), date range (deadline from→to), as-of (recompute at date).
  const [unitF, setUnitF] = useState("");
  const [triF, setTriF] = useState("");
  const [methodF, setMethodF] = useState("");
  const [stageF, setStageF] = useState("");
  const [levelF, setLevelF] = useState("");
  const [fromF, setFromF] = useState("");
  const [toF, setToF] = useState("");
  const [asOfF, setAsOfF] = useState("");
  const flt = { unit: unitF, trimester: triF, method: methodF, stage: stageF, level: levelF, dateFrom: fromF, dateTo: toF, asOf: asOfF };
  const methodOpts = [...new Set([...(procs.data || []).map((p) => p.method).filter(Boolean), "NCB", "Sealed Quotation", "Direct Purchase", "Framework"])];
  const stageOpts = [...new Set((procs.data || []).map((p) => p.stage).filter(Boolean))];
  const levelOpts = [...new Set((units.data || []).map((u) => u.type).filter(Boolean))];
  const triOpts = (tri.data || []).filter((r) => r.kind === "target").map((r) => r.m).filter(Boolean);
  // Persisted schedule (DB-backed): one active doc per report+FY.
  const schedules = schedQ.data || [];
  const activeSched = schedules.find((s) => s.code === def.code && normFy(s.fy) === normFy(fyVal) && s.status === "SCHEDULED");
  const scheduled = !!activeSched;
  const [saving, setSaving] = useState(false);
  const toggleSchedule = async () => {
    if (saving || showAll) return;
    setSaving(true);
    try {
      if (activeSched) {
        await mutate("/api/data/reportschedules", { method: "PATCH",
          body: { match: { _id: activeSched._id }, update: { status: "CANCELLED" }, __v: activeSched.__v ?? 1 },
          okMsg: tx("तालिका हटाइयो", "Schedule removed", lang), toast, reload: schedQ.reload });
      } else {
        // Unique index is (code, fy): reactivate a cancelled row if present.
        const prior = schedules.find((s) => s.code === def.code && normFy(s.fy) === normFy(fyVal));
        if (prior) {
          await mutate("/api/data/reportschedules", { method: "PATCH",
            body: { match: { _id: prior._id }, update: { status: "SCHEDULED", fyLabel: fyVal, scheduledAt: kathmanduDayKey(new Date()), createdBy: user?.username || "" }, __v: prior.__v ?? 1 },
            okMsg: tx("रिपोर्ट तालिकाबद्ध", "Report scheduled", lang), toast, reload: schedQ.reload });
        } else {
          await mutate("/api/data/reportschedules", { method: "POST",
            body: { doc: { code: def.code, fy: normFy(fyVal), fyLabel: fyVal, status: "SCHEDULED",
              scheduledAt: kathmanduDayKey(new Date()), createdBy: user?.username || "",
              orgUnitId: user?.unitId || "", orgAncestors: user?.scopeUnitIds || [], orgPath: (user?.scopeUnitIds || []).join(".") } },
            okMsg: tx("रिपोर्ट तालिकाबद्ध", "Report scheduled", lang), toast, reload: schedQ.reload });
        }
      }
    } finally {
      setSaving(false);
    }
  };
  const { cols, rows } = previewRows(def.code, D, fyArg, flt);
  return (
    <div className="space-y-3">
      <Link href="/reports" className="text-xs font-bold text-nepal-blue">← {tx("प्रतिवेदन", "Reports", lang)}</Link>
      <h1 className="text-xl font-black">{def.code} · {lang === "ne" ? def.ne : def.en}</h1>
      <Card title={tx("फिल्टर · प्रिभ्यु · PDF/Excel · तालिका", "Filters · preview · PDF/Excel · schedule", lang)}
        action={<div className="no-print flex gap-2">
          <button onClick={() => window.print()} className="rounded-lg border px-3 py-1.5 text-xs font-bold">PDF 🖨</button>
          {def.code !== "RPT-SUMMARY" && <button onClick={() => exportCsv(def.code, cols, rows)} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">Excel ⬇</button>}
        </div>}>
        <div className="no-print mb-2 flex flex-wrap gap-2 text-xs font-bold">
          <select value={fy} onChange={(e) => setFy(e.target.value)} className="rounded-lg border px-2 py-1.5">
            {!fy && fys[0] ? <option value="">{fys[0]}</option> : null}
            {fys.filter((f) => f !== fys[0] || fy).map((f) => <option key={f} value={f}>{f}</option>)}
            <option value="__ALL__">{tx("सबै आ.व.", "All FYs", lang)}</option>
          </select>
          {hasFilter("unit") && (
            <select value={unitF} onChange={(e) => setUnitF(e.target.value)} title={tx("एकाइ", "Unit", lang)} className="rounded-lg border px-2 py-1.5">
              <option value="">{tx("सबै एकाइ", "All units", lang)}</option>
              {(units.data || []).map((u) => <option key={u.id ?? u._id} value={u.id ?? u._id}>{u.nameEn || u.code} ({u.code})</option>)}
            </select>
          )}
          {hasFilter("trimester") && (
            <select value={triF} onChange={(e) => setTriF(e.target.value)} title={tx("चौमासिक", "Trimester", lang)} className="rounded-lg border px-2 py-1.5">
              <option value="">{tx("पछिल्लो लक्ष्य", "Latest target", lang)}</option>
              {triOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {hasFilter("method") && (
            <select value={methodF} onChange={(e) => setMethodF(e.target.value)} title={tx("विधि", "Method", lang)} className="rounded-lg border px-2 py-1.5">
              <option value="">{tx("सबै विधि", "All methods", lang)}</option>
              {methodOpts.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {hasFilter("stage") && (
            <select value={stageF} onChange={(e) => setStageF(e.target.value)} title={tx("चरण", "Stage", lang)} className="rounded-lg border px-2 py-1.5">
              <option value="">{tx("सबै चरण", "All stages", lang)}</option>
              {stageOpts.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {hasFilter("level") && (
            <select value={levelF} onChange={(e) => setLevelF(e.target.value)} title={tx("तह", "Level", lang)} className="rounded-lg border px-2 py-1.5">
              <option value="">{tx("सबै तह", "All levels", lang)}</option>
              {levelOpts.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {hasFilter("date range") && (
            <>
              <input type="date" value={fromF} onChange={(e) => setFromF(e.target.value)} title={tx("देखि", "From", lang)} className="rounded-lg border px-2 py-1.5 font-normal" />
              <input type="date" value={toF} onChange={(e) => setToF(e.target.value)} title={tx("सम्म", "To", lang)} className="rounded-lg border px-2 py-1.5 font-normal" />
            </>
          )}
          {hasFilter("as-of") && (
            <input type="date" value={asOfF} onChange={(e) => setAsOfF(e.target.value)} title={tx("यथास्थिति मिति — त्यस दिनको गणना", "As-of date — recompute at that day", lang)} className="rounded-lg border px-2 py-1.5 font-normal" />
          )}
          {(def.filters || []).filter((x) => !["fy", "unit", "trimester", "method", "stage", "level", "date range", "as-of"].includes(x)).map((x) => <span key={x} className="rounded-lg bg-slate-100 px-2 py-1.5 text-slate-500">{x}</span>)}
          <button onClick={toggleSchedule} disabled={saving || schedQ.loading || showAll} title={showAll ? tx("विशिष्ट आ.व. छान्नुहोस्", "Pick a specific FY to schedule", lang) : ""} className={`rounded-lg border px-3 py-1.5 ${scheduled ? "bg-emerald-100 text-emerald-800" : ""} ${showAll ? "opacity-50" : ""}`}>
            {scheduled ? `✅ ${tx("तालिकाबद्ध", "Scheduled", lang)}` : tx("तालिका बनाउनुहोस्", "Schedule", lang)}
          </button>
        </div>
        <p className="mb-2 text-[11px] text-slate-400">
          FY {showAll ? tx("सबै", "All", lang) : fyVal}{unitF ? ` · ${(units.data || []).find((u) => (u.id ?? u._id) === unitF)?.nameEn || unitF}` : ""}{methodF ? ` · ${methodF}` : ""}{stageF ? ` · ${stageF}` : ""}{levelF ? ` · ${levelF}` : ""}{triF ? ` · ${triF}` : ""}{(fromF || toF) ? ` · ${fromF || "…"}→${toF || "…"}` : ""}{asOfF ? ` · as-of ${asOfF}` : ""} · {tx("लाइभ डेटा", "live data", lang)}
          {activeSched ? ` · ✅ ${tx("तालिकाबद्ध", "Scheduled", lang)}${activeSched.createdBy ? ` ${activeSched.createdBy}` : ""}${activeSched.scheduledAt ? ` · ${activeSched.scheduledAt}` : ""}` : ""}
          {schedQ.error ? ` · ⚠ ${schedQ.error}` : ""}
        </p>
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : (def.code === "RPT-SUMMARY" ? <Summary lang={lang} D={D} flt={flt} /> : <Table cols={cols} rows={rows} />)}
      </Card>
    </div>
  );
}
