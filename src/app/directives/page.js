"use client";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import TransitionBox from "@/components/transitions";
import { useCollection, Loading } from "@/lib/use-data";
import { mutate } from "@/lib/mutate";
import { DIRECTIVE_APPROVER_ROLES, DIRECTIVE_TOP_OVERRIDE_ROLES, DIRECTIVE_ISSUE_BLOCKED_ROLES } from "@/lib/rules";
import { useState } from "react";
export default function Directives() {
  const { lang, toast, user, role } = useApp();
  const { data: dirs, loading, error, reload } = useCollection("directives");
  const unitsQ = useCollection("units");
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const add = async () => {
    setMsg("");
    if (saving) return;
    if (!to || !text.trim() || !due) { setMsg(tx("प्राप्तकर्ता, निर्देशन र म्याद आवश्यक", "Recipient, instruction and due date required", lang)); return; }
    // The sequence id (DIR-NNN) is assigned server-side from DB truth —
    // never guessed from the visible list (that collided → CREATE_FAILED).
    setSaving(true);
    try {
      const saved = await mutate("/api/data/directives", { method: "POST",
        body: { doc: { to, text: text.trim(), due, status: "ISSUED" } },
        toast, reload });
      if (!saved.ok) { setMsg(saved.code || "CREATE_FAILED"); return; }
      toast(`${saved.refId || ""} · ${tx("निर्देशन जारी", "Directive issued", lang)}`, "ok");
      setTo(""); setText(""); setDue("");
    } finally {
      setSaving(false);
    }
  };
  const setStatus = async (d, next) => {
    await mutate("/api/data/directives", { method: "PATCH",
      body: { match: { id: d.id }, update: { status: next }, __v: d.__v ?? 1 },
      okMsg: `${d.id} → ${next}`,
      toast, reload });
  };
  // Approval (close / ask-more) needs a top-level role, and so does
  // acknowledge/respond — staff is read-only on directives. Section
  // approvers close only what they issued; unit/ministry heads may close any.
  const canClose = (d) => DIRECTIVE_APPROVER_ROLES.includes(role)
    && (!d.from || d.from === user?.username || DIRECTIVE_TOP_OVERRIDE_ROLES.includes(role));
  const canRespond = DIRECTIVE_APPROVER_ROLES.includes(role);
  const allowFor = (d) => (canClose(d) ? null : canRespond ? ["acknowledge", "respond"] : []);
  // SECTION_HEAD has no Issue button — read-only on issuing (server-enforced).
  const canIssue = !DIRECTIVE_ISSUE_BLOCKED_ROLES.includes(role);
  return (<div className="space-y-3"><h1 className="text-xl font-black">{t("directives", lang)}</h1>
  <Card title={tx("म्यादसहितका निर्देशन र जवाफ", "Due-tracked instructions with responses", lang)}
    action={canIssue ? (<div className="no-print flex flex-wrap gap-1">
      <select value={to} onChange={(e) => setTo(e.target.value)} className="w-36 rounded-lg border px-2 py-1 text-xs">
        <option value="">— {tx("लाई", "To", lang)}</option>
        {(unitsQ.data || []).map((u) => <option key={u.id ?? u._id} value={u.nameEn || u.code}>{u.nameEn} ({u.code})</option>)}
      </select>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={tx("निर्देशन", "Instruction", lang)} className="w-44 rounded-lg border px-2 py-1 text-xs" />
      <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg border px-2 py-1 text-xs" />
      <button onClick={add} disabled={saving} className="rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white disabled:opacity-50">+ {tx("जारी", "Issue", lang)}</button>
    </div>) : null}>
    {msg && <p className="mb-1 font-mono text-xs font-bold">{msg}</p>}
    {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : (
    <Table cols={["ID", tx("बाट", "From", lang), tx("लाई", "To", lang), tx("म्याद", "Due", lang), tx("स्थिति", "Status", lang), tx("कार्य", "Action", lang)]}
      rows={dirs.map((d) => [d.id, d.from, d.to, d.due, <StatusChip key={d.id} status={d.status} lang={lang} />,
        <div key={d.id + "a"} className="max-w-52"><TransitionBox recordType="directive" status={d.status} lang={lang}
          allow={allowFor(d)}
          emptyText={tx("यो भूमिकाले जवाफ दिन मिल्दैन", "This role cannot respond", lang)}
          onStatus={(next) => setStatus(d, next)} />
          {d.status === "RESPONDED" && !canClose(d) && (
            <p className="mt-1 text-[11px] font-bold text-amber-700">{tx("शीर्ष तहको स्वीकृति बाँकी", "Pending top-level approval", lang)}</p>)}
        </div>])} />
    )}
  </Card></div>);
}
