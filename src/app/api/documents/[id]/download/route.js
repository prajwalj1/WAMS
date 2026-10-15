import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";
import { callerIdentity } from "@/lib/api-auth";

// GET /api/documents/:id/download — streams the stored file inline so the
// browser can view it. Requires a session; scope-checked (SUPER_ADMIN/PMO
// monitors nationally, everyone else must share an orgAncestor). Confidential
// downloads are logged.
export async function GET(req, { params }) {
  try {
  const { id } = await params;
  const url = new URL(req.url);
  const bodySid = url.searchParams.get("sid");
  const me = await callerIdentity(req, bodySid ? { sid: bodySid } : null);
  if (!me) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  try {
    await dbConnect();
  } catch {
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE" }, { status: 503 });
  }
  const M = getModel("documents");
  let d = null;
  try {
    d = await M.findOne({ docId: id }).lean();
  } catch {
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE" }, { status: 503 });
  }
  if (!d) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  // National monitor (PMO) sees everything: SUPER_ADMIN by role, or any
  // caller whose scope includes the pmo root. Everyone else must share an
  // orgAncestor with the document (BR-03).
  const scopeIds = me.scopeUnitIds?.length ? me.scopeUnitIds : me.unitId ? [me.unitId] : [];
  const isNationalMonitor = me.role === "SUPER_ADMIN" || scopeIds.includes("pmo");
  if (!isNationalMonitor) {
    if (!((d.orgAncestors || []).some((a) => scopeIds.includes(a)))) {
      return NextResponse.json({ ok: false, code: "OUT_OF_SCOPE" }, { status: 404 });
    }
  }
  // versions[] is the source of truth; legacy/flat rows (v/scan fields
  // only, or missing versions) never crash here — they read as pending.
  const vers = Array.isArray(d.versions) ? d.versions : [];
  const v = vers.length ? vers[vers.length - 1] : (d.scan ? { scan: d.scan } : null);
  if (!v) return NextResponse.json({ ok: false, code: "SCAN_PENDING" }, { status: 409 });
  if (v.scan !== "CLEAN") return NextResponse.json({ ok: false, code: "SCAN_PENDING" }, { status: 409 });
  if (d.confidential) {
    try {
      await M.updateOne({ docId: id }, { $push: { downloads: { at: new Date().toISOString(), by: me.username || "?" } } });
    } catch {}
  }
  const raw = d.data;
  // Records created before byte persistence (or >8 MB uploads sent without
  // inline bytes) have no content to stream — re-upload the file.
  if (!raw) return NextResponse.json({ ok: false, code: "FILE_NOT_STORED" }, { status: 410 });
  let buf = null;
  try {
    // NOTE: `data` is Schema.Types.Mixed, so Mongoose hands back the raw BSON
    // Binary instance — which none of the shapes below matched, decoding to
    // an empty 200 response (broken images / failed PDFs). Handle it first.
    if (raw && (raw._bsontype === "Binary" || raw.sub_type !== undefined) && typeof raw.value === "function") buf = Buffer.from(raw.value(true));
    else if (Buffer.isBuffer(raw)) buf = raw;
    else if (raw && raw.type === "Buffer" && Array.isArray(raw.data)) buf = Buffer.from(raw.data);
    else if (typeof raw === "string") buf = Buffer.from(raw, "base64");
    else if (raw && typeof raw === "object" && raw.$binary?.base64) buf = Buffer.from(raw.$binary.base64, "base64");
    else buf = Buffer.from(raw);
  } catch {
    return NextResponse.json({ ok: false, code: "FILE_NOT_STORED" }, { status: 410 });
  }
  if (!buf || buf.length === 0) return NextResponse.json({ ok: false, code: "FILE_NOT_STORED" }, { status: 410 });
  const mime = d.mime || "application/octet-stream";
  // Headers must be latin1 (ByteString): a raw Nepali/Unicode filename in
  // content-disposition throws "Cannot convert argument to a ByteString".
  // Send an ASCII fallback plus RFC 5987 filename* so browsers still show
  // the real name.
  const rawName = String(d.name || id).replace(/["\r\n]/g, "");
  const asciiName = rawName.replace(/[^\x20-\x7E]/g, "_").slice(0, 100) || String(id);
  let disposition = `inline; filename="${asciiName}"`;
  try {
    disposition += `; filename*=UTF-8''${encodeURIComponent(rawName)}`;
  } catch {}
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": mime,
      "content-length": String(buf.length),
      "content-disposition": disposition,
      "cache-control": "private, max-age=60",
    },
  });
  } catch (e) {
    console.error("[documents/download] failed:", e?.message || e);
    return NextResponse.json({ ok: false, code: "VIEW_FAILED" }, { status: 500 });
  }
}
