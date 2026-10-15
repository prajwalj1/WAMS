"use client";
import { useState } from "react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import { t, tx } from "@/lib/i18n";
import { Card, Table, DocPreview } from "@/components/ui";
import { useList, ListToolbar, Pager, exportCsv } from "@/components/list";
import { useCollection, Loading } from "@/lib/use-data";
import { errMsg } from "@/lib/errors";
import { mutate } from "@/lib/mutate";

const isImgName = (n) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(String(n || ""));
const isPdfName = (n) => /\.pdf$/i.test(String(n || ""));

export default function Docs() {
  const { lang, toast, role, user } = useApp();
  // Scope the lists to the caller's own units (BR-03). Without ?scope= the
  // generic data API returns every unit's rows, so the list would show files
  // from other units that /download then correctly refuses with OUT_OF_SCOPE.
  // National monitors (SUPER_ADMIN or pmo scope) see everything: no filter.
  const scopeIds = user?.scopeUnitIds?.length ? user.scopeUnitIds : user?.unitId ? [user.unitId] : [];
  const isNationalMonitor = role === "SUPER_ADMIN" || scopeIds.includes("pmo");
  const scopeParam = isNationalMonitor ? "" : scopeIds.join(",");
  const { data, loading, error, reload } = useCollection("docs", scopeParam ? { scope: scopeParam } : {});
  const worksQ = useCollection("works", scopeParam ? { scope: scopeParam } : {});
  const docs = data;
  const [entity, setEntity] = useState("");
  const [docType, setDocType] = useState("TOR");
  const [file, setFile] = useState(null);
  const [msg, setMsg] = useState("");
  const [lastUp, setLastUp] = useState(null);
  const [viewMsg, setViewMsg] = useState("");
  // Inline preview: image shows as a thumbnail, PDF embeds in an iframe —
  // never a bare filename. Served through DocPreview (x-sid header fetch),
  // so any role with a valid session and scope sees the file itself —
  // admin included. Only CLEAN files preview.
  const [previewId, setPreviewId] = useState(null);
  // Upload is STAFF-only — every other role (incl. PMO Super Admin,
  // Auditor, Viewer…) sees the list + download but never the upload
  // controls; the server refuses their POSTs regardless.
  const canUpload = role === "STAFF";
  // Delete is PMO Super Admin ONLY (documents + evidence alike) — the
  // server refuses everyone else regardless. Clears work completion
  // references to the file too.
  const canDelete = role === "SUPER_ADMIN";
  const removeDoc = async (d) => {
    const label = d.name || d.docId || d.id;
    try {
      if (!window.confirm(`${tx("पक्का मेट्ने?", "Delete for sure?", lang)} ${label}`)) return;
    } catch { return; }
    await mutate(`/api/documents/${encodeURIComponent(d.docId || d.id)}`, { method: "DELETE",
      body: {},
      okMsg: `${label} · ${tx("फाइल मेटियो", "File deleted", lang)}`,
      toast, reload });
  };
  // File name comes from the browsed file itself — never typed by hand.
  const name = file?.name || "";
  // Images that fail to stream fall back inside DocPreview (reason +
  // direct link) — never vanish silently.
  // The doc under preview: list row by id, or the just-uploaded file while
  // the list reloads (assumed CLEAN — it just scanned).
  const previewDoc = (docs || []).find((d) => (d.docId || d.id) === previewId)
    || (previewId && lastUp?.docId === previewId ? { docId: lastUp.docId, name: lastUp.name, scan: "CLEAN" } : null);
  const ctl = useList({
    rows: docs,
    searchKeys: ["name", "entity", "type"],
    filters: [{ key: "type", label: tx("प्रकार", "Type", lang), options: [...new Set(docs.map((d) => d.docType || d.type))].map((x) => ({ value: x, label: x })) }],
    sortOptions: [{ value: "name", label: tx("फाइल", "File", lang), get: (r) => r.name }],
  });
  const upload = async () => {
    if (!name || !entity) { setMsg(`❌ ${tx("फाइल र लिङ्क कार्य आवश्यक", "File and linked work required", lang)}`); return; }
    // Inline bytes path caps at 8 MB (see complete route INLINE_MAX). Larger
    // files would record CLEAN with no stored bytes and always fail download
    // with FILE_NOT_STORED, so block them here with a clear message.
    if ((file?.size || 0) > 8 * 1024 * 1024) { setMsg(`❌ FILE_TOO_LARGE — ${tx("8 MB भन्दा ठूलो फाइल अपलोड हुँदैन — सानो फाइल छान्नुहोस्", "Files over 8 MB cannot be stored in this build — choose a smaller file", lang)}`); return; }
    const ext = name.split(".").pop().toLowerCase();
    const mime = file?.type || (ext === "pdf" ? "application/pdf" : "text/plain");
    // §34: upload-url (session + work-scope + size/ext/name-gate checks) →
    // complete (ClamAV INSTREAM on the bytes, name-gate fallback) → record.
    // Both calls carry the session via mutate; the verdict lands in the list.
    const u = await mutate("/api/documents/upload-url", { method: "POST",
      body: { entity, type: docType, name, size: file?.size || 0, mime }, toast });
    if (!u.ok) {
      const hint = u.code === "OUT_OF_SCOPE"
        ? ` — ${tx("छानिएको कार्य अर्को शाखाको हो — आफ्नै शाखाको कार्य छान्नुहोस्", "Linked work belongs to another unit — choose your own unit's work", lang)}`
        : "";
      setMsg(`${u.code}${hint} — ${errMsg(u.code, lang)}`); return;
    }
    // Inline bytes (≤8 MB) so the server can really scan content; larger
    // files fall back to the name-gate verdict.
    let bytesBase64 = null;
    if (file && (file.size || 0) <= 8 * 1024 * 1024) {
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        bytesBase64 = btoa(bin);
      } catch { bytesBase64 = null; }
    }
    const c = await mutate(`/api/documents/${u.id}/complete`, { method: "POST",
      body: { bytesBase64 }, toast });
    if (!c.ok) {
      const hint = c.code === "FILE_NOT_STORED"
        ? ` — ${tx("फाइल भण्डारमा छैन — 8 MB भित्रको फाइल पुनः अपलोड गर्नुहोस्", "File content not stored — please re-upload a file within 8 MB", lang)}`
        : "";
      setMsg(`${c.code}${c.engine ? ` (${c.engine})` : ""}${hint} — ${errMsg(c.code, lang)}`); return;
    }
    // Inherit the linked work's chain so scoped views keep the record.
    // Guarantee the pmo root like upload-url does.
    const w = (worksQ.data || []).find((x) => x.id === entity);
    const wAnc = [...(w?.orgAncestors || [])];
    if (wAnc.length && !wAnc.includes("pmo")) wAnc.unshift("pmo");
    const saved = await mutate("/api/data/docs", { method: "POST",
      body: { doc: { name, entity, type: docType, v: 1, size: Number(file?.size) || 0, scan: "CLEAN", engine: c.engine || "name-gate", docId: u.id, orgUnitId: w?.orgUnitId || "", orgAncestors: wAnc, orgPath: wAnc.join(".") } },
      okMsg: `${name} · ${tx("अपलोड भयो", "Uploaded", lang)}`,
      toast, reload });
    if (!saved.ok) { setMsg(`${saved.code}`); return; }
    setLastUp({ work: entity, docId: u.id, name });
    // Show the just-uploaded file immediately (image / PDF inline).
    setPreviewId(u.id);
    setMsg(`✅ ${u.id} · ${c.scan} (${c.engine}${c.fallback ? ", daemon unreachable" : ""}) → wmams-docs`);
  };
  return (<div className="space-y-3"><h1 className="text-xl font-black">{t("docsTitle", lang)}</h1>
  <Card title={tx("संस्करणसहित फाइल · क्वारेन्टाइन → स्क्यान → मुख्य भण्डार", "Versioned files · quarantine → scan → main store", lang)}
      action={canUpload ? <div className="no-print flex max-w-full flex-wrap gap-1">
      <label className="w-44 cursor-pointer truncate rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-600" title={name || tx("फाइल छान्नुहोस्", "Choose a file", lang)}>
        {name || tx("फाइल छान्नुहोस्…", "Choose file…", lang)}
        <input type="file" key={name || "empty"} className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </label>
      <select value={entity} onChange={(e) => setEntity(e.target.value)} className="w-36 rounded-lg border px-2 py-1 text-xs">
        <option value="">—</option>
        {(worksQ.data || []).map((w) => <option key={w.id} value={w.id}>{w.id}</option>)}
      </select>
      <select value={docType} onChange={(e) => setDocType(e.target.value)} title={tx("प्रकार", "Type", lang)} className="w-28 rounded-lg border px-2 py-1 text-xs">
        {["TOR", "Evidence", "Report", "Completion"].map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <button onClick={upload} className="rounded-lg bg-nepal-blue px-3 py-1 text-xs font-bold text-white">+ {t("upload", lang)}</button>
    </div> : null}>
    {msg && <p className="mb-1 font-mono text-xs font-bold">{msg}</p>}
    {viewMsg && <p className="mb-1 font-mono text-xs font-bold text-red-700">{viewMsg}</p>}
    {previewDoc && (previewDoc.docId || previewDoc.id) && (
      <div className="mb-2 rounded-lg border border-nepal-blue bg-sky-50 p-2">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-nepal-blue">👁 {previewDoc.name}</span>
          <button onClick={() => setPreviewId(null)} className="rounded-lg border bg-white px-2 py-0.5 text-xs font-bold">✕ {tx("बन्द", "Close", lang)}</button>
        </div>
        <DocPreview docId={previewDoc.docId || previewDoc.id} name={previewDoc.name} lang={lang} />
      </div>
    )}
    {lastUp && <p className="mb-1 text-xs font-bold"><Link href={`/tippani/new?work=${encodeURIComponent(lastUp.work)}&subject=BUDGET_APPROVAL&doc=${encodeURIComponent(lastUp.docId)}`} className="rounded-lg bg-nepal-crimson px-3 py-1.5 text-white">{tx("इ-टिप्पणी ड्राफ्ट", "Draft e-Tippani (BUDGET_APPROVAL)", lang)} →</Link></p>}
    {loading ? <Loading lang={lang} /> : error ? <Loading error={error} lang={lang} /> : <>
    <ListToolbar ctl={ctl} lang={lang}
      filters={[{ key: "type", label: tx("प्रकार", "Type", lang), options: [...new Set(docs.map((d) => d.docType || d.type))].map((x) => ({ value: x, label: x })) }]}
      sortOptions={[{ value: "name", label: tx("फाइल", "File", lang) }]}
      onExport={() => exportCsv("documents", ["File", "Linked", "Type", "Ver", "Scan"], ctl.pageRows.map((d) => [d.name, d.entity, d.docType || d.type, d.v, `${d.scan || "—"}${d.engine ? ` (${d.engine})` : ""}`]))} />
    <div className="mt-2">
    <Table cols={[tx("फाइल", "File", lang), tx("लिङ्क", "Linked to", lang), tx("प्रकार", "Type", lang), tx("संस्करण", "Ver", lang), tx("स्क्यान", "Scan", lang), ""]} rows={ctl.pageRows.map((d) => {
      const viewable = (d.docId || d.id) && d.scan === "CLEAN";
      const fileCell = viewable && isImgName(d.name)
        ? <span key={d.docId || d.id} onClick={() => setPreviewId(d.docId || d.id)} title={tx("हेर्नुहोस्", "View", lang)} className="inline-block cursor-pointer">
            <DocPreview docId={d.docId || d.id} name={d.name} variant="thumb" lang={lang} />
          </span>
        : viewable
          ? <span key={d.docId || d.id}>{isPdfName(d.name) ? "📄 " : "📎 "}<button onClick={() => setPreviewId(d.docId || d.id)} className="font-bold text-nepal-blue hover:underline" title={tx("हेर्नुहोस्", "View", lang)}>{d.name}</button></span>
          : d.name;
      return [fileCell, d.entity, d.docType || d.type, `v${d.v}`, d.scan === "CLEAN" ? `✅ CLEAN${d.engine ? ` (${d.engine})` : ""}` : (d.scan || "—"),
      canDelete
        ? <button key={`${d.docId || d.id}-x`} onClick={() => removeDoc(d)} title={tx("स्थायी रूपमा मेट्नुहोस्", "Delete permanently", lang)} className="cursor-pointer text-xs font-bold text-red-700">🗑 {tx("मेट्नुहोस्", "Delete", lang)}</button> : null];
    })} />
    </div>
    <Pager ctl={ctl} lang={lang} />
    </>}
  </Card></div>);
}
