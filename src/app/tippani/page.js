"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp, useWorkflow } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip, RoutePreview, HistoryTimeline } from "@/components/ui";
import { useCollection, Loading } from "@/lib/use-data";
import { listActions, applyTransition, actionLabel, snapshotRoute } from "@/lib/lifecycle";
import { workingDaysBetween } from "@/lib/metrics";
import { TIPPANI_STEP_BLOCKED_ROLES } from "@/lib/rules";
import { kathmanduDayKey } from "@/lib/progress";
import { mutate } from "@/lib/mutate";

export default function Tippani() {
  const { lang, user, role, toast } = useApp();
  const { routes } = useWorkflow();
  const { data: fetched, loading, error, reload } = useCollection("tippanis");
  const [overrides, setOverrides] = useState({});
  const [sel, setSel] = useState(null);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState("");
  const [hist, setHist] = useState([]);
  const todayStr = kathmanduDayKey(new Date());
  // Wait days are computed live from step start — never the stored snapshot.
  const rows = fetched.map((x) => (overrides[x.ref] ? { ...x, ...overrides[x.ref] } : x)).map((x) => ({
    ...x,
    waitDays: x.status === "IN_REVIEW" && x.stepSince ? workingDaysBetween(x.stepSince, todayStr) : (Number(x.waitDays) || 0),
  }));
  const cur = rows.find((x) => x.ref === sel) || rows[0];
  const actions = listActions("tippani", cur?.status || "DRAFT");
  // Route decisions (approve/reject) belong to ministry level ONLY.
  // Forward/return (+ the approval OTP) are hidden for STAFF, SECTION_HEAD
  // and UNIT_HEAD — ministry-level only.
  const canDecide = ["MINISTRY_ADMIN", "APPROVER"].includes(role);
  const canStep = !TIPPANI_STEP_BLOCKED_ROLES.includes(role);
  const shownActions = actions.filter((a) => (!["approve", "reject"].includes(a.action) || canDecide) && (!["forward", "return"].includes(a.action) || canStep));
  const route = routes.find((r) => r.id === cur?.route);
  const [otp, setOtp] = useState("");
  const needOtp = (action) => (action === "approve" && route?.otp && !otp.trim());
  const requestOtp = async () => {
    setErr("");
    const me = user?.username || "";
    if (!me) { setErr("UNAUTHENTICATED"); return; }
    try {
      const r = await fetch("/api/auth/stepup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: me, purpose: `tippani-approve:${cur?.ref}` }) }).then((x) => x.json());
      // The code is delivered out-of-band (dev: server console) and is NEVER
      // shown on the page — not even in the toast.
      if (r?.ok) toast(`OTP ${tx("कन्सोलमा हेर्नुहोस्", "sent — check the server console", lang)} · 5 min`, "ok");
      else setErr(r?.error || "OTP_FAILED");
    } catch { setErr("NETWORK_FAILED"); }
  };

  const run = async (action) => {
    setErr("");
    if (needOtp(action)) { setErr("OTP_REQUIRED"); return; }
    const me = user?.username || "";
    let preview;
    try {
      preview = applyTransition("tippani", { from: cur.status, action, actor: me, ctx: { comment, reason: comment } });
    } catch (e) { setErr(e.code || String(e)); return; }
    // §33: route is snapshotted at submission — later edits never touch in-flight items.
    const snap = action === "send" && route ? snapshotRoute(route) : null;
    const res = await mutate(`/api/tippani/${cur.ref}/transition`, { method: "POST",
      body: { action, comment, actor: me, scopeUnitIds: user?.scopeUnitIds, __v: cur.__v ?? 1, ...(action === "approve" && route?.otp ? { otpToken: otp.trim() } : {}) },
      toast });
    if (!res.ok) { setErr(res.code || "SAVE_FAILED"); return; }
    setOverrides((p) => ({ ...p, [cur.ref]: { status: res.status, ...(snap ? { routeSnapshot: snap } : {}) } }));
    setHist((p) => [...p, { ...preview.history, ref: cur.ref, ...(snap ? { snapshot: snap.id } : {}) }]);
    setComment("");
    setOtp("");
    toast(`${cur.ref} → ${res.status}${res.committed ? ` · committed NPR ${Number(res.committed.amount).toLocaleString("en-IN")} → ${res.committed.subhead}` : ""}`);
    reload();
  };

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-black">{t("inbox", lang)}</h1>
      <div className="no-print flex flex-wrap gap-2 text-xs font-bold">
        {[tx("मलाई प्रतीक्षा", "Waiting for me", lang), tx("मेरा ड्राफ्ट", "My drafts", lang), tx("पठाइएको", "Sent", lang), tx("निर्णीत", "Decided", lang)].map((b, i) => <button key={b} className={`rounded-lg border px-3 py-1.5 ${i === 0 ? "bg-nepal-blue text-white" : "bg-white"}`}>{b}</button>)}
        <Link href="/tippani/new" className="rounded-lg bg-nepal-crimson px-3 py-1.5 text-white">{t("newTippani", lang)}</Link>
      </div>
      <Card title={t("routeNote", lang)}>
        {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : (
        <Table cols={[tx("रेफ", "Ref", lang), tx("विषय", "Subject", lang), tx("रकम", "Amount", lang), tx("रुट", "Route", lang), tx("चरण", "Step", lang), tx("प्रतीक्षा", "Wait", lang), tx("स्थिति", "Status", lang)]}
          rows={rows.map((x) => [x.ref, <button key={x.ref} onClick={() => setSel(x.ref)} className={`font-bold ${x.ref === (sel || cur?.ref) ? "text-nepal-crimson" : "text-nepal-blue"}`}>{x.subject}</button>, x.amount ? `NPR ${x.amount.toLocaleString("en-IN")}` : "—", <Link key={x.ref} href={`/tippani/${x.ref}`} className="font-mono text-[11px] text-nepal-blue">{x.route} →</Link>, x.step, `${x.waitDays}${tx("दि", "d", lang)}`, <StatusChip key={x.ref + x.status} status={x.status} lang={lang} />])} />
        )}
      </Card>
      {cur && (
      <Card title={tx("निर्णय कार्य (रुटअनुसार मात्र)", "Decision actions (route only)", lang)}>
        <RoutePreview route={route} lang={lang} />
        <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
          {shownActions.map((a) => (
            <button key={a.action} onClick={() => run(a.action)}
              className={`rounded-lg border px-3 py-1.5 ${a.action === "approve" ? "bg-emerald-600 text-white" : ""}`}>
              {actionLabel(a.action, lang)}{a.action === "approve" && route?.otp ? " + OTP" : ""}{(a.needs || []).length ? " *" : ""}
            </button>
          ))}
          {shownActions.length === 0 && <span className="text-slate-400">{tx("कुनै कार्य छैन (अन्तिम)", "No actions (terminal)", lang)}</span>}
        </div>
        <div className="mt-2 flex gap-2 text-xs">
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tx("टिप्पणी (फिर्ता/अस्वीकृतमा अनिवार्य)", "Comment (required for return/reject)", lang)} className="flex-1 rounded-lg border px-2 py-1.5" />
          {route?.otp && canDecide && (<>
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="OTP" maxLength={6} inputMode="numeric" autoComplete="one-time-code" className="w-24 rounded-lg border px-2 py-1.5 font-mono" />
            <button onClick={requestOtp} className="rounded-lg border px-3 py-1.5 font-bold">OTP {tx("माग", "Get", lang)}</button>
          </>)}
        </div>
        {err && <div className="mt-1 font-mono text-xs font-bold text-red-700">{err}</div>}
        <div className="mt-2"><HistoryTimeline history={hist.filter((x) => x.ref === cur?.ref)} lang={lang} /></div>
      </Card>
      )}
    </div>
  );
}
