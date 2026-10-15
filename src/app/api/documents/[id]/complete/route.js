import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";
import { callerIdentity } from "@/lib/api-auth";
import { getEnv } from "@/lib/env";
import { scanUpload } from "@/lib/clamav";

// POST /api/documents/:id/complete { bytesBase64?, sid? } — scan the
// quarantined file, then quarantine → main copy.
// - caller must be STAFF (401 otherwise, 403 for other roles);
//   out-of-scope documents read as 404 (BR-03).
// - bytes (≤8 MB inline from the client) go to ClamAV INSTREAM; when no
//   daemon answers, the name-gate + EICAR content sniff decides and the
//   verdict is labeled engine "name-gate" (never implied as ClamAV).
// - INFECTED deletes the quarantined record → 422 FILE_INFECTED; CLEAN
//   flips the version to CLEAN with engine/size recorded.
const INLINE_MAX = 8 * 1024 * 1024;

export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const me = await callerIdentity(req, body);
  if (!me) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  // Staff-only upload: only the STAFF role may complete documents.
  if (me.role !== "STAFF") {
    return NextResponse.json({ ok: false, code: "PERMISSION_DENIED" }, { status: 403 });
  }
  try {
    await dbConnect();
  } catch {
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE" }, { status: 503 });
  }
  const M = getModel("documents");
  const d = await M.findOne({ docId: id });
  if (!d) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  const scopeIds = me.scopeUnitIds?.length ? me.scopeUnitIds : me.unitId ? [me.unitId] : [];
  if (!((d.orgAncestors || []).some((a) => scopeIds.includes(a)))) {
    return NextResponse.json({ ok: false, code: "OUT_OF_SCOPE" }, { status: 404 });
  }
  let bytes = null;
  if (body.bytesBase64) {
    try {
      bytes = Buffer.from(String(body.bytesBase64), "base64");
    } catch {
      return NextResponse.json({ ok: false, code: "BAD_BYTES" }, { status: 400 });
    }
    if (bytes.length > INLINE_MAX) return NextResponse.json({ ok: false, code: "FILE_TOO_LARGE" }, { status: 422 });
  }
  // Without inline bytes there is nothing to store, and /download would
  // always answer FILE_NOT_STORED (410). Fail here instead of recording a
  // fake CLEAN version with no content behind it.
  if (!bytes) {
    return NextResponse.json({ ok: false, code: "FILE_NOT_STORED" }, { status: 422 });
  }
  const env = getEnv();
  const verdict = await scanUpload({ name: d.name, mime: d.mime || "", bytes, clamav: { host: env.clamav.host, port: env.clamav.port } });
  // Guard legacy rows with missing/empty versions[] — never crash with 500.
  if (!Array.isArray(d.versions) || !d.versions.length) d.versions = [{ v: 1, scan: "PENDING", uploadedBy: me.username }];
  const v = d.versions[d.versions.length - 1];
  if (verdict.infected) {
    await M.deleteOne({ docId: id });
    return NextResponse.json({ ok: false, code: "FILE_INFECTED", engine: verdict.engine, signature: verdict.signature || null, notified: v.uploadedBy }, { status: 422 });
  }
  v.scan = "CLEAN";
  v.engine = verdict.engine;
  v.scannedAt = new Date().toISOString();
  if (bytes) v.size = bytes.length;
  v.previewKey = d.name.match(/\.(jpg|jpeg|png)$/i) ? `${id}/preview` : null;
  // Persist the bytes so /download can stream the real file (dev/local
  // store; prod uses S3 main bucket). Without this the download URL has
  // nothing behind it.
  d.set("data", bytes);
  d.set("size", bytes.length);
  if (!d.mime && body.mime) d.set("mime", String(body.mime));
  d.markModified("versions");
  await d.save();
  return NextResponse.json({ ok: true, id, scan: "CLEAN", engine: verdict.engine, fallback: !!verdict.fallback, bucket: "wmams-docs", preview: v.previewKey });
}
