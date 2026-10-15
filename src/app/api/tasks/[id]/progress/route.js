import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";
import { authorize, permsFor } from "@/lib/scope";
import { percentRange, decreaseNeedsReason } from "@/lib/rules";
import { workHealth } from "@/lib/progress";

// §30 Life of a request, live: POST /tasks/:id/progress + JWT, rate-limited.
// 1 token · 2 permission · 3 find task (scope filter → 404) · 4 record rules
// 5 handle · 6 txn update + audit · 7 recompute(work). Audit entries persist
// to auditlogs; NestJS wraps step 6 in session.withTransaction.
// Actor identity and role always resolve from the users collection — there is
// no hardcoded actor→role map and no default actor.

export async function GET(req, { params }) {
  const { id } = await params;
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE" }, { status: 503 });
  }
  const t = await getModel("tasks").findOne({ ref: id }).lean();
  if (!t) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, task: t });
}

export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const actor = String(body.actor || "").trim();
  // 1: token (prototype: actor header) — no default actor, unknown actor
  // resolves strictly from the users collection.
  if (!actor) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE" }, { status: 503 });
  }
  const dbUser = await getModel("users").findOne({ username: actor }).lean();
  if (!dbUser) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (dbUser.status !== "ACTIVE") return NextResponse.json({ ok: false, code: "ACCOUNT_LOCKED" }, { status: 403 });
  const role = dbUser.role || "STAFF";
  const scopeUnitIds = (body.scopeUnitIds?.length ? body.scopeUnitIds : null)
    || (dbUser.scopeUnitIds?.length ? dbUser.scopeUnitIds : null)
    || (dbUser.unitId ? [dbUser.unitId] : []);
  try {
    const Task = getModel("tasks");
    // 3: find task WITH scope filter — outside scope finds nothing → 404.
    const t = await Task.findOne({ ref: id, orgAncestors: { $in: scopeUnitIds } });
    if (!t) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
    // 2+4: permission + record rules (three layers).
    authorize({ userPerms: permsFor(role), scopeUnitIds, permission: "task.update", record: t.toObject(), recordType: "task", actor, action: "update" });
    // 5: handle — validate update.
    percentRange(Number(body.physical));
    decreaseNeedsReason(Number(body.physical), t.physical, body.reason);
    // 6: txn — update + audit atomically (session.withTransaction in prod).
    const before = t.physical;
    t.physical = Number(body.physical);
    t.lastUpdate = new Date().toISOString().slice(0, 10);
    if (t.physical >= 100) t.status = "DONE";
    else if (t.status === "NOT_STARTED") t.status = "IN_PROGRESS";
    await t.save();
    const entry = { at: new Date().toISOString(), actor, action: "task.progress", entity: id, before, after: t.physical, note: body.note || "" };
    await getModel("auditlogs").create(entry);
    // 7: recompute work (background in prod — inline here, same formulas).
    const w = await getModel("works").findOne({ id: t.workId }).lean();
    const health = w ? workHealth(w, new Date("2026-12-17")) : null;
    return NextResponse.json({ ok: true, task: t.toObject(), audit: entry, workHealth: health }, { status: 201 });
  } catch (e) {
    const status = e.code === "OUT_OF_SCOPE" ? 404 : e.code === "PERMISSION_DENIED" ? 403 : 422;
    return NextResponse.json({ ok: false, code: e.code || "INVALID", details: e.details }, { status });
  }
}
