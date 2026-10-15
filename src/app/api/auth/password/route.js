import { NextResponse } from "next/server";
import { setPassword, verifyStepUp } from "@/lib/auth-mock";
import { requireSuperAdmin } from "@/lib/api-auth";

// POST /api/auth/password { username, newPassword, otpToken, sid? } —
// SUPER_ADMIN ONLY: admin sets/resets a user's password (scrypt-hashed
// before save, never stored in plaintext). The caller's session must belong
// to an ACTIVE SUPER_ADMIN (Mongo-verified, never a client role claim),
// AND a fresh step-up OTP for the TARGET username must accompany the call —
// without a received OTP the password never changes (428 otherwise).
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const gate = await requireSuperAdmin(req, body);
  if (!gate.ok) return NextResponse.json({ ok: false, code: gate.code }, { status: gate.status });
  if (!body.username || !body.newPassword) {
    return NextResponse.json({ ok: false, code: "MISSING_FIELDS" }, { status: 400 });
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
