"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useApp, useWorkflow } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip, RoutePreview, HistoryTimeline } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import { listActions, applyTransition, actionLabel } from "@/lib/lifecycle";
import { TIPPANI_STEP_BLOCKED_ROLES } from "@/lib/rules";
import { mutate } from "@/lib/mutate";

export default function TippaniDetail({ params }) {
  const { lang, user, role, toast } = useApp();
  const { routes } = useWorkflow();
  const { id } = use(params);
  // Fetch scoped to this ref (server-side q search): the old code searched
  // the first 100 loaded rows, so any tippani beyond page 1 read as NOT_FOUND
  // and forward/return never rendered. Exact-match below disambiguates.
  const { data: TIPPANIS, loading, error, reload } = useCollection("tippanis", { q: id });
  const docsQ = useCollection("docs");
  const auditsQ = useCollection("auditlogs", { q: id });
  const seed = TIPPANIS.find((x) => x.ref === id);
  const [status, setStatus] = useState(null);
  const cur = status ?? seed?.status;
  const [hist, setHist] = useState([]);
  // Persisted trail: every transition writes an auditlogs entry (entity=ref),
  // so history shows even for tippanis approved long ago — not just actions
  // taken in this session. Scoped by the same ref search as above. (Declared
  // after the hist state — referencing it above throws TDZ ReferenceError.)
  const persistedHist = (auditsQ.data || [])
    .filter((a) => a.entity === id)
    .map((a) => ({ at: a.at, from: a.before, to: a.after, action: String(a.action || "").replace(/^tippani\./, ""), actor: a.actor, reason: a.note }));
  const seenHist = new Set();
  const fullHist = [...persistedHist, ...hist]
    .filter((h) => {
      const k = `${h.at}|${h.action}|${h.actor}|${h.from}|${h.to}`;
      if (seenHist.has(k)) return false;
      seenHist.add(k);
      return true;
    })
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const [otp, setOtp] = useState("");
  // Step-up OTP (§28): the code is delivered out-of-band (dev: server
  // console) and NEVER rendered on the page. The input below accepts digits
  // only.
  const actions = cur ? listActions("tippani", cur) : [];
  // Route decisions (approve/reject) belong to ministry level ONLY —
  // step holders keep send/withdraw. Forward/return (+ the approval OTP) are
  // hidden for STAFF, SECTION_HEAD and UNIT_HEAD — ministry-level only.
  const canDecide = ["MINISTRY_ADMIN", "APPROVER"].includes(role);
  const canStep = !TIPPANI_STEP_BLOCKED_ROLES.includes(role);
  const shownActions = actions.filter((a) => (!["approve", "reject"].includes(a.action) || canDecide) && (!["forward", "return"].includes(a.action) || canStep));
  const route = routes.find((r) => r.id === seed?.route);
  // Step-up OTP (§28): the large route (over NPR 1 crore) ends with a
  // Secretary approve that the server refuses without a fresh single-use OTP
  // (428 OTP_REQUIRED). The holder requests a code, types it, then approves.
  const needOtp = (action) => (action === "approve" && route?.otp && !otp.trim());
  const requestOtp = async () => {
    setErr("");
    const me = user?.username || "";
    if (!me) { setErr("UNAUTHENTICATED"); return; }
    try {
      const r = await fetch("/api/auth/stepup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: me, purpose: `tippani-approve:${seed.ref}` }) }).then((x) => x.json());
      if (r?.ok) {
        toast(`OTP ${tx("कन्सोलमा हेर्नुहोस्", "sent — check the server console", lang)} · 5 min`, "ok");
      } else setErr(r?.error || "OTP_FAILED");
    } catch { setErr("NETWORK_FAILED"); }
  };
  // Next holder on forward: step list order (Section Head → Mahashakha Head
  // → Joint Secretary → Secretary). Matched by current step label.
  const stepLabelOf = (s) => `${s.role}${s.title ? ` (${s.title})` : ""}`;
  const nextStepOf = () => {
    const steps = route?.steps || [];
    const i = steps.findIndex((s) => stepLabelOf(s) === seed.step || s.role === seed.step);
    const n = steps[i + 1];
    return n ? stepLabelOf(n) : seed.step;
  };
  // Step timeline state from the tippani's ACTUAL holder — the old code
  // hardcoded step 1 as Done and everything else as Pending no matter how
  // far the file had moved.
  const stepList = route?.steps || [];
  const curStepIdx = stepList.findIndex((s) => stepLabelOf(s) === seed?.step || s.role === seed?.step);
  const stepStateOf = (i) => {
    const done = tx("सकियो", "Done", lang);
    const pending = tx("बाँकी", "Pending", lang);
    if (cur === "APPROVED") return done;
    if (cur === "REJECTED") return i < curStepIdx ? done : i === curStepIdx ? tx("अस्वीकृत", "Rejected", lang) : pending;
    if (cur === "RETURNED") return i < curStepIdx ? done : i === curStepIdx ? tx("फिर्ता", "Returned", lang) : pending;
    if (curStepIdx < 0) return i === 0 && cur !== "DRAFT" && cur !== "WITHDRAWN" ? tx("चालु", "Current", lang) : pending;
    if (i < curStepIdx) return done;
    if (i === curStepIdx) return tx("चालु", "Current", lang);
    return pending;
  };

  // Decisions go through the transition endpoint: validated transition +
  // budget commit on final approval + audit, in one server call.
  const run = async (action) => {
    setErr("");
    if (needOtp(action)) { setErr("OTP_REQUIRED"); return; }
    const me = user?.username || "";
    let preview;
    try {
      preview = applyTransition("tippani", { from: cur, action, actor: me, ctx: { comment, reason: comment } });
    } catch (e) { setErr(e.code || String(e)); return; }
    const res = await mutate(`/api/tippani/${seed.ref}/transition`, { method: "POST",
      body: { action, comment, actor: me, scopeUnitIds: user?.scopeUnitIds, __v: seed.__v ?? 1, ...(action === "approve" && route?.otp ? { otpToken: otp.trim() } : {}), ...(action === "forward" ? { nextStep: nextStepOf() } : {}) },
      toast });
    if (!res.ok) { setErr(res.code || "SAVE_FAILED"); return; }
    setStatus(res.status);
    setHist((p) => [...p, preview.history]);
    setComment("");
    setOtp("");
    toast(`${seed.ref} → ${res.status}${res.committed ? ` · committed NPR ${Number(res.committed.amount).toLocaleString("en-IN")} → ${res.committed.subhead}` : ""}`);
    reload();
  };

  if (loading) return <div className="space-y-3"><Card title="…"><Loading lang={lang} /></Card></div>;
  if (error || !seed) return <div className="space-y-3"><Card title="…"><Loading error={error || "NOT_FOUND"} lang={lang} /></Card></div>;

  return (
    <div className="space-y-3">
      <Link href="/tippani" className="text-xs font-bold text-nepal-blue">← {t("tippani", lang)}</Link>
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-black">{seed.ref} · {seed.subject}</h1>
          <StatusChip status={cur} lang={lang} />
        </div>
        <p className="text-xs text-slate-500">NPR {seed.amount.toLocaleString("en-IN")} · {tx("चरण", "Step", lang)} {seed.step} · {seed.waitDays}{tx(" दिन प्रतीक्षा", "d waiting", lang)}</p>
        <p className="mt-1 text-xs text-slate-500">
          {tx("कार्य", "Work", lang)} {seed.work ? <Link href={`/works/${seed.work}`} className="font-bold text-nepal-blue">{seed.work}</Link> : "—"}
          {seed.subhead ? ` · ${seed.subhead}` : ""}
        </p>
        {Array.isArray(seed.attachments) && seed.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(docsQ.data || []).filter((d) => seed.attachments.includes(d.docId || d.id)).map((d) => (
              <Link key={d.docId || d.id} href="/documents" className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-800">📎 {d.name || d.docId}</Link>
            ))}
          </div>
        )}
        <div className="mt-2"><RoutePreview route={route} lang={lang} /></div>
        <div className="no-print mt-2 flex flex-wrap gap-2 text-xs font-bold">
          {shownActions.map((a) => <button key={a.action} onClick={() => run(a.action)} className={`rounded-lg border px-3 py-1.5 ${a.action === "approve" ? "bg-emerald-600 text-white" : ""}`}>{actionLabel(a.action, lang)}{(a.needs || []).length ? " *" : ""}</button>)}
        </div>
        <div className="no-print mt-2 flex flex-wrap gap-2 text-xs">
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tx("टिप्पणी", "Comment", lang)} className="min-w-40 flex-1 rounded-lg border px-2 py-1.5" />
          {route?.otp && canDecide && (<>
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="OTP" maxLength={6} inputMode="numeric" autoComplete="one-time-code" className="w-24 rounded-lg border px-2 py-1.5 font-mono" />
            <button onClick={requestOtp} className="rounded-lg border px-3 py-1.5 font-bold">OTP {tx("माग", "Get", lang)}</button>
          </>)}
          <button onClick={() => window.print()} className="rounded-lg border px-3 py-1.5 font-bold">PDF 🖨</button>
        </div>
        {err && <div className="mt-1 font-mono text-xs font-bold text-red-700">{err}</div>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("चरण समयरेखा", "Step timeline", lang)}>
          <Table cols={["#", tx("चरण", "Step", lang), tx("स्थिति", "Status", lang)]} rows={stepList.map((s, i) => [i + 1, stepLabelOf(s), stepStateOf(i)])} />
        </Card>
        <Card title={tx("इतिहास", "History", lang)}><HistoryTimeline history={fullHist} lang={lang} /></Card>
      </div>
    </div>
  );
}
