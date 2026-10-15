"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import TransitionBox from "@/components/transitions";
import { useCollection, Loading } from "@/lib/use-data";
import { PROC_STAGES } from "@/lib/lifecycle";
import { kathmanduDayKey } from "@/lib/progress";
import { mutate } from "@/lib/mutate";
import { useProcurementRole } from "@/lib/procurement";

// Tender notice details (notice no/date, e-GP ref, deadline, method,
// estimate) — persisted to the package.
function TenderForm({ p, lang, onSave }) {
  const { toast } = useApp();
  const [noticeNo, setNoticeNo] = useState(p.noticeNo || "");
  const [noticeDate, setNoticeDate] = useState(p.noticeDate || "");
  const [deadline, setDeadline] = useState(p.deadline || "");
  const [egp, setEgp] = useState(p.egp || "");
  const [method, setMethod] = useState(p.method || "NCB");
  const [estimate, setEstimate] = useState(p.estimate ?? "");
  const [msg, setMsg] = useState("");
  const save = async () => {
    const r = await onSave({ noticeNo: noticeNo.trim(), noticeDate, deadline, egp: egp.trim(), method, estimate: Number(estimate) || 0 }, tx("सूचना जारी", "Notice issued", lang));
    if (!r?.ok) setMsg(r?.code || "SAVE_FAILED");
    else setMsg("");
  };
  const inp = "mt-1 w-full rounded-lg border px-2 py-1.5 text-xs font-normal";
  return (
    <Card title={<span><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-nepal-blue text-[11px] font-black text-white">1</span>{tx("टेन्डर सूचना", "Tender notice", lang)}</span>}>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs font-bold text-slate-600">{tx("सूचना नं.", "Notice no.", lang)}<input value={noticeNo} onChange={(e) => setNoticeNo(e.target.value)} className={inp} /></label>
        <label className="text-xs font-bold text-slate-600">{tx("सूचना मिति", "Notice date", lang)}<input type="date" value={noticeDate} onChange={(e) => setNoticeDate(e.target.value)} className={inp} /></label>
        <label className="text-xs font-bold text-slate-600">{tx("म्याद", "Deadline", lang)}<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inp} /></label>
        <label className="text-xs font-bold text-slate-600">eGP<input value={egp} onChange={(e) => setEgp(e.target.value)} className={inp} /></label>
        <label className="text-xs font-bold text-slate-600">{tx("विधि", "Method", lang)}<select value={method} onChange={(e) => setMethod(e.target.value)} className={inp}>{["NCB", "Sealed Quotation", "Direct Purchase", "Framework"].map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="text-xs font-bold text-slate-600">{tx("अनुमान (NPR)", "Estimate (NPR)", lang)}<input type="number" min={0} value={estimate} onChange={(e) => setEstimate(e.target.value)} className={inp} /></label>
      </div>
      <div className="mt-2 flex items-center gap-2"><button onClick={save} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">{tx("सूचना सेभ", "Save notice", lang)}</button>{msg && <span className="font-mono text-xs font-bold">{msg}</span>}</div>
    </Card>
  );
}

// Bids: STAFF enters bidder+amount (entry only, after tender issue).
// Ranking is evaluation work: the SECTION head scores + evaluates (the
// Unit head may do it too) — whoever comes rank 1 takes the contract.
function BidsCard({ p, bids, lang, reloadBids, onSelect, canAddBid, canScore, canDeleteBid, noticePassed, locked }) {
  const { toast, user } = useApp();
  const [bidder, setBidder] = useState("");
  const [amount, setAmount] = useState("");
  const [scores, setScores] = useState({});
  const [msg, setMsg] = useState("");
  const add = async () => {
    setMsg("");
    if (!bidder.trim() || !(Number(amount) > 0)) { setMsg(tx("बोलपत्रदाता + रकम आवश्यक", "Bidder + amount required", lang)); return; }
    const r = await mutate("/api/data/bids", { method: "POST",
      body: { doc: { pkg: p.pkg, bidder: bidder.trim(), amount: Number(amount), score: 0, rank: null, orgUnitId: p.orgUnitId || "", orgAncestors: p.orgAncestors || [], orgPath: p.orgPath || "" } },
      okMsg: `${bidder.trim()} · ${tx("बोलपत्र थपियो", "Bid added", lang)}`, toast, reload: reloadBids });
    if (!r.ok) { setMsg(r.code || "CREATE_FAILED"); return; }
    setBidder(""); setAmount("");
  };
  // Random scores strictly tied to amount: the lowest amount always gets
  // 100, the highest gets 60, distinct amounts in between spread evenly —
  // so different amounts never share a score. Equal amounts share the
  // exact same score. Fully-tied bids are broken randomly in Evaluate.
  // Values stay editable until saved.
  const randomize = () => {
    setScores((s) => {
      const next = { ...s };
      if (!bids.length) return next;
      const amounts = [...new Set(bids.map((b) => Number(b.amount) || 0))].sort((a, b) => a - b);
      const byAmount = {};
      amounts.forEach((amt, i) => {
        byAmount[amt] = amounts.length === 1 ? 100 : Math.round(100 - (i * 40) / (amounts.length - 1));
      });
      for (const b of bids) next[b.bidder] = byAmount[Number(b.amount) || 0];
      return next;
    });
    // Force inputs to show the rolled values even where a saved score
    // exists (inputs are uncontrolled via defaultValue).
    setRoll((r) => r + 1);
  };
  const [roll, setRoll] = useState(0);
  // Department may delete a wrong/duplicate bid (server: dept-only, refused
  // after winner selection or once a contract exists; ranks are cleared so
  // Evaluate re-runs on the true set).
  const remove = async (name) => {
    setMsg("");
    try {
      if (!window.confirm(`${tx("पक्का मेट्ने?", "Delete for sure?", lang)} ${name}`)) return;
    } catch { return; }
    const r = await mutate("/api/data/bids", { method: "DELETE",
      body: { match: { pkg: p.pkg, bidder: name } },
      okMsg: `${name} · ${tx("मेटियो", "deleted", lang)}`, toast, reload: reloadBids });
    if (!r.ok) setMsg(r.code || "DELETE_FAILED");
  };
  const saveScores = async () => {
    setMsg("");
    for (const b of bids) {
      const s = scores[b.bidder];
      if (s == null || s === "") continue;
      const r = await mutate("/api/data/bids", { method: "PATCH",
        body: { match: { pkg: p.pkg, bidder: b.bidder }, update: { score: Number(s) }, __v: b.__v ?? 1 }, toast });
      if (!r.ok) { setMsg(r.code || "SAVE_FAILED"); return; }
    }
    setScores({});
    reloadBids();
    toast(tx("स्कोर सेभ", "Scores saved", lang));
  };
  // Rank + auto-select rank 1 (department only): whoever comes rank 1
  // takes the contract. Uses effective scores (typed/random drafts over
  // saved) and persists both score + rank, so randomize → Evaluate is one
  // flow. The selection record (by/at) keeps the audit trail; card 3 only
  // confirms this same rank-1 row.
  const evaluate = async () => {
    if (!bids.length) { setMsg(tx("बोलपत्र छैन", "No bids", lang)); return; }
    // Lowest amount first, higher score breaks amount ties, and bids tied
    // on BOTH are shuffled randomly — each Evaluate may pick a different
    // one of the fully-tied bids as rank 1.
    const ranked = [...bids]
      .map((b) => ({ ...b, score: scores[b.bidder] ?? b.score ?? 0, _r: Math.random() }))
      .sort((a, b) => (Number(a.amount) - Number(b.amount)) || (Number(b.score) - Number(a.score)) || (a._r - b._r))
      .map(({ _r, ...b }) => b);
    for (let i = 0; i < ranked.length; i += 1) {
      const b = ranked[i];
      const r = await mutate("/api/data/bids", { method: "PATCH",
        body: { match: { pkg: p.pkg, bidder: b.bidder }, update: { score: Number(b.score) || 0, rank: i + 1 }, __v: b.__v ?? 1 }, toast });
      if (!r.ok) { setMsg(r.code || "SAVE_FAILED"); return; }
    }
    const top = ranked[0];
    const s = await onSelect({ selection: { bidder: top.bidder, amount: Number(top.amount), rank: 1, by: user?.username || "", at: kathmanduDayKey(new Date()), note: "auto: rank 1" } }, `${top.bidder} · rank 1 · ${tx("छानियो", "selected", lang)}`);
    if (!s?.ok) { setMsg(s?.code || "SAVE_FAILED"); return; }
    setScores({});
    reloadBids();
    toast(`${top.bidder} · rank 1`);
  };
  return (
    <Card title={<span><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-nepal-blue text-[11px] font-black text-white">2</span>{tx("बोलपत्र + मूल्यांकन", "Bids + evaluation", lang)}</span>}>
      {bids.length === 0 && <p className="mb-2 text-[12px] text-slate-400">{tx("अहिलेसम्म कुनै बोलपत्र छैन — तल थप्नुहोस्।", "No bids yet — add below.", lang)}</p>}
      {locked && <p className="mb-2 text-[12px] font-bold text-slate-500">{tx("विजेता छानिसकियो — नयाँ बोलपत्र लक छ; स्कोर/मूल्यांकन फेरि चलाउन मिल्छ।", "Winner selected — new bids are locked; scores/evaluation may be re-run.", lang)}</p>}
      {!noticePassed && <p className="mb-2 text-[12px] font-bold text-amber-700">{tx("पहिले टेन्डर सूचना जारी गर्नुहोस् — त्यसपछि मात्र बोलपत्र थपिन्छ।", "Issue the tender notice first — bids open only after that.", lang)}</p>}
      <Table cols={[tx("बोलपत्रदाता", "Bidder", lang), tx("रकम", "Amount", lang), tx("स्कोर", "Score", lang), tx("क्रम", "Rank", lang), ...(canDeleteBid && !locked ? [""] : [])]}
        rows={bids.map((b) => [b.bidder, (Number(b.amount) || 0).toLocaleString("en-IN"),
          <input key={`${b.bidder}-${roll}`} type="number" min={0} max={100} defaultValue={scores[b.bidder] ?? b.score ?? ""} readOnly={!canScore} onChange={(e) => setScores((s) => ({ ...s, [b.bidder]: e.target.value }))} className="w-16 rounded border px-1 py-0.5 text-xs" />,
          b.rank ?? "—",
          ...(canDeleteBid && !locked ? [<button key={`${b.bidder}-x`} onClick={() => remove(b.bidder)} title={tx("बोलपत्र मेट्नुहोस्", "Delete bid", lang)} className="rounded-lg border px-2 py-0.5 text-xs font-bold text-red-600">✕</button>] : [])])} />
      <div className="mt-2 flex flex-wrap items-end gap-2 text-xs">
        {canAddBid && (<>
        <label className="font-bold text-slate-600">{tx("बोलपत्रदाता", "Bidder", lang)}<input value={bidder} onChange={(e) => setBidder(e.target.value)} className="mt-1 block rounded-lg border px-2 py-1.5 font-normal" /></label>
        <label className="font-bold text-slate-600">{tx("रकम (NPR)", "Amount (NPR)", lang)}<input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 block w-32 rounded-lg border px-2 py-1.5 font-normal" /></label>
        <button onClick={add} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">+ {tx("बोलपत्र", "Bid", lang)}</button>
        </>)}
        {canScore && <button onClick={saveScores} className="rounded-lg border px-3 py-1.5 font-bold">{tx("स्कोर सेभ", "Save scores", lang)}</button>}
        {canScore && <button onClick={randomize} title={tx("अनियमित स्कोर 60–100; सबैभन्दा कम रकम क्रम १", "Random scores 60–100; lowest amount ranks 1", lang)} className="rounded-lg border border-dashed px-3 py-1.5 font-bold">🎲 {tx("अनियमित स्कोर", "Random scores", lang)}</button>}
        {canScore && <button onClick={evaluate} className="rounded-lg bg-nepal-blue px-3 py-1.5 font-bold text-white">{tx("मूल्यांकन (क्रम + rank-1 छनोट)", "Evaluate (rank + select rank-1)", lang)}</button>}
      </div>
      {msg && <p className="mt-1 font-mono text-xs font-bold">{msg}</p>}
    </Card>
  );
}

// Winner confirmation (Section head executes, Unit head may too):
// Evaluate records rank 1; the rank-1 bidder is the contractor —
// no other bid may be selected. LOI and contract both require this.
function SelectionCard({ p, bids, lang, onSave, canSelect, evalPassed, rankedCount }) {
  const { toast, user } = useApp();
  const ordered = [...bids].sort((a, b) => (Number(a.rank ?? 999) - Number(b.rank ?? 999)) || (Number(a.amount) - Number(b.amount)));
  const rankOne = ordered.find((b) => b.rank === 1) || ordered[0];
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const sel = p.selection;
  if (!canSelect) return null;
  const save = async () => {
    setMsg("");
    if (!rankOne) { setMsg(tx("बोलपत्र छान्नुहोस्", "Choose a bid", lang)); return; }
    const r = await onSave({ selection: { bidder: rankOne.bidder, amount: Number(rankOne.amount), rank: 1, by: user?.username || "", at: kathmanduDayKey(new Date()), note: note.trim() } }, `${rankOne.bidder} · ${tx("विजेता छानियो", "selected", lang)}`);
    if (!r?.ok) setMsg(r?.code || "SAVE_FAILED");
    else { setMsg(""); setNote(""); }
  };
  const clear = async () => {
    if (p.loiNo) { setMsg(tx("LOI जारी भइसक्यो — छनोट हटाउन मिल्दैन", "LOI already issued — selection is final", lang)); return; }
    const r = await onSave({ selection: null }, tx("छनोट हटाइयो", "Selection cleared", lang));
    if (!r?.ok) setMsg(r?.code || "SAVE_FAILED"); else setMsg("");
  };
  return (
    <Card title={<span><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-nepal-blue text-[11px] font-black text-white">3</span>{tx("विजेता छनोट", "Winner selection", lang)}</span>}>
      {!evalPassed && <p className="mb-2 text-[12px] font-bold text-amber-700">{tx("पहिले मूल्यांकन चरण पूरा गर्नुहोस्।", "Complete the EVALUATION stage first.", lang)}</p>}
      {rankedCount === 0 && <p className="mb-2 text-[12px] font-bold text-amber-700">{tx("पहिले बोलपत्र मूल्यांकन (क्रम) गर्नुहोस्।", "Rank the bids (Evaluate) first.", lang)}</p>}
      {sel?.bidder && <p className="mb-2 text-[13px] font-bold text-emerald-700">✅ {sel.bidder} · {(Number(sel.amount) || 0).toLocaleString("en-IN")}{sel.by ? ` · ${sel.by}` : ""}{sel.note ? ` · ${sel.note}` : ""}</p>}
      {evalPassed && rankedCount > 0 && !p.loiNo && (
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <div className="font-bold text-slate-600">{tx("विजेता (क्रम १)", "Winner (rank 1)", lang)}
            <p className="mt-1 block rounded-lg bg-slate-100 px-2 py-1.5 font-normal">{rankOne ? `#1 ${rankOne.bidder} · ${(Number(rankOne.amount) || 0).toLocaleString("en-IN")}` : "—"}</p>
          </div>
          <label className="min-w-40 flex-1 font-bold text-slate-600">{tx("टिप्पणी", "Note", lang)}<input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-full rounded-lg border px-2 py-1.5 font-normal" /></label>
          <button onClick={save} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">{tx("क्रम-१ लाई छान्नुहोस्", "Confirm rank-1", lang)}</button>
          {sel?.bidder && <button onClick={clear} className="rounded-lg border px-3 py-1.5 font-bold text-red-600">{tx("छनोट हटाउनुहोस्", "Clear", lang)}</button>}
        </div>
      )}
      {msg && <p className="mt-1 font-mono text-xs font-bold">{msg}</p>}
    </Card>
  );
}

// Committee decision + Letter of Intent on the package — LOI issues ONLY
// after an explicit winner selection exists.
function CommitteeLoi({ p, lang, onSave }) {
  const [decision, setDecision] = useState(p.committee?.decision || "");
  const [decDate, setDecDate] = useState(p.committee?.date || "");
  const [loiNo, setLoiNo] = useState(p.loiNo || "");
  const [loiDate, setLoiDate] = useState(p.loiDate || "");
  const [msg, setMsg] = useState("");
  const hasSelection = !!p.selection?.bidder;
  const saveCommittee = async () => {
    if (!decision.trim()) { setMsg(tx("निर्णय आवश्यक", "Decision required", lang)); return; }
    const r = await onSave({ committee: { decision: decision.trim(), date: decDate || kathmanduDayKey(new Date()) } }, tx("निर्णय सेभ", "Decision saved", lang));
    if (!r?.ok) setMsg(r?.code || "SAVE_FAILED"); else setMsg("");
  };
  const issueLoi = async () => {
    if (!hasSelection) { setMsg(tx("पहिले विजेता छान्नुहोस्", "Select a winner first", lang)); return; }
    if (!loiNo.trim()) { setMsg("LOI_NO_REQUIRED"); return; }
    const r = await onSave({ loiNo: loiNo.trim(), loiDate: loiDate || kathmanduDayKey(new Date()) }, `LOI ${loiNo.trim()} · ${tx("जारी", "issued", lang)}`);
    if (!r?.ok) setMsg(r?.code || "SAVE_FAILED"); else setMsg("");
  };
  const inp = "mt-1 w-full rounded-lg border px-2 py-1.5 text-xs font-normal";
  return (
    <Card title={<span><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-nepal-blue text-[11px] font-black text-white">3</span>{tx("समिति निर्णय + LOI", "Committee decision + LOI", lang)}</span>}>
      <label className="block text-xs font-bold text-slate-600">{tx("समिति निर्णय", "Committee decision", lang)}<textarea value={decision} onChange={(e) => setDecision(e.target.value)} rows={2} className={inp} /></label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs font-bold text-slate-600">{tx("मिति", "Date", lang)}<input type="date" value={decDate} onChange={(e) => setDecDate(e.target.value)} className={inp} /></label>
        <div className="flex items-end"><button onClick={saveCommittee} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white">{tx("निर्णय सेभ", "Save decision", lang)}</button></div>
        <label className="text-xs font-bold text-slate-600">LOI No.<input value={loiNo} onChange={(e) => setLoiNo(e.target.value)} className={inp} /></label>
        <label className="text-xs font-bold text-slate-600">LOI {tx("मिति", "date", lang)}<input type="date" value={loiDate} onChange={(e) => setLoiDate(e.target.value)} className={inp} /></label>
      </div>
      <div className="mt-2 flex items-center gap-2"><button onClick={issueLoi} disabled={!hasSelection} title={!hasSelection ? tx("पहिले विजेता छान्नुहोस्", "Select a winner first", lang) : ""} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">LOI {tx("जारी", "Issue", lang)}</button>{msg && <span className="font-mono text-xs font-bold">{msg}</span>}</div>
      {!hasSelection && <p className="mt-1 text-[11px] font-bold text-amber-700">{tx("LOI विजेता छनोटपछि मात्र जारी हुन्छ।", "LOI issues only after winner selection.", lang)}</p>}
      {p.committee?.decision && <p className="mt-2 text-xs text-slate-600">✓ {p.committee.decision} · {p.committee.date || ""}</p>}
    </Card>
  );
}

// Create the contract from the winner selection (always rank 1 — the
// Section head drafts it here, the Unit head approves it to ACTIVE):
// contractor + amount are locked to the rank-1 bid, must stay within
// the approved estimate, and the contract opens as PENDING_APPROVAL —
// ACTIVE only after approval.
function ContractCreate({ p, lang, reloadContracts }) {
  const { toast } = useApp();
  const sel = p.selection;
  const [retPct, setRetPct] = useState(5);
  const [miles, setMiles] = useState([{ name: "Mobilization", pct: 10 }, { name: "Implementation", pct: 80 }, { name: "Handover", pct: 10 }]);
  const [msg, setMsg] = useState("");
  const ready = !!sel?.bidder && !!p.loiNo;
  const winAmount = Number(sel?.amount) || 0;
  const sum = miles.reduce((a, m) => a + (Number(m.pct) || 0), 0);
  // Budget ceiling (always higher than contractor): work budget + budget-line
  // revised form the cap; other contracts on the same work count in total.
  const worksQ = useCollection("works");
  const budgetQ = useCollection("budget");
  const contractsQ = useCollection("contracts");
  const work = (worksQ.data || []).find((w) => w.id === p.work);
  const line = (budgetQ.data || []).find((b) => work?.subhead && b.subhead === work.subhead);
  const workBudget = Number(work?.budgetPaisa) || 0;
  const lineRevised = Number(line?.revised) || 0;
  const caps = [workBudget, lineRevised].filter((n) => n > 0);
  const ceiling = caps.length ? Math.min(...caps) : 0;
  const otherTotal = (contractsQ.data || []).filter((c) => c.work === p.work && c.id !== `C-${p.pkg}`).reduce((a, c) => a + (Number(c.amount) || 0), 0);
  const overBudget = ceiling > 0 && winAmount + otherTotal > ceiling;
  const create = async () => {
    setMsg("");
    if (!sel?.bidder) { setMsg(tx("पहिले विजेता छान्नुहोस्", "Select a winner first", lang)); return; }
    if (!p.loiNo) { setMsg(tx("पहिले LOI जारी गर्नुहोस्", "Issue the LOI first", lang)); return; }
    if (!(winAmount > 0)) { setMsg(tx("सम्झौता रकम आवश्यक", "Contract amount required", lang)); return; }
    const est = Number(p.estimate) || 0;
    if (est > 0 && winAmount > est) { setMsg(`CONTRACT_EXCEEDS_ESTIMATE (Σ=${winAmount} > ${est})`); return; }
    if (overBudget) { setMsg(`CONTRACT_EXCEEDS_BUDGET (${winAmount.toLocaleString("en-IN")} + ${otherTotal.toLocaleString("en-IN")} > ${ceiling.toLocaleString("en-IN")})`); return; }
    if (Math.abs(sum - 100) > 0.001) { setMsg(`WEIGHTS_NOT_100 (Σ=${sum})`); return; }
    const id = `C-${p.pkg}`;
    const retention = Math.round((winAmount * (Number(retPct) || 0)) / 100);
    const res = await mutate("/api/data/contracts", { method: "POST",
      body: { doc: { id, pkg: p.pkg, work: p.work, contractor: sel.bidder, amount: winAmount, retention, retentionReleased: false, status: "PENDING_APPROVAL", orgUnitId: p.orgUnitId || "", orgAncestors: p.orgAncestors || [], orgPath: p.orgPath || "",
        milestones: miles.map((m, i) => ({ id: `${id}-M${i + 1}`, name: m.name, pct: Number(m.pct), amount: Math.round((winAmount * Number(m.pct)) / 100), paid: false, retentionReleased: false })),
        securities: [], variations: [] } },
      okMsg: `${id} · ${tx("सम्झौता बन्यो — स्वीकृति बाँकी", "Contract drafted — approval pending", lang)}`, toast, reload: reloadContracts });
    if (!res.ok) setMsg(res.code || "CREATE_FAILED");
  };
  const inp = "mt-1 w-full rounded-lg border px-2 py-1.5 text-xs font-normal";
  return (
    <Card title={<span><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-nepal-blue text-[11px] font-black text-white">5</span>{tx("सम्झौता बनाउनुहोस्", "Create contract", lang)}</span>}>
      {!sel?.bidder && <p className="mb-2 text-[12px] font-bold text-amber-700">{tx("मूल्यांकन चलाउनुहोस् — rank-1 स्वतः छानिन्छ।", "Run Evaluate — rank-1 is auto-selected.", lang)}</p>}
      {sel?.bidder && !p.loiNo && <p className="mb-2 text-[12px] font-bold text-amber-700">{tx("पहिले LOI जारी गर्नुहोस्।", "Issue the LOI first.", lang)}</p>}
      {ceiling > 0 && (
        <p className={`mb-2 text-[12px] font-bold ${overBudget ? "text-red-700" : "text-emerald-700"}`}>
          {tx("बजेट", "Budget", lang)} {ceiling.toLocaleString("en-IN")} · {tx("ठेक्का", "Contract", lang)} {winAmount.toLocaleString("en-IN")}{otherTotal > 0 ? ` + ${otherTotal.toLocaleString("en-IN")}` : ""} {overBudget ? `— ❌ CONTRACT_EXCEEDS_BUDGET` : "— ✅"}
          <span className="font-normal text-slate-500"> ({tx("कार्य", "Work", lang)} {workBudget ? workBudget.toLocaleString("en-IN") : "—"} · {tx("लाइन", "Line", lang)} {line?.subhead || "—"} {lineRevised ? lineRevised.toLocaleString("en-IN") : "—"})</span>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="text-xs font-bold text-slate-600">{tx("ठेकेदार (छनोटबाट)", "Contractor (from selection)", lang)}<p className="mt-1 rounded-lg bg-slate-100 px-2 py-1.5 font-normal">{sel?.bidder || "—"}</p></div>
        <div className="text-xs font-bold text-slate-600">{tx("सम्झौता रकम (छनोटबाट)", "Amount (from selection)", lang)}<p className="mt-1 rounded-lg bg-slate-100 px-2 py-1.5 font-normal">{winAmount ? winAmount.toLocaleString("en-IN") : "—"}</p></div>
        <label className="text-xs font-bold text-slate-600">{tx("धरौटी %", "Retention %", lang)}<input type="number" min={0} max={100} value={retPct} onChange={(e) => setRetPct(e.target.value)} disabled={!ready} className={inp} /></label>
      </div>
      <div className="mt-2 text-xs font-bold text-slate-600">{tx("भुक्तानी माइलस्टोन (Σ=100%)", "Payment milestones (Σ=100%)", lang)}</div>
      {miles.map((m, i) => (
        <div key={i} className="mt-1 flex gap-2">
          <input value={m.name} onChange={(e) => setMiles((ms) => ms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="flex-1 rounded-lg border px-2 py-1.5 text-xs" />
          <input type="number" min={0} max={100} value={m.pct} onChange={(e) => setMiles((ms) => ms.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) } : x)))} className="w-20 rounded-lg border px-2 py-1.5 text-xs" />
          <button onClick={() => setMiles((ms) => ms.filter((_, j) => j !== i))} className="rounded-lg border px-2 py-1.5 text-xs font-bold text-red-600">✕</button>
        </div>
      ))}
      <div className="mt-2 flex items-center gap-2">
        <button onClick={() => setMiles((ms) => [...ms, { name: "", pct: 0 }])} disabled={!ready} className="rounded-lg border px-2 py-1.5 text-xs font-bold disabled:opacity-40">+ {tx("माइलस्टोन", "Milestone", lang)}</button>
        <span className="text-xs text-slate-500">Σ = {sum} / 100</span>
        <button onClick={create} disabled={!ready || overBudget} title={overBudget ? "CONTRACT_EXCEEDS_BUDGET" : ""} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">{tx("सम्झौता बनाउनुहोस्", "Create contract", lang)}</button>
      </div>
      {msg && <p className="mt-1 font-mono text-xs font-bold">{msg}</p>}
    </Card>
  );
}

export default function ProcDetail({ params }) {
  const { lang, toast, role, user } = useApp();
  const router = useRouter();
  // Authority matrix (same as /procurements list + server gate):
  // Staff enters bids · Section head evaluates + confirms rank-1 + LOI +
  // drafts contract (Unit head may do these too) · Unit head approves the
  // contract to ACTIVE. Ministry-level roles (MINISTRY_ADMIN / APPROVER) +
  // finance/audit/viewers are monitor-only here — they can read everything
  // but every write is refused server-side with PERMISSION_DENIED.
  const { isPreparer, isReviewer, isDeptApprover } = useProcurementRole(role, user);
  const isInserter = isPreparer;
  const isStageActor = isReviewer || isDeptApprover;
  const isDept = isDeptApprover;
  const isMonitorOnly = !isInserter && !isStageActor;
  const { id } = use(params);
  const procs = useCollection("procurements");
  const bidsQ = useCollection("bids");
  const contractsQ = useCollection("contracts");
  const PROCUREMENTS = procs.data, BIDS = bidsQ.data;
  const loading = procs.loading || bidsQ.loading || contractsQ.loading;
  const error = procs.error || bidsQ.error || contractsQ.error;
  const p = PROCUREMENTS.find((x) => x.pkg === decodeURIComponent(id));
  // Stage map: derive from the `stage` pointer, then overlay the stored
  // `stages` map — a partial stored map can never blank chips back to grey.
  const baseStages = (() => {
    const m = {};
    const idx = Math.max(0, PROC_STAGES.indexOf(p?.stage));
    PROC_STAGES.forEach((s, i) => { m[s] = i < idx ? "DONE" : i === idx ? "IN_PROGRESS" : "PENDING"; });
    return { ...m, ...(p?.stages || {}) };
  })();
  const [edits, setEdits] = useState({});
  const stages = { ...baseStages, ...edits };
  const curIdx = PROC_STAGES.findIndex((s) => !["DONE", "SKIPPED"].includes(stages[s] || "PENDING"));
  const bids = p ? BIDS.filter((b) => b.pkg === p.pkg) : [];
  // Contract matched by package ONLY — the old work-fallback showed another
  // package's contract (same work) here once contracts loaded ("pppp" result
  // appearing after refresh). Legacy contracts without pkg still resolve.
  const contract = p ? contractsQ.data.find((c) => c.pkg === p.pkg || (!c.pkg && p.work && c.work === p.work)) : null;
  // Stage discipline for the forms (independent of the stage pointer):
  // bids open after NOTICE, selection needs EVALUATION + ranks.
  const stageDone = (s) => ["DONE", "SKIPPED"].includes(stages[s] || "PENDING");
  const noticePassed = p ? stageDone("NOTICE") : false;
  const evalPassed = p ? stageDone("EVALUATION") : false;
  const rankedCount = bids.filter((b) => b.rank != null).length;
  const selectionLocked = !!p?.selection?.bidder;
  const persist = async (nextStages, nextStage) => {
    if (!p) return null;
    return mutate("/api/data/procurements", { method: "PATCH",
      body: { match: { pkg: p.pkg }, update: { stages: nextStages, stage: nextStage, stageSince: kathmanduDayKey(new Date()) }, __v: p.__v ?? 1 },
      okMsg: `${p.pkg} → ${nextStage}`,
      toast, reload: procs.reload });
  };
  const saveFields = async (update, label) => {
    if (!p) return null;
    return mutate("/api/data/procurements", { method: "PATCH",
      body: { match: { pkg: p.pkg }, update, __v: p.__v ?? 1 },
      okMsg: `${p.pkg} · ${label}`,
      toast, reload: procs.reload });
  };
  // Section (and PMO) may delete the package — refused server-side once a
  // contract exists for it. Back to the list after deletion.
  const canDeletePkg = ["SUPER_ADMIN", "SECTION_HEAD"].includes(role);
  const removePkg = async () => {
    if (!p) return;
    try {
      if (!window.confirm(`${tx("पक्का मेट्ने? प्याकेज + बोलपत्र + सम्झौता (बिल भए हट्दैन)।", "Delete for sure? Package + bids + contract (kept if bills exist).", lang)} ${p.pkg}`)) return;
    } catch { return; }
    const res = await mutate("/api/data/procurements", { method: "DELETE",
      body: { match: { pkg: p.pkg } },
      okMsg: `${p.pkg} · ${tx("प्याकेज मेटियो", "Package deleted", lang)}`,
      toast });
    if (res.ok) router.push("/procurements");
  };
  if (loading) return <div className="space-y-3"><Card title="…"><Loading lang={lang} /></Card></div>;
  if (error || !p) return <div className="space-y-3"><Card title="…"><Loading error={error || "NOT_FOUND"} lang={lang} /></Card></div>;
  return (
    <div className="space-y-3">
      <Link href="/procurements" className="text-xs font-bold text-nepal-blue">← {tx("खरिद", "Procurement", lang)}</Link>
      {canDeletePkg && (
        <div className="no-print flex justify-end"><button onClick={removePkg} title={tx("स्थायी रूपमा मेट्नुहोस्", "Delete permanently", lang)} className="cursor-pointer rounded-lg border border-red-300 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50">🗑 {tx("प्याकेज मेट्नुहोस्", "Delete package", lang)}</button></div>
      )}
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-black">{p.pkg}</h1>
          <span className="rounded-full bg-nepal-blue px-3 py-1 text-[11px] font-black text-white">{stages[PROC_STAGES[curIdx]] ? `${PROC_STAGES[curIdx]} · ${stages[PROC_STAGES[curIdx]]}` : p.stage || "—"}</span>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
          {[
            [tx("कार्य", "Work", lang), p.work || "—"],
            [tx("विधि", "Method", lang), p.method || "—"],
            [tx("अनुमान", "Estimate", lang), `NPR ${(Number(p.estimate) || 0).toLocaleString("en-IN")}`],
            ["eGP", p.egp || "—"],
            [tx("सूचना", "Notice", lang), p.noticeNo ? `${p.noticeNo}${p.noticeDate ? ` · ${p.noticeDate}` : ""}` : "—"],
            [tx("म्याद", "Deadline", lang), p.deadline || "—"],
            ["LOI", p.loiNo ? `${p.loiNo}${p.loiDate ? ` · ${p.loiDate}` : ""}` : "—"],
            [tx("ठेकेदार", "Contractor", lang), contract?.contractor || p.bidder || "—"],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0 rounded-lg bg-slate-50 px-2.5 py-1.5">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{k}</dt>
              <dd className="truncate font-bold text-slate-800" title={String(v)}>{v}</dd>
            </div>
          ))}
        </dl>
        <ol className="mt-3 flex flex-wrap gap-1">
          {PROC_STAGES.map((s, i) => {
            const st = stages[s] || "PENDING";
            const cls = st === "DONE" ? "bg-emerald-600 text-white" : i === curIdx ? "bg-amber-400" : "bg-slate-100 text-slate-500";
            return <li key={s} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cls}`}>{s}</li>;
          })}
        </ol>
        {curIdx >= 0 && isStageActor && (
          <div className="mt-2 max-w-md"><TransitionBox recordType="procurement" status={stages[PROC_STAGES[curIdx]] || "PENDING"} lang={lang}
            onStatus={async (next) => {
              const nextStages = { ...stages, [PROC_STAGES[curIdx]]: next };
              const following = PROC_STAGES.find((s) => !["DONE", "SKIPPED"].includes(nextStages[s] || "PENDING")) || "COMPLETION";
              // Server state only: apply the local stage chip after the
              // PATCH succeeds — never optimistically.
              const res = await persist(nextStages, next === "CANCELLED" ? "CANCELLED" : following);
              if (res?.ok) setEdits((d) => ({ ...d, [PROC_STAGES[curIdx]]: next }));
            }} /></div>
        )}
        {isMonitorOnly && (
          <p className="mt-2 text-[12px] text-slate-400">{tx("पढ्ने मात्र — मन्त्रालय स्तरले अनुगमन मात्र गर्छ।", "Read-only — ministry level monitors only.", lang)}</p>
        )}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {isInserter && <TenderForm key={`tender-${p.pkg}`} p={p} lang={lang} onSave={saveFields} />}
        <BidsCard key={`bids-${p.pkg}`} p={p} bids={bids} lang={lang} reloadBids={bidsQ.reload} onSelect={saveFields}
          canAddBid={isInserter && noticePassed && !selectionLocked}
          canScore={(isDept || isReviewer) && noticePassed}
          canDeleteBid={isDept && noticePassed}
          noticePassed={noticePassed} locked={selectionLocked} />
      </div>
      {(isDept || isReviewer) && (
      <div className="grid gap-3 lg:grid-cols-2">
        <SelectionCard key={`sel-${p.pkg}`} p={p} bids={bids} lang={lang} onSave={saveFields}
          canSelect={isDept || isReviewer} evalPassed={evalPassed} rankedCount={rankedCount} />
        <CommitteeLoi key={`cl-${p.pkg}`} p={p} lang={lang} onSave={saveFields} />
        {!contract && <ContractCreate key={`cc-${p.pkg}`} p={p} lang={lang} reloadContracts={contractsQ.reload} />}
      </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("सम्झौता", "Contract", lang)} action={contract ? <Link href={`/contracts/${contract.id}`} className="text-xs font-bold text-nepal-blue">{contract.id} →</Link> : null}>
          {contract ? (
            <><div className="text-sm">{tx("ठेकेदार", "Contractor", lang)} {contract.contractor || p.selection?.bidder || "—"} · {tx("सम्झौता", "Contract", lang)} {(Number(contract.amount ?? p.selection?.amount) || 0).toLocaleString("en-IN")}</div>
            <div className="mt-1"><StatusChip status={contract.status || "PENDING_APPROVAL"} lang={lang} /></div></>
          ) : (
            <><div className="text-sm text-slate-500">{tx("अहिलेसम्म सम्झौता बनेको छैन", "No contract yet", lang)} — {tx("ठेकेदार", "Contractor", lang)} {p.selection?.bidder || "—"}{p.selection?.amount ? ` · ${(Number(p.selection.amount) || 0).toLocaleString("en-IN")}` : ""}</div>
            <div className="mt-1 text-[12px] font-bold text-amber-700">
              {!p.selection?.bidder
                ? tx("पहिले मूल्यांकन गरेर क्रम-१ छान्नुहोस्।", "Evaluate and confirm rank-1 first.", lang)
                : !p.loiNo
                  ? tx("पहिले LOI जारी गर्नुहोस्, त्यसपछि सम्झौता बनाउनुहोस्।", "Issue the LOI first, then create the contract.", lang)
                  : tx("तल ‘सम्झौता बनाउनुहोस्’ थिच्नुहोस् — स्वीकृतिपछि ACTIVE हुन्छ।", "Press ‘Create contract’ below — it turns ACTIVE after approval.", lang)}
            </div></>
          )}
        </Card>
      </div>
    </div>
  );
}
