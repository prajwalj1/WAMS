"use client";
import { useState } from "react";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import { useList, ListToolbar, Pager, exportCsv } from "@/components/list";
import { Field, ServerErrors, useForm, vRequired } from "@/components/forms";
import TransitionBox from "@/components/transitions";
import { useCollection, Loading } from "@/lib/use-data";
import { kathmanduDayKey } from "@/lib/progress";
import { mutate } from "@/lib/mutate";
import { useProcurementRole } from "@/lib/procurement";

export default function Expenditures() {
  const { lang, toast, role, perms, user } = useApp();
  // Entry + submit is unit/staff work — the SECTION never enters bills,
  // so the entry form below is hidden for section heads; they verify/return
  // submitted bills instead. Staff can enter and submit but never approve.
  // Reversal and payment recording stay with finance (budget.manage), and
  // only APPROVED bills can be paid. The server refuses anything else.
  const canEnter = ["UNIT_HEAD", "STAFF"].includes(role);
  const canVerify = role === "SECTION_HEAD" || (perms || []).includes("*");
  const canDecide = canVerify;
  const { isDeptApprover } = useProcurementRole(role, user);
  const canApprovePay = isDeptApprover || (perms || []).includes("*");
  const canPay = (perms || []).includes("*") || (perms || []).includes("budget.manage");
  // Action buttons per role: section verifies/returns, department approves
  // payment, finance reverses approved bills; entry roles submit only.
  const boxAllow = canApprovePay
    ? ["submit", "approve"]
    : canDecide
      ? ["verify", "return"]
      : canEnter
        ? ["submit"]
        : canPay
          ? ["reverse"]
          : null;
  const { data, loading, error, reload } = useCollection("expenditures");
  const worksQ = useCollection("works");
  const contractsQ = useCollection("contracts");
  const rows = data;
  const f = useForm({ voucher: "", work: "", billNo: "", milestone: "", physicalPct: "", measurement: "", gross: "", tds: "", retention: "", net: "" }, { voucher: vRequired, work: vRequired });
  const ctl = useList({
    rows,
    searchKeys: ["voucher", "payee", "work"],
    filters: [
      { key: "status", label: tx("स्थिति", "Status", lang), options: ["DRAFT", "SUBMITTED", "VERIFIED", "APPROVED", "RETURNED", "REVERSED"].map((s) => ({ value: s, label: s })) },
      { key: "work", label: tx("कार्य", "Work", lang), options: [...new Set(rows.map((r) => r.work))].map((w) => ({ value: w, label: w })) },
    ],
    sortOptions: [
      { value: "date", label: tx("मिति", "Date", lang), get: (r) => r.date },
      { value: "net", label: tx("रकम", "Net", lang), get: (r) => r.net },
    ],
  });
  // All contract milestones across contracts, for bill linkage. Older
  // contracts may lack an id — fall back to the package code.
  // Payment is always based on the contract's work: picking a milestone
  // auto-fills + locks the work to that contract's work (server re-enforces
  // it), so a bill can never land on the wrong work (e.g. "gggg").
  const milestoneOptions = (contractsQ.data || []).flatMap((c) => {
    const cid = c.id || c.pkg;
    return ((c.milestones || []).map((m, i) => ({ contractId: cid, milestoneId: m.id || `${cid}-M${i + 1}`, work: c.work || "", label: `${cid} · ${m.name} (${m.pct}%) · ${c.work || ""}` })));
  });
  const linkedWork = f.values.milestone ? (milestoneOptions.find((m) => `${m.contractId}|${m.milestoneId}` === String(f.values.milestone))?.work || "") : "";
  const pickMilestone = (v) => {
    f.set("milestone")(v);
    const hit = milestoneOptions.find((m) => `${m.contractId}|${m.milestoneId}` === String(v || ""));
    if (hit?.work) f.set("work")(hit.work);
  };
  // The action reason/comment typed in the box travels with the record:
  // staff submit reasons are saved as submitNote, section decisions as
  // decisionNote (+ decidedBy) — so the section always sees WHY it was
  // sent, and staff later see why it was verified/returned.
  const setStatus = async (voucher, next, cur, note = "") => {
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
      toast, reload });
  };
  // Record payment on an APPROVED bill only (server refuses anything
  // else): paidDate + ref. Physical progress and payment stay decoupled —
  // payment follows verified measurement + approval, never a bare %.
  const recordPayment = async (v) => {
    const paidDate = new Date().toISOString().slice(0, 10);
    const paidRef = `PAY-${v.voucher}`;
    await mutate("/api/data/expenditures", { method: "PATCH",
      body: { match: { voucher: v.voucher }, update: { paidDate, paidRef }, __v: v.__v ?? 1 },
      okMsg: `${v.voucher} · ${tx("भुक्तानी", "Paid", lang)} ${paidDate} · ${paidRef}`,
      toast, reload });
  };
  // Live net preview: when gross/tds/retention are entered, Net is their
  // computed result (read-only); otherwise typed by hand.
  const g0 = Number(f.values.gross) || 0;
  const t0 = Number(f.values.tds) || 0;
  const r0 = Number(f.values.retention) || 0;
  const isItemised = g0 > 0 || t0 > 0 || r0 > 0;
  const netPreview = g0 - t0 - r0;
  const add = async () => {
    const voucher = f.values.voucher;
    // Bill math first: itemised net is the computed preview (shown
    // read-only); otherwise the hand-typed net applies. The validator below
    // receives the resolved net — the read-only display never writes back
    // into form state on its own.
    const net = isItemised ? netPreview : (Number(f.values.net) || 0);
    // Server requires net > 0 (OUT_OF_RANGE otherwise) — stop here with a
    // clear message instead of a bare code after the round-trip.
    if (!(net > 0)) { const m = tx("खुद रकम ० भन्दा बढी हुनुपर्छ — कुल वा खुद भर्नुहोस्", "Net must be greater than 0 — enter Gross or Net", lang); toast(m, "err"); return; }
    const r = await f.submit("expenditure", { net });
    if (!r.ok) return;
    const [contractId, milestoneId] = String(f.values.milestone || "").split("|");
    // Work follows the milestone's contract (locked in the form, enforced on
    // the server) — falls back to the hand-picked work for non-contract bills.
    const workId = linkedWork || f.values.work;
    const saved = await mutate("/api/data/expenditures", { method: "POST",
      body: { doc: { voucher, work: workId, contractId: contractId || "", milestoneId: milestoneId || "", billNo: f.values.billNo || voucher, billDate: new Date().toISOString().slice(0, 10), payee: "—", physicalPct: Number(f.values.physicalPct) || 0, measurement: String(f.values.measurement || "").trim(), gross: isItemised ? g0 : undefined, tds: isItemised ? t0 : undefined, retention: isItemised ? r0 : undefined, net, status: "DRAFT", date: kathmanduDayKey(new Date()) } },
      okMsg: `${voucher} · ${tx("खर्च थपियो", "Expenditure added", lang)}`,
      toast, reload });
    if (!saved.ok) return;
    f.set("voucher")(""); f.set("work")(""); f.set("billNo")(""); f.set("milestone")(""); f.set("physicalPct")(""); f.set("measurement")(""); f.set("gross")(""); f.set("tds")(""); f.set("retention")(""); f.set("net")("");
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{tx("खर्च", "Expenditures", lang)}</h1>
      <Card title={tx("सूची — प्रमाणीकरण (शाखा) → भुक्तानी स्वीकृति (विभाग)", "List — verify (section) → payment approval (dept)", lang)}>
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : <>
        <ListToolbar ctl={ctl} lang={lang} filters={[{ key: "status", label: tx("स्थिति", "Status", lang), options: ["DRAFT", "SUBMITTED", "VERIFIED", "APPROVED", "RETURNED", "REVERSED"].map((s) => ({ value: s, label: s })) }]}
          sortOptions={[{ value: "date", label: tx("मिति", "Date", lang) }]} onExport={() => exportCsv("expenditures", ["Voucher", "Work", "Payee", "Net", "Status"], ctl.pageRows.map((r) => [r.voucher, r.work, r.payee, r.net, r.status]))} />
        <div className="mt-2">
        <Table cols={[tx("भौचर", "Voucher", lang), tx("बिल", "Bill", lang), tx("कार्य", "Work", lang), tx("खुद", "Net", lang), tx("स्थिति", "Status", lang), tx("टिप्पणी", "Notes", lang), tx("भुक्तानी", "Paid", lang), tx("कार्य", "Action", lang)]}
          rows={ctl.pageRows.map((v) => [v.voucher,
            <span key={v.voucher + "b"}>{v.billNo || "—"}{v.milestoneId ? ` · ${v.milestoneId}` : ""}<span className="block text-[11px] font-normal text-slate-500">{v.measurement || "—"}{v.physicalPct ? ` · ${v.physicalPct}%` : ""}</span></span>,
            v.work, Number(v.net).toLocaleString("en-IN"), <StatusChip key={v.voucher} status={v.status} lang={lang} />,
            <span key={v.voucher + "n"} className="block max-w-44 whitespace-normal text-[11px] text-slate-600">
              {v.submitNote ? <span className="block">📤 {v.submitNote}</span> : null}
              {v.decisionNote ? <span className="block font-semibold text-slate-800">✅ {v.decidedBy ? `${v.decidedBy}: ` : ""}{v.decisionNote}</span> : null}
              {!v.submitNote && !v.decisionNote ? "—" : null}
            </span>,
            v.paidDate ? `✅ ${v.paidDate}` : "—",
            boxAllow ? (
            <div key={v.voucher + "a"} className="max-w-56"><TransitionBox recordType="expenditure" status={v.status} lang={lang} allow={boxAllow} onStatus={(next, _r, note) => setStatus(v.voucher, next, v, note)} />
            {canPay && v.status === "APPROVED" && !v.paidDate && <button onClick={() => recordPayment(v)} className="mt-1 rounded border px-2 py-0.5 text-xs font-bold text-emerald-700">{tx("भुक्तानी लेख्नुहोस्", "Record payment", lang)}</button>}</div>
            ) : <span key={v.voucher + "a"} className="text-xs text-slate-400">—</span>])} />
        </div>
        <Pager ctl={ctl} lang={lang} />
        </>}
      </Card>
      <Card title={tx("प्रविष्टि (client + server मान्य)", "Enter (client + server validated)", lang)}>
        {canEnter ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label={tx("भौचर", "Voucher", lang)} error={f.errors.voucher} lang={lang} required><input value={f.values.voucher} onChange={f.set("voucher")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
          <Field label={tx("कार्य", "Work", lang)} error={f.errors.work} lang={lang} required>
            <select value={linkedWork || f.values.work} onChange={f.set("work")} disabled={!!linkedWork} title={linkedWork ? tx("माइलस्टोनको सम्झौताबाट स्वतः", "Auto from the milestone's contract", lang) : ""} className={`mt-1 w-full rounded-lg border px-2 py-1.5 ${linkedWork ? "bg-slate-100 font-bold" : ""}`}>
              <option value="">—</option>
              {(worksQ.data || []).map((w) => <option key={w.id} value={w.id}>{w.id} · {lang === "ne" ? w.titleNe : w.titleEn}</option>)}
            </select>
            {linkedWork && <p className="mt-1 text-[11px] font-bold text-emerald-700">{tx("कार्य स्वतः", "Work auto", lang)}: {linkedWork}</p>}
          </Field>
          <Field label={tx("बिल नं.", "Bill no.", lang)} lang={lang}><input value={f.values.billNo} onChange={f.set("billNo")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
          <Field label={tx("माइलस्टोन", "Milestone", lang)} lang={lang}>
            <select value={f.values.milestone} onChange={(e) => pickMilestone(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5">
              <option value="">—</option>
              {milestoneOptions.map((m) => <option key={`${m.contractId}|${m.milestoneId}`} value={`${m.contractId}|${m.milestoneId}`}>{m.label}</option>)}
            </select>
            {milestoneOptions.length === 0 && <p className="mt-1 text-[11px] text-amber-700">{tx("माइलस्टोन छैन — पहिले खरिदमा सम्झौता बनाउनुहोस्।", "No milestones — create a contract under Procurement first.", lang)}</p>}
          </Field>
          <Field label={tx("भौतिक % (नापी)", "Physical % (measured)", lang)} lang={lang}><input type="number" min={0} max={100} value={f.values.physicalPct} onChange={f.set("physicalPct")} placeholder="20" className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
          <Field label={tx("नापी किताब", "Measurement book", lang)} lang={lang}><input value={f.values.measurement} onChange={f.set("measurement")} placeholder="MB-01" className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
          <Field label={tx("कुल (gross)", "Gross", lang)} lang={lang}><input type="number" min={0} value={f.values.gross} onChange={f.set("gross")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
          <Field label="TDS" lang={lang}><input type="number" min={0} value={f.values.tds} onChange={f.set("tds")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
          <Field label={tx("धरौटी", "Retention", lang)} lang={lang}><input type="number" min={0} value={f.values.retention} onChange={f.set("retention")} className="mt-1 w-full rounded-lg border px-2 py-1.5" /></Field>
          <Field label={tx("खुद (gross−tds−retention)", "Net (gross−tds−retention)", lang)} lang={lang}><input type="number" value={isItemised ? netPreview : f.values.net} onChange={f.set("net")} readOnly={isItemised} title={isItemised ? tx("स्वतः गणना", "Auto-calculated", lang) : ""} className={`mt-1 w-full rounded-lg border px-2 py-1.5 ${isItemised ? "bg-slate-100 font-bold" : ""}`} /></Field>
          <div className="flex items-end"><button onClick={add} className="rounded-lg bg-nepal-blue px-4 py-2 text-xs font-bold text-white">{t("add", lang)}</button></div>
        </div>
        ) : (
        <p className="text-[13px] text-slate-500">{tx("खर्च प्रविष्टि विभाग / महाशाखाले गर्छ — स्वीकृति शाखाले, भुक्तानी वित्तले।", "Expenditure entry is done by departments / mahashakhas — approval by section, payment by finance.", lang)}</p>
        )}
        <div className="mt-2"><ServerErrors errors={f.serverErrors} lang={lang} /></div>
      </Card>
    </div>
  );
}
