"use client";
import { useState } from "react";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { listActions, applyTransition, actionLabel } from "@/lib/lifecycle";
import { HistoryTimeline } from "./ui";

// Generic transition box for any §11 sub-lifecycle record.
// Props: recordType, status, onStatus(next), actor defaults to current role.
// Optional allow=[actions]: hides every other action button (e.g. verify
// buttons stay minister-only while entry roles keep submit).
// Optional emptyText: shown instead of the default "no actions" line when no
// action is allowed for the current role (e.g. role-gated approvals).
export default function TransitionBox({ recordType, status, onStatus, lang = "en", extraCtx = {}, allow = null, emptyText = null }) {
  const { role } = useApp();
  const [text, setText] = useState("");
  const [hist, setHist] = useState([]);
  const [err, setErr] = useState("");
  const actions = listActions(recordType, status).filter((a) => !allow || allow.includes(a.action));
  const run = (action) => {
    setErr("");
    try {
      const r = applyTransition(recordType, { from: status, action, actor: role, ctx: { ...extraCtx, comment: text, reason: text } });
      setHist((p) => [...p, r.history]);
      // Pass the typed reason/comment along so callers can persist it with
      // the record (e.g. staff submit reasons reach the section approver).
      onStatus?.(r.status, r, text);
      setText("");
    } catch (e) { setErr(e.code || String(e)); }
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2 text-xs font-bold">
        {actions.map((a) => (
          <button key={a.action} onClick={() => run(a.action)} title={(a.needs || []).join(", ")} className="rounded-lg border px-3 py-1.5 hover:bg-slate-50">
            {actionLabel(a.action, lang)}{(a.needs || []).length ? " *" : ""}
          </button>
        ))}
        {actions.length === 0 && <span className="text-slate-400">{emptyText || tx("कुनै कार्य छैन (अन्तिम)", "No actions (terminal)", lang)}</span>}
      </div>
      <div className="mt-2 flex gap-2 text-xs">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("कारण / टिप्पणी (आवश्यक परेमा)", "Reason / comment (when required)", lang)} className="flex-1 rounded-lg border px-2 py-1.5" />
      </div>
      {err && <div className="mt-1 font-mono text-xs font-bold text-red-700">{err}</div>}
      {hist.length > 0 && <div className="mt-2"><HistoryTimeline history={hist} lang={lang} /></div>}
    </div>
  );
}
