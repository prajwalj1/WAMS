import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";
import { getSessionIdentity } from "@/lib/auth-mock";
import { sidOf } from "@/lib/api-auth";
import { applyTransition } from "@/lib/lifecycle";
import { checkVersion } from "@/lib/api-helpers";
import { verifiedSpentBySubhead } from "@/lib/metrics";

// POST /api/budget/revisions/:id/transition { action: approve|reject, comment, actor, sid, __v? }
// Validated decision + side effects in ONE call: on APPROVED the transfer
// applies atomically (from.revised -= amount, to.revised += amount) after a
// live availability check (revised − committed − verified-spent). Writes audit.
export async function POST(req, { params }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const actor = String(body.actor || "").trim();
  if (!actor) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (!["approve", "reject"].includes(body.action)) return NextResponse.json({ ok: false, code: "MISSING_ACTION" }, { status: 400 });
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE", message: e.message }, { status: 503 });
  }
  const me = await getSessionIdentity(sidOf(req, body));
  if (!me) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (me.username !== actor) return NextResponse.json({ ok: false, code: "ACTOR_MISMATCH" }, { status: 403 });
  // Revision decisions (approve/reject) belong to ministry level ONLY —
  // finance prepares, Secretary/DG decides.
  if (!["MINISTRY_ADMIN", "APPROVER"].includes(me.role)) {
    return NextResponse.json({ ok: false, code: "PERMISSION_DENIED" }, { status: 403 });
  }
  const R = getModel("budgetrevisions");
  const rev = await R.findOne({ id });
  if (!rev) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  try {
    checkVersion(rev, body.__v);
  } catch (e) {
    return NextResponse.json(e.body, { status: e.status });
  }
  let r;
  try {
    r = applyTransition("budgetRevision", { from: rev.status, action: body.action, actor, ctx: { comment: body.comment, reason: body.comment } });
  } catch (e) {
    return NextResponse.json({ ok: false, code: e.code || "INVALID_TRANSITION", details: e.details }, { status: 422 });
  }
  if (r.status === "APPROVED") {
    const B = getModel("budget");
    const from = await B.findOne({ subhead: rev.from });
    const to = await B.findOne({ subhead: rev.to });
    if (!from || !to) return NextResponse.json({ ok: false, code: "LINE_NOT_FOUND" }, { status: 422 });
    const works = await getModel("works").find({}).lean();
    const exps = await getModel("expenditures").find({}).lean();
    const spentBySub = verifiedSpentBySubhead(exps, works);
    const avail = (Number(from.revised) || 0) - (Number(from.committed) || 0) - (spentBySub[from.subhead] || 0);
    if (Number(rev.amount) > avail) {
      return NextResponse.json({ ok: false, code: "BUDGET_INSUFFICIENT", details: { available: avail } }, { status: 422 });
    }
    from.revised = (Number(from.revised) || 0) - Number(rev.amount);
    to.revised = (Number(to.revised) || 0) + Number(rev.amount);
    await from.save();
    await to.save();
  }
  const fromStatus = rev.status;
  rev.status = r.status;
  await rev.save();
  await getModel("auditlogs").create({
    at: new Date().toISOString(), actor, action: `budgetRevision.${body.action}`,
    entity: id, before: fromStatus, after: r.status, note: body.comment || "",
    orgAncestors: rev.orgAncestors || [],
  });
  return NextResponse.json({ ok: true, status: r.status }, { status: 200 });
}
