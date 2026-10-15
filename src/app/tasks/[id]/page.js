"use client";
import Link from "next/link";
import { use, useState } from "react";
import { useApp } from "@/lib/store";
import { tx } from "@/lib/i18n";
import { Card, Table, StatusChip } from "@/components/ui";
import TransitionBox from "@/components/transitions";
import { useCollection, Loading } from "@/lib/use-data";
import { mutate } from "@/lib/mutate";
import { kathmanduDayKey } from "@/lib/progress";

export default function TaskDetail({ params }) {
  const { lang, user, toast, role } = useApp();
  // Monitor-only roles (PMO + read-only) see details/activity/subtasks
  // read-only — all entry forms and transition buttons are hidden.
  // Server APIs still refuse their writes regardless.
  const isMonitorOnly = ["SUPER_ADMIN", "VIEWER", "AUDITOR", "EXTERNAL"].includes(role);
  const { id } = use(params);
  const { data: TASKS, loading, error, reload } = useCollection("tasks");
  const docsQ = useCollection("docs");
  const auditsQ = useCollection("auditlogs");
  const seed = TASKS.find((x) => x.ref === id);
  // Activity feed is built live: logged activities + audit trail entries +
  // linked documents for this task/work — never hardcoded rows.
  const activity = [
    ...(auditsQ.data || []).filter((a) => a.entity === id || (seed && a.entity === seed.workId)).map((a) => [a.at || "—", `${a.action || ""} · ${a.note || ""}`, a.actor || "—"]),
    ...(docsQ.data || []).filter((d) => d.entity === id || (seed && d.entity === seed.workId)).map((d) => [d.updatedAt || d.createdAt || "—", `${d.name || ""} (${d.type || ""} v${d.v ?? 1})`, "—"]),
    ...(seed?.lastUpdate ? [[seed.lastUpdate, `${tx("प्रगति", "Progress", lang)} ${seed.physical}%`, seed.owner || "—"]] : []),
  ];
  const [taskStatus, setTaskStatus] = useState(null);
  const [updStatus, setUpdStatus] = useState("SUBMITTED");
  const [pct, setPct] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const [apiMsg, setApiMsg] = useState("");
  // Details editing (description + TOR).
  const [desc, setDesc] = useState(null);
  const [tor, setTor] = useState(null);
  // Subtasks + assignees + activity log.
  const [subTitle, setSubTitle] = useState("");
  const [subWeight, setSubWeight] = useState("");
  const [actDate, setActDate] = useState("");
  const [actNote, setActNote] = useState("");
  const submitProgress = async () => {
    setApiMsg("");
    const photoName = photo?.name || "";
    if (photo && (photo.size || 0) > 8 * 1024 * 1024) { setApiMsg("❌ FILE_TOO_LARGE — 8 MB"); return; }
    // §30: POST /tasks/:id/progress — guards → txn → recompute.
    const res = await mutate(`/api/tasks/${seed.ref}/progress`, {
      method: "POST",
      body: { physical: Number(pct), note: photoName ? `${note} [📷 ${photoName}]`.trim() : note, reason: note, actor: user?.username || user?.nameEn || "", scopeUnitIds: user.scopeUnitIds },
      toast });
    if (!res.ok) { setApiMsg(`❌ ${res.code}`); return; }
    setApiMsg(`✅ 201 · ${tx("नयाँ प्रगति", "new progress", lang)} ${res.task.physical}% · work gap ${res.workHealth?.gap}`);
    toast(`${seed.ref} · ${tx("प्रगति", "Progress", lang)} ${res.task.physical}%`);
    if (res.task.status) setTaskStatus(res.task.status);
    // Field photo for this progress update: stored as an Evidence document
    // linked to the WORK (entity = workId), so it appears on the work's
    // evidence card where admin + PMO monitor it — same scanned flow as
    // /documents (STAFF-only, work-scoped, virus-scanned).
    if (photo && seed.workId) {
      try {
        const today = kathmanduDayKey(new Date());
        const name = `${seed.ref}-${today}-${photoName}`;
        const ext = photoName.split(".").pop().toLowerCase();
        const mime = photo.type || (ext === "png" ? "image/png" : "image/jpeg");
        const u = await mutate("/api/documents/upload-url", { method: "POST",
          body: { entity: seed.workId, type: "Evidence", name, size: photo.size || 0, mime }, toast });
        if (!u.ok) { setApiMsg(`✅ progress · ❌ photo ${u.code}`); return; }
        let bytesBase64 = null;
        try {
          const buf = new Uint8Array(await photo.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
          bytesBase64 = btoa(bin);
        } catch { bytesBase64 = null; }
        const c = await mutate(`/api/documents/${u.id}/complete`, { method: "POST", body: { bytesBase64 }, toast });
        if (!c.ok) { setApiMsg(`✅ progress · ❌ photo ${c.code}`); return; }
        const wAnc = [...(seed.orgAncestors || [])];
        if (wAnc.length && !wAnc.includes("pmo")) wAnc.unshift("pmo");
        const saved = await mutate("/api/data/docs", { method: "POST",
          body: { doc: { name, entity: seed.workId, type: "Evidence", v: 1, size: Number(photo.size) || 0, scan: "CLEAN", engine: c.engine || "name-gate", docId: u.id, orgUnitId: seed.orgUnitId || "", orgAncestors: wAnc, orgPath: wAnc.join(".") } },
          toast, reload: docsQ.reload });
        if (!saved.ok) { setApiMsg(`✅ progress · photo stored, list entry ${saved.code}`); return; }
        try { auditsQ.reload(); } catch {}
        setApiMsg(`✅ 201 · ${res.task.physical}% · 📷 ${photoName}`);
        setPhoto(null);
      } catch { setApiMsg(`✅ progress · ❌ photo FAILED`); }
    }
  };
  // Depth of this task in the subtask chain (MAX_DEPTH 3 per rules).
  const depthOf = (ref) => {
    let d = 0;
    let cur = (TASKS || []).find((x) => x.ref === ref);
    const seen = new Set();
    while (cur?.parentRef && !seen.has(cur.ref) && d < 10) { seen.add(cur.ref); d += 1; cur = (TASKS || []).find((x) => x.ref === cur.parentRef); }
    return d;
  };
  const children = (TASKS || []).filter((x) => x.parentRef === id);
  const assignees = seed?.assignees || [];
  const saveDetails = async () => {
    await mutate("/api/data/tasks", { method: "PATCH",
      body: { match: { ref: seed.ref }, update: { description: desc ?? seed.description ?? "", tor: tor ?? seed.tor ?? "" }, __v: seed.__v ?? 1 },
      okMsg: `${seed.ref} · ${tx("विवरण सेभ", "Details saved", lang)}`,
      toast, reload });
  };
  const logActivity = async () => {
    const today = kathmanduDayKey(new Date());
    const at = actDate || today;
    if (!actNote.trim()) { toast(tx("टिप्पणी आवश्यक", "Note required", lang), "err"); return; }
    if (at > today) { toast(tx("भविष्यको मिति हुँदैन", "Date cannot be in the future", lang), "err"); return; }
    const res = await mutate("/api/data/auditlogs", { method: "POST",
      body: { doc: { at, actor: user?.username || "", action: "activity.log", entity: seed.ref, note: actNote.trim(), orgAncestors: seed.orgAncestors || [] } },
      okMsg: tx("गतिविधि लेखियो", "Activity logged", lang),
      toast, reload: auditsQ.reload });
    if (res.ok) setActNote("");
  };
  const addSubtask = async () => {
    if (!subTitle.trim()) { toast(tx("शीर्षक आवश्यक", "Title required", lang), "err"); return; }
    if (depthOf(seed.ref) >= 3) { toast("MAX_DEPTH", "err"); return; }
    const w = Number(subWeight) || 0;
    const ref = `${seed.ref}.${children.length + 1}`;
    const res = await mutate("/api/data/tasks", { method: "POST",
      body: { doc: { ref, workId: seed.workId, title: subTitle.trim(), titleEn: subTitle.trim(), weight: w, physical: 0, owner: seed.owner || "", deadline: seed.deadline, status: "NOT_STARTED", parentRef: seed.ref, orgUnitId: seed.orgUnitId, orgAncestors: seed.orgAncestors, orgPath: seed.orgPath } },
      okMsg: `${ref} · ${tx("सबटास्क थपियो", "Subtask added", lang)}`,
      toast, reload });
    if (res.ok) { setSubTitle(""); setSubWeight(""); }
  };
  return (
    <div className="space-y-3">
      {loading ? <Card title="…"><Loading lang={lang} /></Card> : error || !seed ? <Card title="…"><Loading error={error || "NOT_FOUND"} lang={lang} /></Card> : <>
      <h1 className="text-xl font-black">{tx("कार्य", "Task", lang)} {seed.ref} · {lang === "ne" ? seed.title : seed.titleEn} <StatusChip status={taskStatus ?? seed.status} lang={lang} /></h1>
      {isMonitorOnly ? (
        <p className="no-print mt-1 text-[12px] text-slate-400">{tx("पढ्ने मात्र — कार्य उद्योग पक्षले निर्धारण गर्छ।", "Read-only — works are determined by the industry side.", lang)}</p>
      ) : (
      <div className="no-print flex flex-wrap gap-2 text-[12px] font-semibold">
        <Link href="/documents" className="rounded-lg bg-nepal-blue px-3 py-1.5 text-white">{tx("TOR अपलोड", "Upload TOR", lang)}</Link>
        {seed.workId && <Link href={`/tippani/new?work=${encodeURIComponent(seed.workId)}&subject=BUDGET_APPROVAL`} className="rounded-lg bg-nepal-crimson px-3 py-1.5 text-white">{tx("इ-टिप्पणी ड्राफ्ट", "Draft e-Tippani", lang)}</Link>}
      </div>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={tx("विवरण + TOR", "Details + TOR", lang)}>
          <div className="text-[13px] space-y-1"><div>{tx("स्वामित्व", "Owner", lang)} {seed.owner} · {tx("तौल", "weight", lang)} {seed.weight}% · {seed.status}</div></div>
          {isMonitorOnly ? (
          <>
            <div className="mt-2 space-y-2 text-xs">
              <div><span className="font-bold text-slate-600">{tx("विवरण", "Description", lang)}: </span><span className="font-normal">{seed.description || "—"}</span></div>
              <div><span className="font-bold text-slate-600">TOR: </span><span className="font-normal">{seed.tor || "—"}</span></div>
            </div>
            <div className="mt-3 border-t pt-2">
              <div className="mb-1 text-xs font-bold text-slate-600">{tx("तोकिएका", "Assigned", lang)}</div>
              {assignees.length === 0 ? <p className="text-xs text-slate-400">—</p> :
                <div className="flex flex-wrap gap-1">{assignees.map((a, i) => <span key={i} className="rounded-full border px-2 py-1 text-xs">{a.name || a.mobile || a}</span>)}</div>}
            </div>
          </>
          ) : (
          <>
          <div className="mt-2 space-y-2 text-xs">
            <label className="block font-bold text-slate-600">{tx("विवरण", "Description", lang)}
              <textarea value={desc ?? seed.description ?? ""} onChange={(e) => setDesc(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" />
            </label>
            <label className="block font-bold text-slate-600">TOR
              <textarea value={tor ?? seed.tor ?? ""} onChange={(e) => setTor(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" />
            </label>
            <button onClick={saveDetails} className="rounded-lg bg-nepal-blue px-3 py-1.5 font-bold text-white">{tx("विवरण सेभ", "Save details", lang)}</button>
          </div>
          <div className="mt-3 border-t pt-2">
            <div className="mb-1 text-xs font-bold text-slate-600">{tx("तोकिएका", "Assigned", lang)}</div>
            {assignees.length === 0 ? <p className="text-xs text-slate-400">—</p> :
              <div className="flex flex-wrap gap-1">{assignees.map((a, i) => <span key={i} className="rounded-full border px-2 py-1 text-xs">{a.name || a.mobile || a}</span>)}</div>}
          </div>
          <div className="mt-2"><TransitionBox recordType="task" status={taskStatus ?? seed.status} onStatus={setTaskStatus} lang={lang} /></div>
          </>
          )}
        </Card>
        <Card title={tx("गतिविधि + प्रगति (संख्यात्मक + गुणात्मक)", "Activity + progress (quant + qual)", lang)}>
          {activity.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
            <Table cols={[tx("मिति", "Date", lang), tx("गतिविधि", "Activity", lang), tx("द्वारा", "By", lang)]} rows={activity} />
          )}
          {isMonitorOnly ? (
            <div className="mt-2 flex items-center gap-2 text-xs"><span className="text-slate-500">{tx("भौतिक", "Physical", lang)}</span><span className="font-bold">{seed.physical ?? 0}%</span><StatusChip status={seed.status} lang={lang} /></div>
          ) : (
          <>
          <div className="no-print mt-2 border-t pt-2">
            <div className="mb-1 text-xs font-bold text-slate-600">{tx("गतिविधि लेख्नुहोस्", "Log activity", lang)}</div>
            <div className="flex flex-wrap gap-2 text-xs">
              <input type="date" value={actDate} max={kathmanduDayKey(new Date())} onChange={(e) => setActDate(e.target.value)} className="rounded-lg border px-2 py-1.5" />
              <input value={actNote} onChange={(e) => setActNote(e.target.value)} placeholder={tx("आज के भयो?", "What happened today?", lang)} className="min-w-40 flex-1 rounded-lg border px-2 py-1.5" />
              <button onClick={logActivity} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white">+ {tx("गतिविधि", "Activity", lang)}</button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs"><span className="text-slate-500">{tx("अपडेट स्थिति", "Update status", lang)}</span><StatusChip status={updStatus} lang={lang} /></div>
          <div className="no-print mt-2"><TransitionBox recordType="progressUpdate" status={updStatus} onStatus={setUpdStatus} lang={lang} /></div>
          <div className="no-print mt-2 flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
            <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(e.target.value)} className="w-20 rounded-lg border px-2 py-1.5" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tx("नोट / घट्दा कारण", "Note / reason if lower", lang)} className="min-w-40 flex-1 rounded-lg border px-2 py-1.5" />
            <label className="max-w-44 cursor-pointer truncate rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1.5 text-slate-600" title={photo?.name || tx("फिल्ड फोटो", "Field photo", lang)}>
              📷 {photo?.name || tx("फोटो", "Photo", lang)}
              <input type="file" accept="image/jpeg,image/png,image/jpg" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] || null)} />
            </label>
            <button onClick={submitProgress} className="rounded-lg bg-nepal-blue px-3 py-1.5 font-bold text-white">POST /progress → 201</button>
          </div>
          {apiMsg && <p className="mt-1 font-mono text-xs font-bold">{apiMsg}</p>}
          </>
          )}
        </Card>
      </div>
      <Card title={tx("सबटास्क", "Subtasks", lang)}>
        {children.length === 0 ? <p className="text-sm text-slate-400">—</p> : (
          <Table cols={[tx("रेफ", "Ref", lang), tx("शीर्षक", "Title", lang), tx("स्थिति", "Status", lang), tx("भौतिक", "Physical", lang)]}
            rows={children.map((x) => [x.ref, x.title, <StatusChip key={x.ref} status={x.status} lang={lang} />, `${x.physical}%`])} />
        )}
        {isMonitorOnly ? null : depthOf(seed.ref) >= 3 ? (
          <p className="mt-2 font-mono text-xs font-bold text-red-600">MAX_DEPTH</p>
        ) : (
          <div className="no-print mt-2 flex flex-wrap items-end gap-2 text-xs">
            <label className="min-w-40 flex-1 font-bold text-slate-600">{tx("शीर्षक", "Title", lang)}<input value={subTitle} onChange={(e) => setSubTitle(e.target.value)} className="mt-1 w-full rounded-lg border px-2 py-1.5 font-normal" /></label>
            <label className="font-bold text-slate-600">{tx("तौल%", "Wt%", lang)}<input type="number" min={0} value={subWeight} onChange={(e) => setSubWeight(e.target.value)} className="mt-1 w-20 rounded-lg border px-2 py-1.5 font-normal" /></label>
            <button onClick={addSubtask} className="rounded-lg bg-nepal-blue px-3 py-1.5 font-bold text-white">+ {tx("सबटास्क", "Subtask", lang)}</button>
          </div>
        )}
      </Card>
      </>}
    </div>
  );
}
