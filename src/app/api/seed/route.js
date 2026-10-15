import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";
import { requireSuperAdmin } from "@/lib/api-auth";

// POST /api/seed { col, docs, replace?, sid? } — dynamic bootstrap.
// SUPER_ADMIN ONLY once any user exists: the caller's session must belong to
// an ACTIVE SUPER_ADMIN (Mongo-verified, never a client claim). The single
// exception is first bootstrap on an empty users collection, otherwise a
// fresh database could never gain its first admin.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const M = getModel(body.col);
  if (!M) return NextResponse.json({ ok: false, error: "UNKNOWN_COLLECTION" }, { status: 404 });
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, error: "DB_UNAVAILABLE", message: e.message }, { status: 503 });
  }
  const userCount = await getModel("users").countDocuments();
  if (userCount > 0) {
    const gate = await requireSuperAdmin(req, body);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.code }, { status: gate.status });
  }
  if (body.replace) await M.deleteMany({});
  const docs = body.docs || [];
  if (docs.length) await M.insertMany(docs, { ordered: false });
  return NextResponse.json({ ok: true, col: body.col, inserted: docs.length });
}
