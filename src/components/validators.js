"use client";
import { useState } from "react";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { errMsg } from "@/lib/errors";
import { weightsMust100, dateWithinParent, spendCheck, milestones100, percentRange, decreaseNeedsReason, stepComment, scanFile } from "@/lib/rules";

function Box({ title, children }) {
  return <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[13px]">{title && <div className="mb-1.5 text-xs font-black uppercase text-slate-500">{title}</div>}{children}</div>;
}
function Msg({ e, lang }) {
  if (!e) return <div className="mt-1 text-xs font-bold text-emerald-600">✅ {tx("मान्य", "Valid", lang)}</div>;
  return <div className="mt-1 text-xs font-bold text-red-600">❌ {e.code} — {errMsg(e.code, lang)}{e.details ? ` · ${JSON.stringify(e.details)}` : ""}</div>;
}

export function WeightChecker() {
  const { lang } = useApp();
  const [v, setV] = useState("10,20,40,15,15");
  const [e, setE] = useState(null);
  return <Box title={tx("तौल जाँच (WRK-06)", "Weight check (WRK-06)", lang)}>
    <input value={v} onChange={(e) => setV(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 font-mono" placeholder="10,20,40,15,15" />
    <button onClick={() => { try { weightsMust100(v.split(",").map(Number)); setE(null); } catch (err) { setE(err); } }} className="mt-1.5 rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white">{tx("जाँच", "Check", lang)}</button>
    <Msg e={e} lang={lang} />
  </Box>;
}

export function BudgetChecker() {
  const { lang } = useApp();
  const [amt, setAmt] = useState(1500000);
  const [e, setE] = useState(null);
  const line = { revisedPaisa: 10000000, committedPaisa: 6000000, spentPaisa: 3000000 }; // avail 10L
  return <Box title={tx("बजेट जाँच (BUD/TIP-05) — उपलब्ध १० लाख", "Budget check (BUD/TIP-05) — avail 10 lakh", lang)}>
    <input type="number" value={amt} onChange={(e) => setAmt(Number(e.target.value))} className="w-full rounded-lg border px-2 py-1.5 font-mono" />
    <button onClick={() => { try { spendCheck(line, 15000000, amt); setE(null); } catch (err) { setE(err); } }} className="mt-1.5 rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white">{tx("स्वीकृत गर्नुहोस्", "Approve", lang)}</button>
    <Msg e={e} lang={lang} />
  </Box>;
}

export function MilestoneChecker() {
  const { lang } = useApp();
  const [v, setV] = useState("25,25,25,25");
  const [e, setE] = useState(null);
  return <Box title={tx("माइलस्टोन जाँच (PRC-08)", "Milestone check (PRC-08)", lang)}>
    <input value={v} onChange={(e) => setV(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 font-mono" />
    <button onClick={() => { try { milestones100(v.split(",").map(Number)); setE(null); } catch (err) { setE(err); } }} className="mt-1.5 rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white">{tx("जाँच", "Check", lang)}</button>
    <Msg e={e} lang={lang} />
  </Box>;
}

export function ProgressChecker() {
  const { lang } = useApp();
  const [p, setP] = useState(60);
  const [e, setE] = useState(null);
  return <Box title={tx("प्रगति जाँच (PRG: ०–१००, घट्दा कारण)", "Progress check (PRG: 0–100, reason on decrease)", lang)}>
    <div className="flex gap-2"><input type="number" value={p} onChange={(e) => setP(Number(e.target.value))} className="w-full rounded-lg border px-2 py-1.5 font-mono" /></div>
    <button onClick={() => { try { percentRange(p); decreaseNeedsReason(p, 60, p < 60 ? "" : "ok"); setE(null); } catch (err) { setE(err); } }} className="mt-1.5 rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white">{tx("पेश", "Submit", lang)}</button>
    <Msg e={e} lang={lang} />
  </Box>;
}

export function TippaniChecker() {
  const { lang } = useApp();
  const [c, setC] = useState("");
  const [e, setE] = useState(null);
  return <Box title={tx("फिर्ता जाँच (TIP-03: टिप्पणी आवश्यक)", "Return check (TIP-03: comment required)", lang)}>
    <input value={c} onChange={(e) => setC(e.target.value)} placeholder={tx("फिर्ता टिप्पणी…", "Return comment…", lang)} className="w-full rounded-lg border px-2 py-1.5" />
    <button onClick={() => { try { stepComment("RETURN", c); setE(null); } catch (err) { setE(err); } }} className="mt-1.5 rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-white">{tx("फिर्ता", "Return", lang)}</button>
    <Msg e={e} lang={lang} />
  </Box>;
}

export function FileChecker() {
  const { lang } = useApp();
  const [n, setN] = useState("bill.pdf");
  const [e, setE] = useState(null);
  return <Box title={tx("फाइल जाँच (DOC-04: EICAR / नक्कली प्रकार)", "File check (DOC-04: EICAR / spoofed type)", lang)}>
    <input value={n} onChange={(e) => setN(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 font-mono" placeholder="eicar_test.txt / bill.exe.pdf" />
    <button onClick={() => { try { scanFile(n, n.endsWith(".pdf") ? "application/pdf" : n.includes("exe") ? "application/x-msdownload" : "text/plain"); setE(null); } catch (err) { setE(err); } }} className="mt-1.5 rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white">{tx("स्क्यान", "Scan", lang)}</button>
    <Msg e={e} lang={lang} />
  </Box>;
}

export function DateChecker() {
  const { lang } = useApp();
  const [s, setS] = useState("2027-06-01");
  const [e, setE] = useState(null);
  return <Box title={tx("मिति जाँच (WRK: child ≤ parent 2027-05-17)", "Date check (WRK: child ≤ parent 2027-05-17)", lang)}>
    <input type="date" value={s} onChange={(e) => setS(e.target.value)} className="w-full rounded-lg border px-2 py-1.5 font-mono" />
    <button onClick={() => { try { dateWithinParent({ start: "2026-08-01", end: s }, { start: "2026-07-17", end: "2027-05-17" }); setE(null); } catch (err) { setE(err); } }} className="mt-1.5 rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white">{tx("जाँच", "Check", lang)}</button>
    <Msg e={e} lang={lang} />
  </Box>;
}
