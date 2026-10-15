import { NextResponse } from "next/server";
import { issueStepUp, verifyStepUp } from "@/lib/auth-mock";

// Step-up OTP (§28): sensitive actions need a fresh OTP. Client calls
// POST /api/auth/stepup { username, purpose } → { otpToken }, performs the
// action with X-OTP-Token, API verifies (428 STEP_UP_REQUIRED otherwise).
// GET /api/auth/stepup?token=&user= verifies (single use).
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!body.username) return NextResponse.json({ ok: false, error: "MISSING_USER" }, { status: 400 });
  return NextResponse.json({ ok: true, ...issueStepUp(body.username, body.purpose || "sensitive-action") });
}

export async function GET(req) {
  const q = new URL(req.url).searchParams;
  const v = verifyStepUp(q.get("token"), q.get("user"));
  if (!v.ok) return NextResponse.json({ ok: false, code: v.code }, { status: 428 });
  return NextResponse.json({ ok: true });
}
