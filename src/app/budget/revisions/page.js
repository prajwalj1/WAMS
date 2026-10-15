"use client";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import TransitionBox from "@/components/transitions";
import { mutate } from "@/lib/mutate";

export default function Revisions() {
  const { lang, toast, user, role } = useApp();
  const { data, loading, error, reload } = useCollection("budgetrevisions");
  const budgetQ = useCollection("budget");
  const rows = data;
  const lines = budgetQ.data || [];
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const fromVal = from || lines[0]?.subhead || "";
  const toVal = to || lines[1]?.subhead || lines[0]?.subhead || "";
  const add = async () => {
    setMsg("");
    if (saving) return;
    const amt = Number(amount) || 0;
    if (lines.length === 0) { setMsg(tx("पहिले बजेट लाइन थप्नुहोस्", "Add budget lines first", lang)); return; }
    if (!fromVal || !toVal) { setMsg(tx("स्रोत र गन्तव्य छान्नुहोस्", "Pick source and destination", lang)); return; }
    if (fromVal === toVal) { setMsg(tx("स्रोत र गन्तव्य फरक हुनुपर्छ", "Source and destination must differ", lang)); return; }
    if (amt <= 0) { setMsg(tx("रकम सकारात्मक हुनुपर्छ", "Amount must be positive", lang)); return; }
    // The revision id (REV-YYYY-NN) is assigned server-side from DB truth —
    // never guessed from the visible list (that collided on stale lists).
    setSaving(true);
    try {
      const saved = await mutate("/api/data/budgetrevisions", { method: "POST",
        body: { doc: { from: fromVal, to: toVal, amount: amt, status: "REQUESTED" } },
        toast, reload });
      if (!saved.ok) { setMsg(saved.code || "CREATE_FAILED"); return; }
      toast(`${saved.refId || ""} · ${fromVal} → ${toVal} · ${tx("रकमान्तर अनुरोध", "Transfer requested", lang)}`, "ok");
      setAmount("");
    } finally {
      setSaving(false);
    }
  };
  // Decisions go through the transition endpoint: validated decision +
  // transfer-apply on approve (live availability check) + audit, one call.
  const setStatus = async (x, next) => {
    const action = next === "APPROVED" ? "approve" : next === "REJECTED" ? "reject" : null;
    if (!action) {
      await mutate("/api/data/budgetrevisions", { method: "PATCH",
        body: { match: { id: x.id }, update: { status: next }, __v: x.__v ?? 1 },
        okMsg: `${x.id} → ${next}`,
        toast, reload });
      return;
    }
    const res = await mutate(`/api/budget/revisions/${x.id}/transition`, { method: "POST",
      body: { action, actor: user?.username || "", scopeUnitIds: user?.scopeUnitIds, __v: x.__v ?? 1 },
      toast });
    if (!res.ok) return;
    toast(`${x.id} → ${res.status}${action === "approve" ? ` · ${tx("रकमान्तर लागू", "Transfer applied", lang)}` : ""}`);
    reload();
  };
  return (
    <div className="space-y-3">
      <Link href="/budget" className="text-xs font-bold text-nepal-blue">← {tx("बजेट", "Budget", lang)}</Link>
      <h1 className="text-xl font-black">{tx("रकमान्तर — अनुरोध र स्वीकृति", "Transfers — request & approve", lang)}</h1>
      <Card title={tx("रकमान्तर भनेको के हो", "What revisions are", lang)}>
        <div className="space-y-1.5 text-[13px] text-slate-600">
          <p>{tx("रकमान्तर / वृद्धि / कटौती — स्वीकृत बजेटपछि एक ब.उ.शी.नं. बाट अर्कोमा रकम सार्ने, वा लाइनको संशोधित रकम बढाउने/घटाउने।", "Transfer / increase / decrease — move money between sub-heads after approval, or raise/lower a line's revised figure.", lang)}</p>
          <p>{tx("नियम: खर्च + प्रतिबद्धता ≤ उपलब्ध रकम · पहिले स्वीकृति, अनि खर्च। स्वीकृत हुँदा रकमान्तर तुरुन्त लागू हुन्छ (स्रोत घट्छ, गन्तव्य बढ्छ) र अडिट लेखिन्छ।", "Rule: spending + commitments ≤ available · approval first, then spend. Approving applies the transfer at once (source down, destination up) and writes audit.", lang)}</p>
          <p>{tx("रुट: वित्त अधिकृतले तयार गर्छ → सचिव / महानिर्देशकले निर्णय गर्छ। अस्वीकृतिमा कारण आवश्यक।", "Route: finance officer prepares → Secretary / DG decides. Rejection needs a comment.", lang)}</p>
        </div>
      </Card>
      <Card title={tx("सूची", "List", lang)} action={<div className="no-print flex flex-wrap items-center gap-1.5">
        {budgetQ.loading ? <span className="text-xs text-slate-400">…</span> : lines.length === 0 ? (
          <span className="text-xs font-bold text-amber-700">{budgetQ.error || tx("बजेट लाइन छैन — पहिले थप्नुहोस्", "No budget lines yet — add them first", lang)} <Link href="/budget" className="text-nepal-blue">/budget →</Link></span>
        ) : (<>
        <select value={fromVal} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs">{lines.map((b) => <option key={b.subhead} value={b.subhead}>{b.subhead}</option>)}</select>
        <span className="text-xs text-slate-400">→</span>
        <select value={toVal} onChange={(e) => setTo(e.target.value)} className="rounded-lg border px-2 py-1.5 text-xs">{lines.map((b) => <option key={b.subhead} value={b.subhead}>{b.subhead}</option>)}</select>
        <input type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={tx("रकम", "Amount", lang)} className="w-28 rounded-lg border px-2 py-1.5 text-xs" />
        <button onClick={add} disabled={saving} className="rounded-lg bg-nepal-blue px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">+ {tx("अनुरोध", "Request", lang)}</button>
        </>)}
      </div>}>
        {msg && <p className="mb-1 font-mono text-xs font-bold">{msg}</p>}
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : (
        <Table cols={["ID", tx("बाट", "From", lang), tx("लाई", "To", lang), tx("रकम", "Amount", lang), tx("स्थिति", "Status", lang), tx("कार्य", "Action", lang)]}
          rows={rows.map((x) => [x.id, <Link key={x.id} href={`/budget/lines/${x.from}`} className="font-mono text-nepal-blue">{x.from}</Link>, x.to, Number(x.amount).toLocaleString("en-IN"), <StatusChip key={x.id} status={x.status} lang={lang} />,
            ["MINISTRY_ADMIN", "APPROVER"].includes(role)
              ? <div key={x.id + "a"} className="max-w-52"><TransitionBox recordType="budgetRevision" status={x.status} lang={lang} onStatus={(next) => setStatus(x, next)} /></div>
              : <span key={x.id + "a"} className="text-xs text-slate-400">—</span>])} />
        )}
      </Card>
    </div>
  );
}
