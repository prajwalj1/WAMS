import { NextResponse } from "next/server";
import { verifyOtp, resendOtp } from "@/lib/auth-mock";

// POST /api/auth/otp { action: "verify" | "resend", challengeId, code? }
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const out = body.action === "resend" ? await resendOtp(body) : await verifyOtp(body);
  if (!out.ok) {
    const status = out.code === "RESEND_WAIT" ? 429 : 401;
    return NextResponse.json(out, { status });
  }
  return NextResponse.json(out);
}
