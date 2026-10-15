"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useApp, useWorkflow } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, RoutePreview } from "@/components/ui";
import { Field, ServerErrors, useForm, vRequired } from "@/components/forms";
import { matchApprovalRoute } from "@/lib/lifecycle";
import { useCollection } from "@/lib/use-data";
import { kathmanduDayKey } from "@/lib/progress";
import { mutate } from "@/lib/mutate";
import { ancestorsOfUnit } from "@/lib/scope";

export default function TippaniNew() {
  const { lang, user, toast } = useApp();
  const { routes } = useWorkflow();
  const tipsQ = useCollection("tippanis");
  const worksQ = useCollection("works");
  const budgetQ = useCollection("budget");
  const unitsQ = useCollection("units");
  const docsQ = useCollection("docs");
  const [done, setDone] = useState(null);
  const [apiErr, setApiErr] = useState("");
  const [workRef, setWorkRef] = useState("");
  const [subRef, setSubRef] = useState("");
  // TOR / supporting files attached to this draft (documents docIds).
  const [attach, setAttach] = useState([]);
  const f = useForm({ subject: "BUDGET_APPROVAL", amount: "", mode: "MINISTRY", paper: false }, { subject: vRequired });
  // Staff handoff: /documents (after TOR upload) and task pages link here
  // with ?work=&subject=&doc=. Read via window.location (not
  // useSearchParams) so no Suspense boundary is needed.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search || "");
      const w = q.get("work");
      const s = q.get("subject");
      const d = q.get("doc");
      if (w) setWorkRef(w);
      if (s) f.set("subject")(s);
      if (d) setAttach((a) => (a.includes(d) ? a : [...a, d]));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  let preview = null;
  try {
    preview = matchApprovalRoute({ subject: "BUDGET_APPROVAL", mode: f.values.mode, amountNpr: Number(f.values.amount) || 0 }, routes);
  } catch { preview = null; }
  const save = async (send) => {
    setApiErr("");
    const r = await f.submit("tippani-new", {});
    if (!r.ok) return;
    // Ref derives live from existing tippanis — never a fixed string.
    const tag = kathmanduDayKey(new Date()).slice(0, 4);
    const maxSeq = (tipsQ.data || []).reduce((a, x) => {
      const m = String(x.ref || "").match(new RegExp(`^TIP-${tag}-(\\d+)$`));
      return m ? Math.max(a, Number(m[1])) : a;
    }, 119);
    const ref = `TIP-${tag}-${maxSeq + 1}`;
    // Budget linkage: approving a tippani with a work + sub-head commits
    // the amount to that budget line. Empty = non-budget tippani, no commit.
    const linkedWork = (worksQ.data || []).find((w) => w.id === workRef);
    const subhead = subRef || linkedWork?.subhead || "";
    // Ancestors follow the linked work's unit (DB tree) so approvers in its
    // chain can see it; unlinked tippanis fall back to the creator's scope.
    const tipAncestors = linkedWork?.orgUnitId
      ? ancestorsOfUnit(linkedWork.orgUnitId, unitsQ.data || [])
      : (user?.scopeUnitIds?.length ? user.scopeUnitIds : (user?.unitId ? [user.unitId] : []));
    const res = await mutate("/api/data/tippanis", { method: "POST",
      body: { doc: { ref, subject: f.values.subject, amount: Number(f.values.amount) || 0, work: workRef || "", subhead, attachments: attach, step: preview?.steps?.[0]?.role || "—", waitDays: 0, stepSince: send ? kathmanduDayKey(new Date()) : null, status: send ? "IN_REVIEW" : "DRAFT", route: preview?.id || null, submitter: user?.username || "", orgUnitId: linkedWork?.orgUnitId || user?.unitId || "", orgAncestors: tipAncestors } },
      toast });
    if (!res.ok) { setApiErr(res.code || "CREATE_FAILED"); return; }
    tipsQ.reload();
    setDone({ ref, status: send ? "IN_REVIEW" : "DRAFT", route: preview?.id });
    toast(`${ref} · ${send ? tx("टिप्पणी पठाइयो", "Tippani sent", lang) : tx("ड्राफ्ट सेभ", "Draft saved", lang)}`);
  };
  return (
    <div className="space-y-3">
      <Link href="/tippani" className="text-xs font-bold text-nepal-blue">← {t("tippani", lang)}</Link>
      <h1 className="text-xl font-black">{t("newTippani", lang)}</h1>
      {done ? <Card title="✅"><p className="text-sm font-bold">{done.ref} · {done.status}{done.route ? ` · ${done.route}` : " · NO_ROUTE"}</p></Card> : (
        <Card title={tx("सम्पादक", "Editor", lang)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <div className="mb-1 flex flex-wrap gap-1">
                {["BUDGET_APPROVAL", "WORK", "REVISION", "COMPLETION", "BUDGET_REVISION"].map((s) => (
                  <button key={s} onClick={() => f.set("subject")(s)} className={`rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold ${f.values.subject === s ? "bg-nepal-blue text-white" : "bg-white text-slate-600"}`}>{s}</button>
                ))}
              </div>
              <Field label={tx("विषय", "Subject", lang)} error={f.errors.subject} lang={lang} required><input value={f.values.subject} onChange={f.set("subject")} className="mt-1 w-full rounded-lg border px-3 py-2" /></Field>
            </div>
            <Field label={tx("रकम (NPR)", "Amount (NPR)", lang)} lang={lang}><input type="number" value={f.values.amount} onChange={f.set("amount")} className="mt-1 w-full rounded-lg border px-3 py-2" /></Field>
            <Field label={tx("बजेट मोड", "Budget mode", lang)} lang={lang}>
              <select value={f.values.mode} onChange={f.set("mode")} className="mt-1 w-full rounded-lg border px-3 py-2"><option value="MINISTRY">MINISTRY</option><option value="OWN">OWN</option></select>
            </Field>
            <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={f.values.paper} onChange={(e) => f.set("paper")(e.target.checked)} />{tx("कागजी टिप्पणी रेकर्ड गर्नुहोस्", "Record paper Tippani", lang)}</label>
            <Field label={tx("कार्य (बजेट लिङ्क)", "Work (budget link)", lang)} lang={lang}>
              <select value={workRef} onChange={(e) => { setWorkRef(e.target.value); setSubRef(""); }} className="mt-1 w-full rounded-lg border px-3 py-2">
                <option value="">—</option>
                {(worksQ.data || []).map((w) => <option key={w.id} value={w.id}>{w.id} · {lang === "ne" ? w.titleNe : w.titleEn}</option>)}
              </select>
            </Field>
            <Field label={tx("ब.उ.शी.नं. (स्वीकृतिमा प्रतिबद्ध)", "Sub-head (committed on approval)", lang)} lang={lang}>
              <select value={subRef} onChange={(e) => setSubRef(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
                <option value="">{(worksQ.data || []).find((w) => w.id === workRef)?.subhead || "—"}</option>
                {(budgetQ.data || []).map((b) => <option key={b.subhead} value={b.subhead}>{b.subhead} — {b.name}</option>)}
              </select>
            </Field>
            <div className="sm:col-span-2">
              <div className="mb-1 text-xs font-bold text-slate-600">{tx("TOR / संलग्न फाइल (कार्यका कागजात)", "TOR / attachments (work documents)", lang)}</div>
              {(() => {
                const linked = (docsQ.data || []).filter((d) => workRef && (d.entity === workRef || (d.docId && attach.includes(d.docId))));
                if (!workRef) return <p className="text-xs text-slate-400">{tx("पहिले कार्य छान्नुहोस् — TOR सूची यहाँ देखिन्छ।", "Pick a work first — its TOR files list here.", lang)}</p>;
                if (!linked.length) return <p className="text-xs text-slate-400">{tx("यो कार्यमा कागजात छैन — /documents बाट TOR अपलोड गर्नुहोस्।", "No documents on this work — upload TOR from /documents.", lang)} <Link href="/documents" className="font-bold text-nepal-blue">→</Link></p>;
                return <div className="flex flex-wrap gap-1">{linked.map((d) => {
                  const id = d.docId || d.id;
                  const on = attach.includes(id);
                  return <button key={id} onClick={() => setAttach((a) => (on ? a.filter((x) => x !== id) : [...a, id]))} className={`rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold ${on ? "bg-emerald-600 text-white" : "bg-white text-slate-600"}`}>{on ? "✓ " : "+ "}{d.name || id}</button>;
                })}</div>;
              })()}
            </div>
          </div>
          <div className="mt-3"><RoutePreview route={preview} lang={lang} />{!preview && <p className="font-mono text-xs font-bold text-red-600">NO_ROUTE — {tx("मन्त्रालय प्रशासकलाई सम्पर्क गर्नुहोस्", "contact ministry admin", lang)}</p>}</div>
          <ServerErrors errors={f.serverErrors} lang={lang} />
          {apiErr && <p className="mt-1 font-mono text-xs font-bold text-red-600">❌ {apiErr}</p>}
          <div className="mt-3 flex gap-2 text-xs font-bold">
            <button onClick={() => save(false)} className="rounded-lg border px-4 py-2">{tx("ड्राफ्ट सेभ", "Save draft", lang)}</button>
            <button onClick={() => save(true)} disabled={!preview} className="rounded-lg bg-nepal-blue px-4 py-2 text-white disabled:opacity-40">{tx("रुट देखाएर पठाउनुहोस्", "Preview route & send", lang)}</button>
          </div>
        </Card>
      )}
    </div>
  );
}
