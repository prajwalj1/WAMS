import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";
import { callerIdentity } from "@/lib/api-auth";

// DELETE /api/documents/:id — PMO Super Admin ONLY. Removes a document or
// evidence file completely: the stored bytes (documents collection, keyed
// by docId) AND the metadata row (docs collection). Any work completionDoc
// pointing at the file is cleared so no dangling evidence reference
// remains. Everyone else gets 403 — the server never trusts client claims.
export async function DELETE(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const qSid = url.searchParams.get("sid");
  const me = await callerIdentity(req, { ...body, ...(qSid ? { sid: qSid } : {}) });
  if (!me) return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  if (me.role !== "SUPER_ADMIN") return NextResponse.json({ ok: false, error: { code: "PERMISSION_DENIED" } }, { status: 403 });
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, error: { code: "DB_UNAVAILABLE", message: e.message } }, { status: 503 });
  }
  const Docs = getModel("docs");
  const Files = getModel("documents");
  let meta = null;
  try {
    meta = await Docs.findOne({ docId: id }).lean();
  } catch {}
  if (!meta) {
    try {
      meta = await Docs.findById(id).lean();
    } catch {}
  }
  const key = meta?.docId || id;
  let fileRow = null;
  try {
    fileRow = await Files.findOne({ docId: key }).lean();
  } catch {}
  if (!meta && !fileRow) return NextResponse.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 });
  try {
    await Files.deleteMany({ docId: key });
  } catch {}
  if (meta) {
    try {
      await Docs.deleteOne({ _id: meta._id });
    } catch {}
  }
  // Clear work completion evidence pointing at this file (stored as docId
  // or file name) so works never reference a deleted document.
  try {
    const names = [...new Set([key, meta?.name].filter(Boolean))];
    if (names.length) await getModel("works").updateMany({ completionDoc: { $in: names } }, { $unset: { completionDoc: "" } });
  } catch {}
  return NextResponse.json({ ok: true, id: key });
}
