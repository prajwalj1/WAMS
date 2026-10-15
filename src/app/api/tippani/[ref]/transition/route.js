import { NextResponse } from "next/server";
import { dbConnect } from "@/lib/db";
import { getModel } from "@/lib/models";
import { getSessionIdentity } from "@/lib/auth-mock";
import { sidOf } from "@/lib/api-auth";
import { permsFor } from "@/lib/scope";
import { applyTransition, LARGE_BAND_DEFAULT_NPR } from "@/lib/lifecycle";
import { verifyStepUp } from "@/lib/auth-mock";
import { checkVersion } from "@/lib/api-helpers";
import { canStepTippani } from "@/lib/rules";
import { kathmanduDayKey } from "@/lib/progress";

// POST /api/tippani/:ref/transition { action, comment, actor, sid, scopeUnitIds?, __v? }
// Validated status transition + side effects in ONE call (instead of a bare
// status PATCH): on final APPROVED the approved amount commits to the linked
// budget line (committed += amount, once). Every decision writes auditlogs.
// - actor must equal the session user (no acting-as)
// - draft-family (send/withdraw) needs tippani.draft, decisions need tippani.act
// - out-of-scope reads as 404 (BR-03), stale __v as 409
const DRAFT_ACTIONS = ["send", "withdraw", "draft"];

export async function POST(req, { params }) {
  const { ref } = await params;
  const body = await req.json().catch(() => ({}));
  const actor = String(body.actor || "").trim();
  if (!actor) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (!body.action) return NextResponse.json({ ok: false, code: "MISSING_ACTION" }, { status: 400 });
  try {
    await dbConnect();
  } catch (e) {
    return NextResponse.json({ ok: false, code: "DB_UNAVAILABLE", message: e.message }, { status: 503 });
  }
  const me = await getSessionIdentity(sidOf(req, body));
  if (!me) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (me.username !== actor) return NextResponse.json({ ok: false, code: "ACTOR_MISMATCH" }, { status: 403 });
  const T = getModel("tippanis");
  const tip = await T.findOne({ ref });
  if (!tip) return NextResponse.json({ ok: false, code: "NOT_FOUND" }, { status: 404 });
  // Scope check (BR-03): the approver must sit on the tippani's chain.
  // Compared case-insensitively on trimmed ids, ignoring empty entries —
  // a stale client profile sending scopeUnitIds:[null] or a "DOM" vs "dom"
  // drift must never read as out-of-scope on its own. Falls back to the
  // session's live unit when the client sends nothing usable.
  const norm = (v) => String(v ?? "").trim().toLowerCase();
  const clientIds = (body.scopeUnitIds || []).map(norm).filter(Boolean);
  const meIds = (me.scopeUnitIds || []).map(norm).filter(Boolean);
  const scopeIds = clientIds.length ? clientIds : meIds.length ? meIds : (me.unitId ? [norm(me.unitId)] : []);
  const tipChain = (tip.orgAncestors || []).map(norm).filter(Boolean);
  if (!scopeIds.length || !tipChain.some((a) => scopeIds.includes(a))) {
    return NextResponse.json({ ok: false, code: "OUT_OF_SCOPE" }, { status: 404 });
  }
  // Permission by action family: drafts move on tippani.draft, step actions
  // (forward/return) on tippani.act — but final DECISIONS (approve/reject)
  // belong to ministry level ONLY (MINISTRY_ADMIN / APPROVER), never to
  // unit, section or finance hands, however the route steps read.
  const need = DRAFT_ACTIONS.includes(body.action) ? "tippani.draft"
    : ["approve", "reject"].includes(body.action) ? null
    : "tippani.act";
  const have = permsFor(me.role) || [];
  const ministryLevel = ["MINISTRY_ADMIN", "APPROVER"].includes(me.role);
  if (need === null ? !ministryLevel : (!have.includes("*") && !have.includes(need))) {
    return NextResponse.json({ ok: false, code: "PERMISSION_DENIED" }, { status: 403 });
  }
  // Step moves (forward/return) are ministry-level (+finance) only — STAFF,
  // SECTION_HEAD and UNIT_HEAD keep drafting/sending but never step a
  // tippani, however the route steps read. Enforced here so a direct API
  // call cannot bypass the hidden UI buttons.
  if (["forward", "return"].includes(body.action)) {
    try {
      canStepTippani(tip, me);
    } catch (e) {
      return NextResponse.json({ ok: false, code: e?.code || "PERMISSION_DENIED" }, { status: 403 });
    }
  }
  try {
    checkVersion(tip, body.__v);
  } catch (e) {
    return NextResponse.json(e.body, { status: e.status });
  }
  // OTP-gated final decision (§12, §28): amounts over NPR 1 crore travel the
  // MIN_BUDGET_LARGE chain (… Joint Secretary → Secretary) and the Secretary's
  // approve needs a fresh single-use step-up OTP. The client obtains one via
  // POST /api/auth/stepup and sends it as body.otpToken (or X-OTP-Token).
  if (body.action === "approve" && (tip.route === "MIN_BUDGET_LARGE" || Number(tip.amount) > LARGE_BAND_DEFAULT_NPR)) {
    const token = body.otpToken || req.headers.get("x-otp-token");
    const v = verifyStepUp(token, actor);
    if (!v.ok) {
      const status = v.code === "OTP_REQUIRED" ? 428 : 403;
      return NextResponse.json({ ok: false, code: v.code }, { status });
    }
  }
  let r;
  try {
    r = applyTransition("tippani", { from: tip.status, action: body.action, actor, ctx: { comment: body.comment, reason: body.comment } });
  } catch (e) {
    return NextResponse.json({ ok: false, code: e.code || "INVALID_TRANSITION", details: e.details }, { status: 422 });
  }
  const from = tip.status;
  tip.status = r.status;
  // Step chain (§12): send starts the clock, each forward hands the file to
  // the next holder (Section Head → Mahashakha Head → Joint Secretary →
  // Secretary on the large route). The client passes nextStep from the
  // snapshotted route; the server persists it with a fresh stepSince so wait
  // days stay live and every hop writes auditlogs below.
  if (["send", "forward"].includes(body.action)) {
    if (body.nextStep) tip.step = body.nextStep;
    tip.stepSince = kathmanduDayKey(new Date());
  }
  await tip.save();
  // Side effect: final approval commits the approved NPR amount to the
  // linked budget line exactly once (committed += amount).
  let committed = null;
  if (r.status === "APPROVED" && !tip.committed && tip.subhead && Number(tip.amount) > 0) {
    const line = await getModel("budget").findOne({ subhead: tip.subhead });
    if (line) {
      line.committed = (Number(line.committed) || 0) + Number(tip.amount);
      await line.save();
      tip.committed = true;
      await tip.save();
      committed = { subhead: tip.subhead, amount: Number(tip.amount) };
    }
  }
  await getModel("auditlogs").create({
    at: new Date().toISOString(), actor, action: `tippani.${body.action}`,
    entity: ref, before: from, after: r.status, note: body.comment || "",
    orgAncestors: tip.orgAncestors || [],
  });
  return NextResponse.json({ ok: true, status: r.status, committed }, { status: 200 });
}
