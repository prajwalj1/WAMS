import { NextResponse } from "next/server";
import { nightlyRun, snapshotCount, enqueueRecompute, queueSize, rollupUnit } from "@/lib/engine";
import { enrichWorks } from "@/lib/metrics";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";

// §32 engine API (prototype runs inline; prod schedules on BullMQ).
// GET /api/engine → queue depth + snapshot count.
// POST /api/engine { op: "nightly" } → 00:30 run over seed scope.
// POST /api/engine { op: "recompute", workId } → collapsed work recompute.
// POST /api/engine { op: "rollup", unitId } → unit snapshot for today.
export async function GET() {
  try {
    return NextResponse.json({ queue: queueSize(), snapshots: await snapshotCount() });
  } catch {
    return NextResponse.json({ queue: queueSize(), snapshots: 0, db: "unreachable" });
  }
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const today = "2026-12-17";
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, error: "DB_UNAVAILABLE", message: e.message }, { status: 503 });
  }
  const get = async (col) => getModel(col).find({}).lean();
  if (body.op === "nightly") {
    const works = await get("works");
    const tasks = await get("tasks");
    const exps = await get("expenditures");
    const tasksByWork = {};
    for (const t of tasks) (tasksByWork[t.workId] = tasksByWork[t.workId] || []).push(t);
    const spentByWork = {};
    for (const e of exps) if (e.status === "VERIFIED") spentByWork[e.work] = (spentByWork[e.work] || 0) + e.net;
    const out = await nightlyRun({ works, tasksByWork, contractsByWork: {}, spentByWork, budgetLines: await get("budget"), today });
    return NextResponse.json({ ok: true, ...out });
  }
  if (body.op === "recompute" && body.workId) {
    const key = enqueueRecompute("work", body.workId);
    return NextResponse.json({ ok: true, jobId: key, collapsed: queueSize() });
  }
  if (body.op === "rollup" && body.unitId) {
    const snap = rollupUnit(body.unitId, enrichWorks(await get("works"), new Date(today)), await get("budget"), today);
    return NextResponse.json({ ok: true, snapshot: snap });
  }
  return NextResponse.json({ ok: false, error: "UNKNOWN_OP" }, { status: 400 });
}
