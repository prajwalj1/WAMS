"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import TransitionBox from "@/components/transitions";
import { useCollection, Loading } from "@/lib/use-data";
import { PROC_STAGES } from "@/lib/lifecycle";
import { kathmanduDayKey } from "@/lib/progress";
import { mutate } from "@/lib/mutate";
import { useProcurementRole } from "@/lib/procurement";

// Stage state per package: index into PROC_STAGES + DONE/SKIPPED map.
function stageOf(stages) {
  for (const s of PROC_STAGES) {
    if (stages[s] === "DONE" || stages[s] === "SKIPPED") continue;
    return s;
  }
  return "COMPLETION";
}

export default function Proc() {
  const { lang, toast, role, user } = useApp();
  // Authority matrix: Staff enters bids · Section head evaluates + LOI +
  // drafts contracts (Unit head may too) · Unit head approves contracts ·
  // PMO/Minister monitor (no routine chain writes).
  const { isPreparer, isReviewer, isDeptApprover } = useProcurementRole(role, user);
  // List-view aliases matching the server authority matrix:
  // only STAFF (preparer) may POST a new package; stage moves to
  // IN_PROGRESS may be done by reviewer or dept approver, while
  // DONE/SKIPPED/CANCELLED is dept-only (enforced server-side).
  const isInserter = isPreparer;
  const isApprover = isReviewer || isDeptApprover;
  // Section (and PMO) may delete a package — refused server-side once a
  // contract exists for it.
  const canDeletePkg = ["SUPER_ADMIN", "SECTION_HEAD"].includes(role);
  const { data: PROCUREMENTS, loading, error, reload } = useCollection("procurements");
  const contractsQ = useCollection("contracts");
  // Stage state is derived live from each record's stage field — the map below
  // only holds in-progress UI edits until they are PATCHed to the database.
  const stageIndex = (p) => Math.max(0, PROC_STAGES.indexOf(p.stage));
  const baseStages = (p) => {
    // Derived map first, stored map overlaid — partial maps can't grey out reality.
    const m = {};
    PROC_STAGES.forEach((s, i) => { m[s] = i < stageIndex(p) ? "DONE" : i === stageIndex(p) ? "IN_PROGRESS" : "PENDING"; });
    return { ...m, ...(p.stages || {}) };
  };
  const [done, setDone] = useState({});
  const [cancelled, setCancelled] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [pkg, setPkg] = useState("");
  const [work, setWork] = useState("");
  const [method, setMethod] = useState("NCB");
  const [estimate, setEstimate] = useState("");
  const [addMsg, setAddMsg] = useState("");
  const worksQ = useCollection("works");
  const persist = async (p, stages, stage) => {
    return mutate("/api/data/procurements", { method: "PATCH",
      body: { match: { pkg: p.pkg }, update: { stages, stage, stageSince: kathmanduDayKey(new Date()) }, __v: p.__v ?? 1 },
      okMsg: `${p.pkg} → ${stage}`,
      toast, reload });
  };
  const removePkg = async (p) => {
    try {
      if (!window.confirm(`${tx("पक्का मेट्ने? प्याकेज + बोलपत्र + सम्झौता (बिल भए हट्दैन)।", "Delete for sure? Package + bids + contract (kept if bills exist).", lang)} ${p.pkg}`)) return;
    } catch { return; }
    await mutate("/api/data/procurements", { method: "DELETE",
      body: { match: { pkg: p.pkg } },
      okMsg: `${p.pkg} · ${tx("प्याकेज मेटियो", "Package deleted", lang)}`,
      toast, reload });
  };
  const addPkg = async () => {
    setAddMsg("");
    const code = pkg.trim().toUpperCase();
    if (!code) { setAddMsg(tx("प्याकेज कोड आवश्यक", "Package code required", lang)); return; }
    if (PROCUREMENTS.some((x) => String(x.pkg).toUpperCase() === code)) { setAddMsg("PKG_TAKEN"); return; }
    if (!work) { setAddMsg(tx("कार्य आवश्यक", "Work required", lang)); return; }
    // Inherit the linked work's chain so scoped views keep the package.
    // Also inherit its FY so FY-filtered reports (RPT-PROCUREMENT) keep
    // working for new packages; older rows resolve FY via the work join.
    const w = (worksQ.data || []).find((x) => x.id === work);
    const saved = await mutate("/api/data/procurements", { method: "POST",
      body: { doc: { pkg: code, work, method, stage: "PREPARATION", stageSince: kathmanduDayKey(new Date()), estimate: Number(estimate) || 0, contract: 0, bidder: "", egp: "", fy: w?.fy || "", fiscalYearId: w?.fy || "", orgUnitId: w?.orgUnitId || "", orgAncestors: w?.orgAncestors || [], orgPath: w?.orgPath || "" } },
      okMsg: `${code} · ${tx("प्याकेज बन्यो", "Package created", lang)}`,
      toast, reload });
    if (!saved.ok) { setAddMsg(saved.code || "CREATE_FAILED"); return; }
    setPkg(""); setWork(""); setEstimate(""); setShowAdd(false);
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{t("procTitle", lang)}</h1>
      <Card title={tx("टेन्डर → मूल्यांकन → सम्झौता → माइलस्टोन → समापन", "Tender → evaluation → agreement → milestones → closure", lang)}
        action={isInserter ? <button onClick={() => setShowAdd((s) => !s)} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">+ {tx("प्याकेज", "Package", lang)}</button> : null}>
        {showAdd && isInserter && (
          <div className="mb-2 grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-5">
            <label className="text-xs font-bold text-slate-600">{tx("प्याकेज", "Package", lang)}<input value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="PKG-01" className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" /></label>
            <label className="text-xs font-bold text-slate-600">{tx("कार्य", "Work", lang)}<select value={work} onChange={(e) => setWork(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal"><option value="">—</option>{(worksQ.data || []).map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}</select></label>
            <label className="text-xs font-bold text-slate-600">{tx("विधि", "Method", lang)}<select value={method} onChange={(e) => setMethod(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal">{["NCB", "Sealed Quotation", "Direct Purchase", "Framework"].map((m) => <option key={m}>{m}</option>)}</select></label>
            <label className="text-xs font-bold text-slate-600">{tx("अनुमान (NPR)", "Estimate (NPR)", lang)}<input type="number" min={0} value={estimate} onChange={(e) => setEstimate(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" /></label>
            <div className="flex items-end gap-2"><button onClick={addPkg} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">{t("add", lang)}</button>{addMsg && <span className="font-mono text-xs font-bold">{addMsg}</span>}</div>
          </div>
        )}
        {loading || contractsQ.loading ? <Loading lang={lang} /> : error || contractsQ.error ? <Loading error={error || contractsQ.error} lang={lang} /> : (
        <Table cols={[tx("प्याकेज", "Package", lang), tx("कार्य", "Work", lang), tx("विधि", "Method", lang), tx("चरण", "Stage", lang), tx("अनुमान", "Estimate", lang), tx("सम्झौता", "Contract", lang), tx("बोलपत्रदाता", "Bidder", lang), tx("चरण कार्य", "Stage action", lang), ""]}
          rows={PROCUREMENTS.map((p) => {
            const isCancelled = cancelled[p.pkg] || p.stage === "CANCELLED";
            const merged = { ...baseStages(p), ...(done[p.pkg] || {}) };
            const cur = isCancelled ? "CANCELLED" : (merged[stageOf(merged)] || "PENDING");
            const st = stageOf(merged);
            // Live contract data (same join as the detail page) — the legacy
            // p.contract / p.bidder fields are frozen, so read the contract
            // record and winner selection instead. Matched by package ONLY:
            // the old work-fallback pulled another package's contract (same
            // work) into this row after load — e.g. a stray "pppp" result.
            const contract = (contractsQ.data || []).find((c) => c.pkg === p.pkg || (!c.pkg && p.work && c.work === p.work));
            const contractor = contract?.contractor || p.selection?.bidder || p.bidder || "—";
            const contractAmt = contract ? Number(contract.amount) || 0 : Number(p.contract) || 0;
            return [<Link key={p.pkg} href={`/procurements/${encodeURIComponent(p.pkg)}`} className="font-bold text-nepal-blue">{p.pkg}</Link>, p.work, p.method, isCancelled ? <StatusChip key={p.pkg} status="CANCELLED" lang={lang} /> : `${st} · ${cur}`,
              (Number(p.estimate) || 0).toLocaleString("en-IN"), contractAmt ? contractAmt.toLocaleString("en-IN") : "—", contractor,
              isApprover ? (
              <div key={p.pkg + "t"} className="max-w-60">
                <TransitionBox recordType="procurement" status={cur === "CANCELLED" ? "CANCELLED" : cur} lang={lang}
                  onStatus={async (next) => {
                    if (next === "CANCELLED") {
                      const res = await persist(p, merged, "CANCELLED");
                      if (res?.ok) setCancelled((c) => ({ ...c, [p.pkg]: true }));
                      return;
                    }
                    const nextStages = { ...merged, [st]: next };
                    const nextStage = stageOf(nextStages);
                    // Server state only — never optimistically.
                    const res = await persist(p, nextStages, nextStage);
                    if (res?.ok) setDone((d) => ({ ...d, [p.pkg]: nextStages }));
                  }} />
              </div>
              ) : <span key={p.pkg + "t"} className="text-xs text-slate-400">—</span>,
              canDeletePkg
                ? <button key={p.pkg + "x"} onClick={() => removePkg(p)} title={tx("स्थायी रूपमा मेट्नुहोस्", "Delete permanently", lang)} className="cursor-pointer text-xs font-bold text-red-700">🗑 {tx("मेट्नुहोस्", "Delete", lang)}</button>
                : null];
          })} />
        )}
        <p className="mt-2 text-[12px] text-slate-500">{tx("प्रत्येक चरण PENDING → IN_PROGRESS → DONE | SKIPPED · स्थिति = वर्तमान चरण · CANCELLED = पुनः टेन्डर वा त्याग।", "Each stage PENDING → IN_PROGRESS → DONE | SKIPPED · status = current stage · CANCELLED = re-tender or abandon.", lang)}</p>
      </Card>
    </div>
  );
}
