"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import TransitionBox from "@/components/transitions";
import { useCollection, Loading } from "@/lib/use-data";
import { mutate } from "@/lib/mutate";
import { useProcurementRole } from "@/lib/procurement";

export default function ContractDetail({ params }) {
  const { lang, user, role, toast } = useApp();
  const { isDeptApprover } = useProcurementRole(role, user);
  // Contract approval (PENDING_APPROVAL → ACTIVE, etc.) is the Unit head's
  // alone — everyone else gets a read-only status box (server refuses too).
  const { id } = use(params);
  const { data: CONTRACTS, loading, error, reload } = useCollection("contracts");
  const expsQ = useCollection("expenditures");
  const seed = CONTRACTS.find((c) => c.id === id);
  const [status, setStatus] = useState(null);
  const cur = status ?? seed?.status;
  // Legacy milestones may lack ids/amounts — derive them from position + pct.
  const ms = (seed?.milestones || []).map((m, i) => ({
    ...m,
    id: m.id || `${seed.id}-M${i + 1}`,
    amount: Number(m.amount) || Math.round(((Number(seed.amount) || 0) * (Number(m.pct) || 0)) / 100),
  }));
  const billsOf = (mid) => (expsQ.data || []).filter((e) => e.contractId === seed?.id && e.milestoneId === mid);
  // Bill recording is unit/staff entry work (server-enforced; section
  // never enters — it verifies), and only against ACTIVE contracts.
  const canBill = ["UNIT_HEAD", "STAFF"].includes(role) && cur === "ACTIVE";
  const isClosed = cur === "CLOSED";
  // Close checklist (mirrors the server PATCH guard): every bill must be
  // APPROVED + paid (paidDate), every milestone retention released. Used to
  // block Close client-side AND to explain legacy bad closes.
  const allBills = (expsQ.data || []).filter((e) => e.contractId === seed?.id);
  const unpaidBills = allBills.filter((b) => b.status !== "REVERSED" && (b.status !== "APPROVED" || !b.paidDate)).map((b) => b.voucher);
  const heldIds = ms.filter((m) => !m.retentionReleased).map((m) => m.id);
  const closeBlocked = unpaidBills.length > 0 || (ms.length > 0 && heldIds.length > 0);
  const persist = async (update, base, label, reason = "") => {
    const saved = await mutate("/api/data/contracts", { method: "PATCH",
      body: { match: { id: seed.id }, update, __v: base?.__v ?? 1, ...(String(reason || "").trim() ? { reason: String(reason).trim() } : {}) },
      okMsg: label || `${seed.id} · ${tx("सेभ भयो", "Saved", lang)}`,
      toast, reload });
    return saved;
  };
  // Record a bill (DRAFT expenditure) against a milestone: measurement
  // (% claimed + book ref) is captured separately from money, so physical
  // progress and financial payment never collapse into one number.
  // Repeatable — one voucher per call, linked by contract + milestone.
  const recordBill = async (m) => {
    const seq = billsOf(m.id).length + 1;
    const voucher = `BILL-${seed.id}-${m.id.split("-").pop()}-${seq}`;
    const gross = Number(m.amount) || 0;
    const retention = Math.round((gross * (Number(seed.retention) || 0)) / Math.max(1, Number(seed.amount) || 1));
    await mutate("/api/data/expenditures", { method: "POST",
      body: { doc: { voucher, work: seed.work, contractId: seed.id, milestoneId: m.id, billNo: voucher, billDate: new Date().toISOString().slice(0, 10), payee: seed.contractor || "—", physicalPct: Number(m.pct) || 0, measurement: `MB-${voucher}`, gross, tds: 0, retention, net: gross - retention, status: "DRAFT", date: new Date().toISOString().slice(0, 10) } },
      okMsg: `${voucher} · ${tx("बिल दर्ता", "Bill recorded", lang)}`,
      toast, reload: expsQ.reload });
  };
  // Release held retention for a paid milestone (contract close requires it).
  const releaseRetention = async (m) => {
    const next = (seed.milestones || []).map((x, i) => ({ ...x, retentionReleased: (x.id || `${seed.id}-M${i + 1}`) === m.id ? true : !!x.retentionReleased }));
    const saved = await mutate("/api/data/contracts", { method: "PATCH",
      body: { match: { id: seed.id }, update: { milestones: next }, __v: seed.__v ?? 1 },
      toast });
    if (!saved.ok) return;
    await mutate("/api/data/auditlogs", { method: "POST",
      body: { doc: { at: new Date().toISOString(), actor: user?.username || "", action: "contract.retentionRelease", entity: seed.id, before: m.id, after: "released", note: `${m.id}`, orgAncestors: seed.orgAncestors || [] } },
      okMsg: `${m.id} · ${tx("धरौटी फुकुवा", "Retention released", lang)}`,
      toast, reload });
  };
  if (loading) return <div className="space-y-3"><Card title="…"><Loading lang={lang} /></Card></div>;
  if (error || !seed) return <div className="space-y-3"><Card title="…"><Loading error={error || "NOT_FOUND"} lang={lang} /></Card></div>;
  return (
    <div className="space-y-3">
      <Link href="/procurements" className="text-xs font-bold text-nepal-blue">← {tx("खरिद", "Procurement", lang)}</Link>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-black">{seed.id} · {seed.contractor}</h1>
          <StatusChip status={cur} lang={lang} />
        </div>
        <p className="text-xs text-slate-500">{seed.pkg} · {seed.work} · NPR {(Number(seed.amount) || 0).toLocaleString("en-IN")} · {tx("धरौटी", "Retention", lang)} {(Number(seed.retention) || 0).toLocaleString("en-IN")}{seed.retentionReleased ? ` (${tx("फुकुवा", "released", lang)})` : ""}{seed.bidder ? ` · ${tx("बोलपत्र", "Bid", lang)} ${seed.bidder}` : ""}</p>
        {cur === "PENDING_APPROVAL" && (
          <p className="mt-2 text-[12px] font-bold text-amber-700">{tx("स्वीकृति बाँकी — विभागले सक्रिय गरेपछि मात्र बिल।", "Approval pending — bills unlock after department activation.", lang)}</p>
        )}
        {isDeptApprover ? (
        <div className="mt-2 max-w-md"><TransitionBox recordType="contract" status={cur} extraCtx={{ unpaidBills, heldRetention: heldIds }} onStatus={async (next, _r, note) => { const s = await persist({ status: next }, seed, "", note); if (s?.ok) setStatus(next); }} lang={lang} />
        {cur === "COMPLETED" && closeBlocked && (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[12px] text-amber-800">
            <span className="font-black">{tx("बन्द गर्न मिल्दैन — पहिले भुक्तानी + धरौटी", "Cannot close yet — pay + release first", lang)}</span>
            <span className="block">{unpaidBills.length ? `${tx("भुक्तानी बाँकी", "Unpaid", lang)}: ${unpaidBills.join(", ")} → ${tx("Expenditures मा APPROVED → Record payment", "Expenditures → APPROVED → Record payment", lang)}` : ""}</span>
            <span className="block">{heldIds.length ? `${tx("धरौटी रोक्का", "Held retention", lang)}: ${heldIds.join(", ")} → ${tx("पहिले भुक्तानी, अनि तल Release retention", "Pay first, then Release retention below", lang)}` : ""}</span>
          </div>
        )}</div>
        ) : (
        <p className="mt-2 text-[12px] text-slate-400">{tx("स्वीकृति इकाइ प्रमुखले मात्र — पढ्ने मात्र।", "Approval by the unit head only — read-only.", lang)}</p>
        )}
        {isClosed && (unpaidBills.length > 0 || heldIds.length > 0) && (
          <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-[12px] text-red-800">
            <span className="font-black">{tx("यो ठेक्का भुक्तानी/धरौटी नटुङ्गिई बन्द भएको छ", "Closed with unpaid bills / held retention", lang)}</span>
            <span className="block">{unpaidBills.length ? `${tx("भुक्तानी बाँकी", "Unpaid", lang)}: ${unpaidBills.join(", ")}. ${tx("Expenditures पेजमा APPROVED बिलमा Record payment गर्नुहोस्", "On the Expenditures page, Record payment on the APPROVED bill", lang)}.` : ""}</span>
            <span className="block">{heldIds.length ? `${tx("धरौटी रोक्का", "Held retention", lang)}: ${heldIds.join(", ")}. ${tx("भुक्तानीपछि तल Release retention थिच्नुहोस्", "After payment, press Release retention below", lang)}.` : ""}</span>
          </div>
        )}
        {isClosed && !(unpaidBills.length > 0 || heldIds.length > 0) && (
          <p className="mt-2 text-[12px] font-bold text-emerald-700">{tx("बन्द — सबै बिल भुक्तानी + धरौटी फुकुवा", "Closed — all bills paid + retention released", lang)}</p>
        )}
      </div>
      <Card title={tx("माइलस्टोन + बिल + भुक्तानी", "Milestones + bills + payment", lang)}>
        <Table cols={[tx("माइलस्टोन", "Milestone", lang), "%", tx("रकम", "Amount", lang), tx("बिल", "Bills", lang), tx("भुक्तानी", "Paid", lang), tx("धरौटी", "Retention", lang), ""]}
          rows={ms.map((m) => {
            const bills = billsOf(m.id);
            const paidBill = bills.find((b) => b.paidDate);
            const approved = bills.some((b) => b.status === "APPROVED");
            const verified = bills.some((b) => b.status === "VERIFIED");
            const submitted = bills.some((b) => b.status === "SUBMITTED");
            const draft = bills.some((b) => b.status === "DRAFT");
            // After close the bill list stays visible as audit history (never
            // hidden). Paid/retention columns switch to final-state wording so
            // a CLOSED row never says "payment due" / "Held" without a warning.
            const paidCell = paidBill
              ? `✅ ${paidBill.paidDate}`
              : isClosed
                ? `❌ ${tx("भुक्तानी बाँकी (बन्दअघि हुनुपर्थ्यो)", "Unpaid — should have been paid before close", lang)}`
                : approved ? tx("स्वीकृत — भुक्तानी बाँकी", "Approved — payment due", lang) : verified ? tx("प्रमाणित — स्वीकृति बाँकी", "Verified — approval due", lang) : submitted ? tx("पेश — प्रमाणीकरण बाँकी", "Submitted — verification due", lang) : draft ? tx("मस्यौदा — पेश गर्नुहोस्", "Draft — submit first", lang) : "—";
            const retentionCell = m.retentionReleased
              ? tx("फुकुवा", "Released", lang)
              : isClosed
                ? `⚠ ${tx("रोक्का (बन्दअघि फुकुवा हुनुपर्थ्यो)", "Held — should have been released before close", lang)}`
                : tx("रोक्का", "Held", lang);
            // Release stays available even on CLOSED/COMPLETED so a wrongly
            // closed contract can be repaired (pay first, then release).
            const canRelease = paidBill && !m.retentionReleased;
            return [m.name, m.pct, (Number(m.amount) || 0).toLocaleString("en-IN"),
              bills.length ? bills.map((b) => `${b.voucher} (${b.status}${b.physicalPct ? ` · ${b.physicalPct}%` : ""}${b.paidDate ? ", paid" : ""})`).join(" · ") : "—",
              paidCell,
              retentionCell,
              <div key={m.id} className="flex flex-wrap gap-1">
                {canBill && <button onClick={() => recordBill(m)} className="rounded border px-2 py-0.5 text-xs font-bold text-nepal-blue">+ {tx("बिल", "Bill", lang)}</button>}
                {canRelease && <button onClick={() => releaseRetention(m)} className="rounded border px-2 py-0.5 text-xs font-bold text-emerald-700">{tx("धरौटी फुकुवा", "Release retention", lang)}</button>}
                {isClosed && !paidBill && approved && <Link href="/expenditures" className="rounded border px-2 py-0.5 text-xs font-bold text-amber-700">{tx("भुक्तानी गर्न → Expenditures", "Pay → Expenditures", lang)}</Link>}
              </div>];
          })} />
      </Card>
      <Card title={tx("धरौटी · भेरिएसन", "Securities · variations", lang)}>
        <Table cols={[tx("प्रकार", "Type", lang), tx("रकम", "Amount", lang)]} rows={[...(seed.securities || []).map((s) => [`${s.type} (${s.valid})`, (Number(s.amount) || 0).toLocaleString("en-IN")]), ...((seed.variations || []).length ? seed.variations : [[tx("कुनै भेरिएसन छैन", "No variations", lang), "—"]])]} />
      </Card>
    </div>
  );
}
