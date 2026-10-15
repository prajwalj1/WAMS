import { NextResponse } from "next/server";
import { scanFile } from "@/lib/rules";
import { callerIdentity } from "@/lib/api-auth";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";

// §34 file flow (prototype runs inline; prod uses MinIO presigned URLs +
// worker ClamAV/file-type/EXIF/preview). Quarantine → scan → main.
// Document metadata persists in Mongo (documents collection).
const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXT = ["pdf", "jpg", "jpeg", "png", "zip", "xlsx", "csv", "docx"];

const sign = (bucket, key, secs) => `https://${bucket}.example/${key}?exp=${secs}s&sig=dev`;

let seq = 1;

// POST /api/documents/upload-url { entity, type, name, size, mime, sid? }
// → caller session (never a client role claim) + STAFF-only + scope of
// the linked WORK (the document inherits the work's org chain) + size/ext /
// name-gate checks, version scan=PENDING + PUT url (5 min).
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const me = await callerIdentity(req, body);
  if (!me) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  // Staff-only upload: only the STAFF role may create documents.
  if (me.role !== "STAFF") {
    return NextResponse.json({ ok: false, code: "PERMISSION_DENIED" }, { status: 403 });
  }
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE" }, { status: 503 });
  }
  // The document belongs to a work: unknown work → 404, out-of-scope work →
  // 404 (BR-03). Scope/chain always come from the work, never the client.
  const work = body.entity ? await getModel("works").findOne({ id: String(body.entity) }).lean() : null;
  if (!work) return NextResponse.json({ ok: false, code: "UNKNOWN_WORK" }, { status: 404 });
  // Inherit the work's chain; guarantee the pmo root so the national
  // monitor (PMO scope) can always download it later.
  const ancestors = [...(work.orgAncestors || [])];
  if (!ancestors.includes("pmo")) ancestors.unshift("pmo");
  const scopeIds = me.scopeUnitIds?.length ? me.scopeUnitIds : me.unitId ? [me.unitId] : [];
  if (!ancestors.some((a) => scopeIds.includes(a))) {
    return NextResponse.json({ ok: false, code: "OUT_OF_SCOPE" }, { status: 404 });
  }
  const ext = String(body.name || "").split(".").pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return NextResponse.json({ ok: false, code: "FILE_TYPE" }, { status: 422 });
  if (Number(body.size) > MAX_BYTES) return NextResponse.json({ ok: false, code: "FILE_TOO_LARGE" }, { status: 422 });
  try {
    scanFile(body.name || "", body.mime || "");
  } catch (e) {
    return NextResponse.json({ ok: false, code: e.code }, { status: 422 });
  }
  const id = `D-${Date.now().toString(36)}-${seq++}`;
  await getModel("documents").create({ docId: id, entity: work.id, type: body.type || "Evidence", name: body.name, mime: body.mime || "", size: Number(body.size) || 0, versions: [{ v: 1, scan: "PENDING", uploadedBy: me.username }], confidential: !!body.confidential, downloads: [], orgUnitId: work.orgUnitId || "", orgAncestors: ancestors, orgPath: (ancestors || []).join(".") });
  return NextResponse.json({ ok: true, id, uploadUrl: sign("wmams-quarantine", id, 300) });
}
