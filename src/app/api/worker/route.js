import { NextResponse } from "next/server";
import { runJob, JOBS } from "@/lib/worker";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";

// Prototype of the queue worker: same jobs, same shared formulas, inline.
// Production runs these on BullMQ schedules; slow work stays off requests.
export async function GET() {
  return NextResponse.json({ jobs: JOBS });
}

async function snapshot() {
  await dbConnect();
  const get = async (col) => getModel(col).find({}).lean();
  const tri = await get("trimester");
  return {
    works: await get("works"),
    budgetLines: await get("budget"),
    tasks: await get("tasks"),
    tippanis: await get("tippanis"),
    procurements: await get("procurements"),
    contracts: await get("contracts"),
    directives: await get("directives"),
    trimesterTargets: tri.filter((r) => r.kind === "target"),
    reviews: [{ id: "W-2083-014/T3", since: "2026-12-15" }],
    today: "2026-12-17",
  };
}

export async function POST(req) {
  let body = {};
  try {
    body = await req.json();
  } catch {}
  if (!body.job) return NextResponse.json({ ok: false, error: "MISSING_JOB", jobs: JOBS.map((j) => j.id) }, { status: 400 });
  try {
    const snap = { ...(await snapshot()), ...(body.snapshot || {}) };
    const out = runJob(body.job, snap);
    return NextResponse.json(out, { status: out.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "DB_UNAVAILABLE", message: e.message }, { status: 503 });
  }
}
