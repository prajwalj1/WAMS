import { NextResponse } from "next/server";
import { requestReset } from "@/lib/auth-mock";

// POST /api/auth/reset { username? } — unknown usernames get UNKNOWN_USER
// (no code issued); ACTIVE accounts get a single-use reset token (15-min
// TTL, printed to the dev terminal like OTP codes).
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await requestReset(body.username));
}
