"use client";
import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useApp, useWorkflow } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table, HealthChip, Bars, StatusChip, RoutePreview, HistoryTimeline, DocPreview } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import { workHealth, fmtMoney, kathmanduDayKey, daysBetween, THRESHOLDS } from "@/lib/progress";
import { listWorkActions, applyTransition, matchApprovalRoute, actionLabel } from "@/lib/lifecycle";
import { mutate } from "@/lib/mutate";

export default function WorkDetail({ params }) {
  const { lang, role, perms, toast } = useApp();
  // Works are determined by the industry side only — status transitions need
  // work.create or tippani.act. Monitor-only roles (PMO Super Admin,
  // Auditor, Viewer…) get the read-only detail view; the API refuses their
  // PATCHes regardless.
  const canActOnWork = (perms || []).includes("*") || (perms || []).includes("work.create") || (perms || []).includes("tippani.act");
  const { routes } = useWorkflow();
  const { id } = use(params);
  const works = useCollection("works");
  const tasksQ = useCollection("tasks");
  const docsQ = useCollection("docs");
  const budgetQ = useCollection("budget");
  const unitsQ = useCollection("units");
  const tippanisQ = useCollection("tippanis");
  const procsQ = useCollection("procurements");
  const contractsQ = useCollection("contracts");
  const expsQ = useCollection("expenditures");
  const WORKS = works.data, TASKS = tasksQ.data, BUDGET = budgetQ.data;
  const UNITS = unitsQ.data, TIPPANIS = tippanisQ.data, PROCS = procsQ.data;
  const loading = works.loading || tasksQ.loading || docsQ.loading || budgetQ.loading || unitsQ.loading || tippanisQ.loading || procsQ.loading || contractsQ.loading || expsQ.loading;
  const error = works.error || tasksQ.error || docsQ.error || budgetQ.error || unitsQ.error || tippanisQ.error || procsQ.error || contractsQ.error || expsQ.error;
  const w = WORKS.find((x) => x.id === id);
  const [status, setStatus] = useState(null);
  const cur = status ?? w?.status;
  const [history, setHistory] = useState([]);
  const [audits, setAudits] = useState([]);
  const [reason, setReason] = useState("");
  // Completion evidence: a linked document (report / site photos) instead of
  // a bare checkbox — submit_completion requires one attached.
  const workDocs = (docsQ.data || []).filter((d) => d.entity === id || d.entity === w?.id);
  const [reportDoc, setReportDoc] = useState("");
  const report = !!reportDoc;
  const [err, setErr] = useState("");
  const [draftTip, setDraftTip] = useState(null);

  const tasks = TASKS.filter((x) => x.workId === id);
  // Subtask depth for indentation (MAX_DEPTH 3 per rules).
  const taskDepth = (t) => {
    let d = 0;
    let cur = t;
    const seen = new Set();
    while (cur?.parentRef && !seen.has(cur.ref) && d < 10) { seen.add(cur.ref); d += 1; cur = TASKS.find((x) => x.ref === cur.parentRef); }
    return d;
  };
  const actions = cur ? listWorkActions(cur) : [];
  // Route decisions (approve/reject) belong to ministry level ONLY —
  // verification, submit, return and holds stay with the industry side.
  const canDecideWork = ["MINISTRY_ADMIN", "APPROVER"].includes(role);
  const shownActions = actions.filter((a) => !["approve", "reject"].includes(a.action) || canDecideWork);
  // Budget mode comes from the owning unit record — never a hardcoded map.
  const ownerUnit = UNITS.find((u) => u.id === w?.orgUnitId || u.nameEn === w?.unit || u.nameNe === w?.unit);
  const mode = ownerUnit?.mode && ownerUnit.mode !== "—" && ownerUnit.mode !== "INHERIT" ? ownerUnit.mode : "MINISTRY";
  const line = BUDGET.find((b) => b.subhead === w?.subhead);
  // Strictly this work's records — never sibling works in the same unit.
  // (The old orgUnitId fallback pulled other works' tippanis into this page.)
  const workTips = TIPPANIS.filter((x) => x.work && x.work === id);
  const workProcs = PROCS.filter((p) => p.work === id);
  const workContracts = (contractsQ.data || []).filter((c) => c.work === id);
  const workExps = (expsQ.data || []).filter((e) => e.work === id || workContracts.some((c) => c.id && e.contractId === c.id));
  const paidTotal = workExps.filter((e) => e.paidDate).reduce((a, e) => a + (Number(e.net) || 0), 0);
  // Live money (stored w.contractPaisa / w.spentPaisa are set once at creation
  // and never updated — always derive from contracts + bills instead):
  // Contract = Σ this work's contracts; Spent = Σ VERIFIED-or-later bills
  // (same SPENT_STATUSES as dashboard metrics), so the header never sticks at 0.
  const contractTotal = workContracts.length
    ? workContracts.reduce((a, c) => a + (Number(c.amount) || 0), 0)
    : (Number(w?.contractPaisa) || 0);
  const spentTotal = workExps
    .filter((e) => ["VERIFIED", "APPROVED"].includes(e.status))
    .reduce((a, e) => a + (Number(e.net ?? e.spent) || 0), 0);
  const contractors = [...new Set(workContracts.map((c) => c.contractor).filter(Boolean))];
  // Health/bars with LIVE money (contracts + verified spent), not the stale
  // stored 0s — otherwise the financial bar sticks at 0 despite payments.
  const hh = w ? workHealth({ ...w, status: cur, contracts: workContracts, spentVerifiedPaisa: spentTotal }, new Date()) : null;
  // ── Calculation breakdown (shown step-by-step below) ─────────────────────
  const todayKey = kathmanduDayKey(new Date());
  const holdDays = Math.max(0, Number(w?.onHoldDays) || 0);
  const elapsedDays = w ? Math.max(0, daysBetween(w.startDate || w.start, todayKey) - holdDays) : 0;
  const totalDays = w ? Math.max(0, daysBetween(w.startDate || w.start, w.deadline || w.end) - holdDays) : 0;
  const activeTasks = tasks.filter((t) => t.status !== "CANCELLED");
  const weightSum = activeTasks.reduce((a, t) => a + (Number(t.weight) || 0), 0);
  const physicalMode = w?.physicalMode || w?.progressMode || (tasks.length ? "WEIGHTED_TASKS" : "LEAF");
  const spentBills = workExps.filter((e) => ["VERIFIED", "APPROVED"].includes(e.status));
  const finBase = contractTotal || Number(w?.budgetPaisa) || 0;
  const finBaseSrc = contractTotal
    ? tx("ठेक्का जम्मा", "contracts total", lang)
    : tx("बजेट (ठेक्का छैन)", "budget (no contract)", lang);
  // Completion evidence + site photos — visible to EVERYONE, including
  // monitor-only PMO/admin: staff upload via /documents, admins and PMO
  // monitor here. Images preview inline (the session sid travels as ?sid=
  // because an <img> cannot send the x-sid header); other files open in a
  // new tab. Only CLEAN-scanned files preview.
  // Images that fail to stream (expired session, out-of-scope file) must NOT
  // vanish silently — handled inside DocPreview with reason + direct link.
  const isImg = (d) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(String(d.name || ""));
  const cleanDocs = workDocs.filter((d) => d.scan === "CLEAN" && (d.docId || d.id));
  const imgDocs = cleanDocs.filter(isImg);
  const fileDocs = cleanDocs.filter((d) => !isImg(d));
  const completionName = w?.completionDoc
    ? (workDocs.find((d) => (d.docId || d.name) === w.completionDoc)?.name || w.completionDoc)
    : "";
  // PMO Super Admin can delete documents + evidence from here too (same
  // server endpoint as /documents — everyone else is refused with 403).
  const canDeleteDocs = role === "SUPER_ADMIN";
  const removeDoc = async (d) => {
    const label = d.name || d.docId || d.id;
    try {
      if (!window.confirm(`${tx("पक्का मेट्ने?", "Delete for sure?", lang)} ${label}`)) return;
    } catch { return; }
    const res = await mutate(`/api/documents/${encodeURIComponent(d.docId || d.id)}`, { method: "DELETE",
      body: {},
      okMsg: `${label} · ${tx("फाइल मेटियो", "File deleted", lang)}`,
      toast, reload: docsQ.reload });
    // Completion references are cleared server-side — refresh the work so
    // the ✅ line disappears without a manual reload.
    if (res.ok) { try { await works.reload(); } catch {} }
  };

  const preview = useMemo(() => {
    try {
      if (w && mode === "MINISTRY" && (w.budgetPaisa || 0) > 0)
        return matchApprovalRoute({ subject: "BUDGET_APPROVAL", mode, amountNpr: Math.round((w.budgetPaisa || 0)) }, routes);
    } catch { return null; }
    return null;
  }, [mode, w, routes]);

  const run = async (action) => {
    setErr("");
    try {
      const weights = tasks.map((t) => t.weight);
      const available = line ? line.revised - line.committed - line.spent : Infinity;
      const openTasks = tasks.filter((t) => !["DONE", "CANCELLED"].includes(t.status)).length;
      const ctx = {
        reason, comment: reason,
        weights, amountPaisa: (w.budgetPaisa || 0) * 100, availablePaisa: available * 100,
        physical: w.physical, openTasks, reportAttached: report,
        actor: role, submitter: w.owner,
      };
      const r = applyTransition("work", { from: cur, action, actor: role, ctx });
      setStatus(r.status);
      setHistory((p) => [...p, r.history]);
      setAudits((a) => [...a, r.audit]);
      toast(`${w.id} → ${r.status}`);
      // Persist the transition to Mongo (optimistic local state above).
      // Completion carries its evidence document id for desk/site verification.
      const update = action === "submit_completion" && reportDoc ? { status: r.status, completionDoc: reportDoc } : { status: r.status };
      const saved = await mutate("/api/data/works", { method: "PATCH",
        body: { match: { id: w.id }, update, __v: w.__v ?? 1, actor: role },
        okMsg: `${w.id} → ${r.status}`,
        toast, reload: works.reload });
      if (!saved.ok) { setStatus(cur); setHistory((p) => p.slice(0, -1)); setAudits((a) => a.slice(0, -1)); }
      // Side effect: MINISTRY submit also creates a BUDGET_APPROVAL tippani draft.
      if (action === "submit" && preview) setDraftTip({ ref: `TIP-DRAFT-${w.id}`, route: preview.id });
      setReason("");
    } catch (e) {
      setErr(e.code || String(e));
    }
  };

  if (loading) return <div className="space-y-3"><Link href="/works" className="text-xs font-bold text-nepal-blue">← {tx("कार्यहरू", "Works", lang)}</Link><Card title="…"><Loading lang={lang} /></Card></div>;
  if (error || !w) return <div className="space-y-3"><Link href="/works" className="text-xs font-bold text-nepal-blue">← {tx("कार्यहरू", "Works", lang)}</Link><Card title="…"><Loading error={error || "NOT_FOUND"} lang={lang} /></Card></div>;

  return (
    <div className="space-y-3">
      <Link href="/works" className="text-xs font-bold text-nepal-blue">← {tx("कार्यहरू", "Works", lang)}</Link>
      <div className="rounded-xl bg-white p-4 shadow-sm border">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <h1 className="text-lg font-black">{lang === "ne" ? w.titleNe : w.titleEn} <span className="font-mono text-xs text-slate-400">{w.id}</span></h1>
          <div className="flex gap-2"><HealthChip health={hh.health} lang={lang} /><StatusChip status={cur} lang={lang} /></div>
        </div>
        <div className="mt-1 text-xs text-slate-500">{tx("स्वामित्व", "Owner", lang)} {w.owner} · {w.startDate} → {w.deadline} · {tx("स्वास्थ्य दैनिक गणना, हातले होइन", "health computed daily, never by hand", lang)}</div>
        <div className="mt-3 max-w-xl"><Bars expected={hh.expected} physical={hh.physical} financial={hh.financialCapped ?? hh.financial} financialDisplay={hh.financialDisplay} lang={lang} /></div>
        {/* Dynamic transitions — only legal actions for this status (§11).
            Industry side only: monitor-only roles see detail without actions. */}
        {canActOnWork ? (
        <div className="no-print mt-3 flex flex-wrap gap-2 text-xs font-bold">
          {shownActions.length === 0 && <span className="text-slate-400">{tx("कुनै कार्य उपलब्ध छैन (अन्तिम स्थिति)", "No actions (terminal state)", lang)}</span>}
          {shownActions.map((a) => (
            <button key={a.action} onClick={() => run(a.action)} title={(a.needs || []).join(", ")}
              className={`rounded-lg border px-3 py-1.5 hover:bg-slate-50 ${a.action === "approve" || a.action === "verify" ? "bg-emerald-600 text-white hover:bg-emerald-700" : ""}`}>
              {actionLabel(a.action, lang)}{(a.needs || []).length ? " *" : ""}
            </button>
          ))}
        </div>
        ) : (
        <p className="no-print mt-3 text-[12px] text-slate-400">{tx("पढ्ने मात्र — कार्य उद्योग पक्षले निर्धारण गर्छ।", "Read-only — works are determined by the industry side.", lang)}</p>
        )}
        {canActOnWork && (
        <div className="no-print mt-2 flex flex-wrap items-center gap-2 text-xs">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tx("कारण / टिप्पणी (आवश्यक परेमा)", "Reason / comment (when required)", lang)} className="min-w-52 flex-1 rounded-lg border px-2 py-1.5" />
          <label className="flex items-center gap-1 text-slate-600">{tx("सम्पन्न प्रतिवेदन", "Completion report", lang)}
            <select value={reportDoc} onChange={(e) => setReportDoc(e.target.value)} className="ml-1 max-w-52 rounded-lg border px-2 py-1.5">
              <option value="">—</option>
              {workDocs.map((d) => <option key={d.docId || d.name} value={d.docId || d.name}>{d.name}</option>)}
            </select>
          </label>
        </div>
        )}
        {err && <div className="mt-2 font-mono text-xs font-bold text-red-700">{err}</div>}
        {preview && (cur === "DRAFT" || cur === "RETURNED") && (
          <div className="mt-2"><RoutePreview route={preview} lang={lang} />
            <p className="mt-1 text-[12px] text-slate-500">{tx("पेश गर्दा BUDGET_APPROVAL ड्राफ्ट बन्छ — प्रयोगकर्ताले पठाउनुपर्छ।", "Submitting creates a BUDGET_APPROVAL draft for the user to send.", lang)}{draftTip ? ` ✓ ${draftTip.ref} → ${draftTip.route}` : ""}</p>
          </div>
        )}
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        <Card title={tx("कार्य वृक्ष + तौल + TOR", "Tasks tree + weights + TOR", lang)} className="xl:col-span-2">
          <Table cols={[tx("रेफ", "Ref", lang), tx("शीर्षक", "Title", lang), tx("स्वामित्व", "Owner", lang), tx("तौल%", "Wt%", lang), tx("भौतिक", "Physical", lang), tx("स्थिति", "Status", lang)]} rows={tasks.map((x) => [x.ref, <span key={x.ref}><span className="mr-1 font-mono text-slate-300">{"· ".repeat(taskDepth(x))}</span><Link href={`/tasks/${x.ref}`} className="font-bold text-nepal-blue">{lang === "ne" ? x.title : x.titleEn}</Link></span>, x.owner, x.weight, `${x.physical}%`, <StatusChip key={x.ref} status={x.status} lang={lang} />])} />
        </Card>
        <Card title={tx("बजेट · टिप्पणी · खरिद", "Budget · Tippani · Procurement", lang)}>
          <div className="text-[13px] space-y-1.5">
            <div>{tx("बजेट", "Budget", lang)} NPR {fmtMoney(w.budgetPaisa)} · {tx("सम्झौता", "Contract", lang)} NPR {fmtMoney(contractTotal)} · {tx("खर्च", "Spent", lang)} NPR {fmtMoney(spentTotal)}</div>
            {contractors.length > 0 && <div className="font-bold text-nepal-blue">{tx("ठेकेदार", "Contractor", lang)}: {contractors.join(" · ")}</div>}
            {workTips.length === 0 && workProcs.length === 0 && workContracts.length === 0 && workExps.length === 0 && <div className="text-slate-400">—</div>}
            {workTips.map((x) => <div key={x.ref}><Link href={`/tippani/${x.ref}`} className="font-bold text-nepal-blue">{x.ref}</Link> · {x.status} · {x.step}</div>)}
            {workProcs.map((p) => <div key={p.pkg}><Link href={`/procurements/${encodeURIComponent(p.pkg)}`} className="font-bold text-nepal-blue">{p.pkg}</Link> · {tx("टेन्डर", "Tender", lang)} · {p.stage}</div>)}
            {workContracts.map((c) => <div key={c.id}><Link href={`/contracts/${encodeURIComponent(c.id)}`} className="font-bold text-nepal-blue">{c.id}</Link> · {tx("सम्झौता", "Contract", lang)} · {c.status} · {c.contractor || ""}</div>)}
            {workExps.length > 0 && (
              <div className="rounded-lg bg-slate-50 p-2">
                <div className="font-bold">{tx("भुक्तानी", "Payments", lang)} · {workExps.length} {tx("बिल", "bills", lang)} · {tx("भुक्तानी भएको", "Paid", lang)} NPR {paidTotal.toLocaleString("en-IN")}</div>
                {workExps.map((e) => <div key={e.voucher} className="text-[12px]">{e.voucher} · {e.status}{e.paidDate ? ` · ✅ ${e.paidDate}` : ""} · NPR {(Number(e.net) || 0).toLocaleString("en-IN")}</div>)}
              </div>
            )}
            <div>{tx("कागजात", "Docs", lang)}: {workDocs.length ? workDocs.slice(0, 2).map((d) => d.name).join(" · ") : "—"}</div>
          </div>
        </Card>
      </div>
      <Card title={tx("गणना — अपेक्षित / भौतिक / वित्तीय कसरी आयो", "Calculation — how Expected / Physical / Financial are derived", lang)}>
        <div className="space-y-2 text-[13px]">
          <div className="rounded-lg bg-sky-50 p-2">
            <div className="font-bold text-sky-900">{tx("अपेक्षित", "Expected", lang)}: {hh?.expected ?? 0}%</div>
            <div className="font-mono text-[12px]">({elapsedDays} ÷ {totalDays}) × 100</div>
            <div className="text-slate-600">{tx("सुरु", "Start", lang)} {w.startDate || w.start || "—"} → {tx("आज (काठमाडौं)", "Today (Kathmandu)", lang)} {todayKey} → {tx("समाप्ति", "Deadline", lang)} {w.deadline || w.end || "—"} · {tx("होल्ड दिन", "On-hold days", lang)} {holdDays} · {tx("बितेको", "Elapsed", lang)} {elapsedDays} / {tx("जम्मा", "Total", lang)} {totalDays} {tx("दिन", "days", lang)}</div>
          </div>
          <div className="rounded-lg bg-emerald-50 p-2">
            <div className="font-bold text-emerald-900">{tx("भौतिक", "Physical", lang)}: {hh?.physical ?? 0}% · {tx("मोड", "Mode", lang)} {physicalMode}</div>
            {physicalMode === "WEIGHTED_TASKS" && activeTasks.length > 0 && (
              <Table cols={["Ref", `${tx("तौल", "Weight", lang)}%`, `${tx("भौतिक", "Physical", lang)}%`, tx("योगदान", "Contribution", lang)]}
                rows={activeTasks.map((t) => {
                  const share = weightSum ? (Number(t.weight) || 0) / weightSum : 0;
                  const contrib = share * (Number(t.physical) || 0);
                  return [t.ref, t.weight, `${t.physical}%`, `${(Math.round(contrib * 100) / 100).toFixed(2)}% (${((share * 100).toFixed(1))}% × ${t.physical}%)`];
                })} />
            )}
            {physicalMode === "WEIGHTED_TASKS" && activeTasks.length > 0 && (
              <div className="font-mono text-[12px]">Σ = {activeTasks.map((t) => `${((weightSum ? (Number(t.weight) || 0) / weightSum : 0) * (Number(t.physical) || 0)).toFixed(2)}`).join(" + ")} = {(hh?.physical ?? 0).toFixed(2)}%</div>
            )}
            {!(physicalMode === "WEIGHTED_TASKS" && activeTasks.length > 0) && (
              <div className="text-slate-600">{tx("टास्क छैन — कार्यको पुष्टि गरिएको %", "No tasks — work's own confirmed %", lang)}: {w.physical ?? 0}%</div>
            )}
          </div>
          <div className="rounded-lg bg-amber-50 p-2">
            <div className="font-bold text-amber-900">{tx("वित्तीय", "Financial", lang)}: {hh?.financialDisplay ?? "—"}</div>
            <div className="font-mono text-[12px]">({fmtMoney(spentTotal)} ÷ {fmtMoney(finBase)}) × 100</div>
            <div className="text-slate-600">{tx("खर्च (VERIFIED+ मात्र)", "Spent (VERIFIED+ only)", lang)} NPR {fmtMoney(spentTotal)} {spentBills.length ? `(${spentBills.map((e) => `${e.voucher}:${fmtMoney(e.net ?? e.spent)}`).join(" + ")})` : `(${tx("बिल छैन", "no bills", lang)})`} ÷ {tx("आधार", "Base", lang)} NPR {fmtMoney(finBase)} ({finBaseSrc})</div>
          </div>
          <div>{tx("अन्तर", "Gap", lang)} = {tx("भौतिक", "Physical", lang)} − {tx("अपेक्षित", "Expected", lang)} = {(hh?.gap ?? 0).toFixed(2)} · {tx("स्वास्थ्य", "Health", lang)} <HealthChip health={hh?.health} lang={lang} /> <span className="text-slate-500">({tx("सीमा", "Thresholds", lang)} ON_TRACK ≥ {THRESHOLDS.ON_TRACK_MIN}, AT_RISK ≥ {THRESHOLDS.AT_RISK_MIN})</span></div>
        </div>
      </Card>
      <Card title={tx("सम्पन्न प्रमाण + साइट फोटो (PMO सहित सबैले हेर्ने)", "Completion evidence + site photos (seen by all incl. PMO)", lang)}
        action={<span className="text-[11px] text-slate-400">{tx("तह", "Level", lang)}: {ownerUnit?.type || "—"} · {tx("भौतिक", "Physical", lang)} {w.physical ?? 0}%</span>}>
        {w.completionDoc && (
          <p className="mb-2 text-[13px] font-bold text-emerald-700">✅ {tx("सम्पन्न प्रमाण", "Completion evidence", lang)}: {completionName}
            {canDeleteDocs && (() => {
              const d = workDocs.find((x) => (x.docId || x.name) === w.completionDoc);
              return d ? <button onClick={() => removeDoc(d)} title={tx("स्थायी रूपमा मेट्नुहोस्", "Delete permanently", lang)} className="no-print ml-2 cursor-pointer text-xs font-bold text-red-700">🗑</button> : null;
            })()}
          </p>
        )}
        {cleanDocs.length === 0 ? (
          <p className="text-sm text-slate-400">{tx("कुनै फोटो/प्रमाण छैन — कर्मचारीले /documents मा अपलोड गर्छन्", "No photos/evidence yet — staff upload via /documents", lang)}</p>
        ) : (
          <>
            {imgDocs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {imgDocs.map((d) => {
                  const key = d.docId || d.id;
                  return (
                    <span key={key} className="relative inline-block">
                      <DocPreview docId={key} name={d.name} variant="thumb" lang={lang} />
                      {canDeleteDocs && (
                        <button onClick={() => removeDoc(d)} title={tx("स्थायी रूपमा मेट्नुहोस्", "Delete permanently", lang)}
                          className="no-print absolute right-1 top-1 cursor-pointer rounded-md bg-red-600 px-1.5 py-0.5 text-[11px] font-bold text-white">🗑</button>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
            {fileDocs.length > 0 && (
              <div className="mt-2 space-y-2 text-[13px]">
                {fileDocs.map((d) => {
                  const pdf = /\.pdf$/i.test(String(d.name || ""));
                  return (
                    <div key={d.docId || d.id} className="rounded-lg border border-slate-200 p-2">
                      <div><span className="font-bold text-slate-800">{pdf ? "📄 " : "📎 "}{d.name}</span>
                        <span className="ml-1 text-slate-400">({d.docType || d.type || ""})</span>
                        {canDeleteDocs && (
                          <button onClick={() => removeDoc(d)} title={tx("स्थायी रूपमा मेट्नुहोस्", "Delete permanently", lang)} className="no-print ml-2 cursor-pointer text-xs font-bold text-red-700">🗑</button>
                        )}</div>
                      <div className="mt-1"><DocPreview docId={d.docId || d.id} name={d.name} lang={lang} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>
      <Card title={tx("स्थिति इतिहास + अडिट (हरेक ट्रान्जिसन लेखिन्छ)", "Status history + audit (every transition written)", lang)}>
        <HistoryTimeline history={[{ from: w.status, to: cur, action: "—", actor: "seed", reason: "" }, ...history].slice(history.length ? 0 : 1)} lang={lang} />
        {audits.length > 0 && <p className="mt-1 font-mono text-[11px] text-slate-500">{audits.map((a) => a.code).join(" · ")}</p>}
      </Card>
    </div>
  );
}
