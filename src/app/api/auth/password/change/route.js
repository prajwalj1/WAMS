import { NextResponse } from "next/server";
import { setPassword, verifyStepUp, getSessionIdentity } from "@/lib/auth-mock";
import { sidOf } from "@/lib/api-auth";

// POST /api/auth/password/change { username, newPassword, otpToken, sid? } —
// self-service password change gated by a fresh step-up OTP (single use,
// 5-min). The session user may only change their OWN password; changing
// anyone else's stays on POST /api/auth/password (SUPER_ADMIN only).
// Missing/invalid/expired token → 428 STEP_UP_REQUIRED.
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!body.username || !body.newPassword) {
    return NextResponse.json({ ok: false, code: "MISSING_FIELDS" }, { status: 400 });
  }
  const me = await getSessionIdentity(sidOf(req, body));
  if (!me) return NextResponse.json({ ok: false, code: "UNAUTHENTICATED" }, { status: 401 });
  if (me.username !== body.username) {
    return NextResponse.json({ ok: false, code: "PERMISSION_DENIED" }, { status: 403 });
  }
  const v = verifyStepUp(body.otpToken, body.username);
  if (!v.ok) {
    return NextResponse.json({ ok: false, code: v.code }, { status: 428 });
  }
  const out = await setPassword(body.username, body.newPassword);
  if (!out.ok) {
    const status = out.code === "PASSWORD_RULES" ? 422 : out.code === "UNKNOWN_USER" ? 404 : 503;
    return NextResponse.json(out, { status });
  }
  return NextResponse.json(out);
}
